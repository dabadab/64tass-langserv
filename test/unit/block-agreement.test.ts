import { describe, it, expect } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { parseDocument } from '../../src/server/parser';
import { validateDocument } from '../../src/server/diagnostics';
import { computeFoldingRanges } from '../../src/server/folding';
import { createDoc } from '../helpers/doc';
import { DocumentIndex } from '../../src/server/types';

/**
 * Three separate things track blocks: the parser's scope stack, the unclosed-block
 * check in diagnostics.ts, and computeFoldingRanges. They all consume
 * blockDirectivesOn now, but they each decide independently what to DO with what
 * it reports - so they can still drift apart. This feeds all three the same
 * awkward sources and asserts they pair the same openers with the same closers.
 *
 * Every source here is balanced and assembles, so the honest answers are: no
 * unclosed-block diagnostic, one folding range per opener, and a scope path that
 * covers exactly the lines between.
 */
interface Block {
    /** Zero-based line of the opener and of its closer. */
    open: number;
    close: number;
    /** Scope path the lines inside carry, or null where the block is not a scope. */
    scope: string | null;
}

const CASES: [name: string, source: string, blocks: Block[]][] = [
    ['a plain proc', [
        'outer   .proc',       // 0
        'inner   lda #1',      // 1
        '        .pend',       // 2
    ].join('\n'), [{ open: 0, close: 2, scope: 'outer' }]],

    ['a closer named in a comment', [
        'outer   .proc',
        '        lda #1   ; closed by .pend below',
        'inner   lda #2',
        '        .pend',
    ].join('\n'), [{ open: 0, close: 3, scope: 'outer' }]],

    ['a closer inside a string', [
        'outer   .block',
        '        .text "use .bend to close"',
        'inner   lda #2',
        '        .bend',
    ].join('\n'), [{ open: 0, close: 3, scope: 'outer' }]],

    ['a dotted reference that looks like an opener', [
        'outer   .proc',
        'inner   lda #1',
        '        .pend',
        '        jsr outer.proc',
    ].join('\n'), [{ open: 0, close: 2, scope: 'outer' }]],

    ['an opener after a colon', [
        'outer:.proc',
        'inner   lda #1',
        '        .pend',
    ].join('\n'), [{ open: 0, close: 2, scope: 'outer' }]],

    ['nested scopes of the same kind', [
        'outer   .block',
        'middle  .block',
        'inner   lda #1',
        '        .bend',
        '        .bend',
    ].join('\n'), [
        { open: 0, close: 4, scope: 'outer' },
        { open: 1, close: 3, scope: 'outer.middle' },
    ]],

    ['long-form closers', [
        'outer   .proc',
        'inner   lda #1',
        '        .endproc',
    ].join('\n'), [{ open: 0, close: 2, scope: 'outer' }]],

    ['an unnamed block', [
        '        .block',
        'inner   lda #1',
        '        .bend',
    ].join('\n'), [{ open: 0, close: 2, scope: 'block@0' }]],

    ['uppercase directives', [
        'OUTER   .PROC',
        'inner   lda #1',
        '        .PEND',
    ].join('\n'), [{ open: 0, close: 2, scope: 'outer' }]],

    ['a conditional wrapped around a scope', [
        '        .if 1',
        'outer   .proc',
        'inner   lda #1',
        '        .pend',
        '        .endif',
    ].join('\n'), [
        { open: 0, close: 4, scope: null },
        { open: 1, close: 3, scope: 'outer' },
    ]],

    ['a scope wrapped around a loop', [
        'outer   .proc',
        '        .for i = 0, i < 3, i + 1',
        'inner   lda #1',
        '        .next',
        '        .pend',
    ].join('\n'), [
        { open: 0, close: 4, scope: 'outer' },
        { open: 1, close: 3, scope: 'outer' },
    ]],
];

function index(source: string) {
    const doc = createDoc(source, 'file:///blocks.asm');
    const parsed = parseDocument(doc);
    return { doc, parsed, documentIndex: new Map<string, DocumentIndex>([[doc.uri, parsed]]) };
}

describe('the three block trackers agree', () => {
    it.each(CASES)('%s: folding pairs the openers the parser does', (_name, source, blocks) => {
        const ranges = computeFoldingRanges(source);
        expect(ranges.map(r => [r.startLine, r.endLine]).sort())
            .toEqual(blocks.map(b => [b.open, b.close]).sort());
    });

    it.each(CASES)('%s: nothing is reported unclosed', (_name, source) => {
        const { doc, documentIndex } = index(source);
        const unclosed = validateDocument(doc, documentIndex)
            .filter(d => d.severity === DiagnosticSeverity.Error
                && (d.code === 'unclosed-block' || d.message.includes('without matching')));
        expect(unclosed.map(d => d.message)).toEqual([]);
    });

    it.each(CASES)('%s: the parser scopes exactly the lines between', (_name, source, blocks) => {
        const { parsed } = index(source);
        for (const block of blocks) {
            if (block.scope === null) continue;
            // Every line between the pair is inside the scope - itself, or a
            // nested one under it. A nested opener sits on such a line, which is
            // why this is a containment check rather than an equality one.
            for (let line = block.open + 1; line < block.close; line++) {
                const path = parsed.scopeAtLine.get(line)?.scopePath;
                expect(path === block.scope || path?.startsWith(`${block.scope}.`), 
                    `line ${line} is ${path}, not inside ${block.scope}`).toBe(true);
            }
            // And the line after the closer is not.
            const after = parsed.scopeAtLine.get(block.close + 1)?.scopePath;
            expect(after === block.scope).toBe(false);
        }
    });
});

/**
 * The other half: sources the assembler rejects. Agreement matters here too -
 * a closer that pairs with the wrong opener in one tracker and not in another is
 * how a scope silently swallows the rest of a file.
 */
const MISMATCHED: [name: string, source: string, reported: RegExp[]][] = [
    ['a proc closed by .bend', [
        'outer   .proc',
        'inner   lda #1',
        '        .bend',
        'after   lda #2',
    ].join('\n'), [/'\.bend' without matching \.block/, /Unclosed '\.proc'/]],

    ['an unclosed proc', 'outer   .proc\ninner   lda #1', [/Unclosed '\.proc'/]],

    ['a closer with nothing open', [
        'first   lda #1',
        '        .pend',
        'after   lda #2',
    ].join('\n'), [/'\.pend' without matching \.proc/]],
];

describe('the three block trackers agree on mismatched blocks', () => {
    it.each(MISMATCHED)('%s: folding offers no range', (_name, source) => {
        expect(computeFoldingRanges(source)).toEqual([]);
    });

    it.each(MISMATCHED)('%s: diagnostics says exactly what is wrong', (_name, source, reported) => {
        const { doc, documentIndex } = index(source);
        const messages = validateDocument(doc, documentIndex)
            .filter(d => /matching|Unclosed/.test(d.message))
            .map(d => d.message);
        expect(messages).toHaveLength(reported.length);
        for (const pattern of reported) expect(messages.some(m => pattern.test(m))).toBe(true);
    });

    it('leaves the parser inside the scope a wrong closer did not close', (_name) => {
        // Everything after the stray `.bend` still belongs to the proc, which is
        // what the assembler does with it too - the file simply does not build.
        const { parsed } = index(MISMATCHED[0][1]);
        expect(parsed.scopeAtLine.get(3)?.scopePath).toBe('outer');
    });

    it('never enters a scope for a closer with nothing open', () => {
        const { parsed } = index(MISMATCHED[2][1]);
        expect(parsed.scopeAtLine.get(2)?.scopePath).toBeNull();
    });
});
