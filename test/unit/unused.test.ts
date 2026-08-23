import { describe, it, expect } from 'vitest';
import { DiagnosticSeverity, DiagnosticTag } from 'vscode-languageserver/node';
import { findUnusedSymbols } from '../../src/server/unused';
import { parseDocument } from '../../src/server/parser';
import { createDoc } from '../helpers/doc';
import { DocumentIndex } from '../../src/server/types';

function inOneFile(source: string) {
    const doc = createDoc(source, 'file:///unused.asm');
    const documentIndex = new Map<string, DocumentIndex>([[doc.uri, parseDocument(doc)]]);
    return findUnusedSymbols(doc.uri, documentIndex, [doc.uri], () => source);
}

describe('findUnusedSymbols', () => {
    // The same source under `64tass -Wunused` reports exactly these three.
    const source = [
        '        *= $1000',
        'unusedconst = 5',
        'used    = 3',
        'unused_lbl',
        '        rts',
        'start   lda #used',
        '        jmp start',
        '; unused_lbl is mentioned here, but a comment is not a use',
        'shout   .macro',
        '        .endm',
    ].join('\n');

    it('finds what the assembler finds, and names the kinds as it does', () => {
        expect(inOneFile(source).map(d => d.message)).toEqual([
            "Unused const 'unusedconst'",
            "Unused label 'unused_lbl'",
            "Unused macro 'shout'",
        ]);
    });

    it('marks them as hints the editor can grey out', () => {
        const [first] = inOneFile(source);
        expect(first.severity).toBe(DiagnosticSeverity.Hint);
        expect(first.tags).toEqual([DiagnosticTag.Unnecessary]);
        expect(first.code).toBe('unused-symbol');
    });

    it('does not count a mention inside a string', () => {
        // `msg` itself is unused too - what matters is that the name inside the
        // string literal did not save `unusedconst`.
        expect(inOneFile('msg     .text "unusedconst"\nunusedconst = 5').map(d => d.message))
            .toContain("Unused const 'unusedconst'");
    });

    it('counts a use from another file in the same program', () => {
        const mainUri = 'file:///main.asm';
        const incUri = 'file:///sub.inc';
        const texts: Record<string, string> = {
            [incUri]: 'shared  = 5\nprivate = 6',
            [mainUri]: '        *= $1000\n        lda #shared',
        };
        const incDoc = createDoc(texts[incUri], incUri);
        const documentIndex = new Map<string, DocumentIndex>([
            [incUri, parseDocument(incDoc)],
            [mainUri, parseDocument(createDoc(texts[mainUri], mainUri))],
        ]);
        const found = findUnusedSymbols(incUri, documentIndex, [incUri, mainUri], (u) => texts[u] ?? null);
        expect(found.map(d => d.message)).toEqual(["Unused const 'private'"]);
    });

    it('ignores anonymous labels', () => {
        expect(inOneFile('        *= $1000\n-       inx\n        bne -')).toEqual([]);
    });

    it('is name-based, so a same-named symbol elsewhere counts as a use', () => {
        // Deliberately conservative: greying out something that IS used is the
        // expensive mistake, missing one that is not costs nothing.
        const found = inOneFile('outer   .block\ncounter = 1\n        .bend\ncounter = 2\n'
            + '        lda #counter\n        jsr outer');
        expect(found).toEqual([]);
    });
});
