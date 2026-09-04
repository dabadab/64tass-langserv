import { describe, it, expect } from 'vitest';
import { DocumentHighlightKind } from 'vscode-languageserver/node';
import { findReferences, findDocumentHighlights, findSymbolOccurrences, findSymbolInfo } from '../../src/server/symbols';
import { buildIndex, BuildIndexSource } from '../helpers/doc';

function withText(sources: BuildIndexSource[]) {
    const built = buildIndex(...sources);
    const texts = new Map(sources.map(s => [s.uri, s.source]));
    return { ...built, getText: (uri: string) => texts.get(uri) ?? null };
}

const SIMPLE = [{ source: 'start\t; the start label\n        jsr start\n        jmp start', uri: 'file:///s.asm' }];

describe('findReferences', () => {
    it('includes the declaration only when asked', () => {
        const { documentIndex, getText } = withText(SIMPLE);
        const symbol = findSymbolInfo('start', 'file:///s.asm', 1, documentIndex)!;

        expect(findReferences(symbol, documentIndex, getText, false, false)).toHaveLength(2);
        expect(findReferences(symbol, documentIndex, getText, true, false)).toHaveLength(3);
    });

    it('excludes occurrences inside comments', () => {
        const { documentIndex, getText } = withText(SIMPLE);
        const symbol = findSymbolInfo('start', 'file:///s.asm', 1, documentIndex)!;
        // The comment on line 0 says "start" but is not a reference
        const refs = findReferences(symbol, documentIndex, getText, true, false);
        expect(refs.every(r => r.range.start.line !== 0 || r.range.start.character === 0)).toBe(true);
    });

    it('finds references across files', () => {
        const { documentIndex, getText } = withText([
            { source: 'shared\n        rts', uri: 'file:///a.asm' },
            { source: 'main\n        jsr shared', uri: 'file:///b.asm' },
        ]);
        const symbol = findSymbolInfo('shared', 'file:///b.asm', 1, documentIndex)!;
        const refs = findReferences(symbol, documentIndex, getText, false, false);
        expect(refs).toHaveLength(1);
        expect(refs[0].uri).toBe('file:///b.asm');
    });

    // The old inline scanner verified a bare name rather than the dotted prefix,
    // so scope-qualified references were handled differently from rename.
    it('distinguishes the scope prefix from the member in a dotted reference', () => {
        const source = 'random\t.proc\ninit:\n\trts\n.pend\n\tjsr random.init';
        const { documentIndex, getText } = withText([{ source, uri: 'file:///d.asm' }]);

        const scope = findSymbolInfo('random', 'file:///d.asm', 0, documentIndex)!;
        const scopeRefs = findReferences(scope, documentIndex, getText, false, false);
        expect(scopeRefs).toHaveLength(1);
        expect(scopeRefs[0].range.start.character).toBe(source.split('\n')[4].indexOf('random'));

        const member = findSymbolInfo('random.init', 'file:///d.asm', 4, documentIndex)!;
        const memberRefs = findReferences(member, documentIndex, getText, false, false);
        expect(memberRefs).toHaveLength(1);
        expect(memberRefs[0].range.start.character).toBe(source.split('\n')[4].indexOf('init'));
    });

    it('respects local symbol scoping', () => {
        const source = 'a\n_x = 1\n        lda #_x\nb\n_x = 2\n        lda #_x';
        const { documentIndex, getText } = withText([{ source, uri: 'file:///l.asm' }]);
        const symbol = findSymbolInfo('_x', 'file:///l.asm', 1, documentIndex)!;
        const refs = findReferences(symbol, documentIndex, getText, true, false);
        expect(refs.map(r => r.range.start.line).sort()).toEqual([1, 2]);
    });
});

describe('findDocumentHighlights', () => {
    it('marks the definition as a write and uses as reads', () => {
        const { documentIndex, getText } = withText(SIMPLE);
        const symbol = findSymbolInfo('start', 'file:///s.asm', 1, documentIndex)!;
        const highlights = findDocumentHighlights(symbol, 'file:///s.asm', documentIndex, getText, false);

        expect(highlights).toHaveLength(3);
        expect(highlights.filter(h => h.kind === DocumentHighlightKind.Write)).toHaveLength(1);
        expect(highlights.filter(h => h.kind === DocumentHighlightKind.Read)).toHaveLength(2);
    });

    it('only reports occurrences in the requested document', () => {
        const { documentIndex, getText } = withText([
            { source: 'shared\n        rts', uri: 'file:///a.asm' },
            { source: 'main\n        jsr shared', uri: 'file:///b.asm' },
        ]);
        const symbol = findSymbolInfo('shared', 'file:///b.asm', 1, documentIndex)!;

        const inB = findDocumentHighlights(symbol, 'file:///b.asm', documentIndex, getText, false);
        expect(inB).toHaveLength(1);
        expect(inB[0].kind).toBe(DocumentHighlightKind.Read);

        // The definition lives in a.asm, so highlighting there shows the write
        const inA = findDocumentHighlights(symbol, 'file:///a.asm', documentIndex, getText, false);
        expect(inA).toHaveLength(1);
        expect(inA[0].kind).toBe(DocumentHighlightKind.Write);
    });
});

describe('findSymbolOccurrences', () => {
    it('flags comment occurrences separately from code', () => {
        const { documentIndex, getText } = withText(SIMPLE);
        const symbol = findSymbolInfo('start', 'file:///s.asm', 1, documentIndex)!;
        const all = findSymbolOccurrences(symbol, documentIndex, getText, false);

        expect(all.filter(o => o.inComment)).toHaveLength(1);
        expect(all.filter(o => o.isDefinition)).toHaveLength(1);
    });
});

describe('a dotted reference is not a macro call', () => {
    // Shape of a real bug: a top-level block named `setup`, and inside it a call
    // to a `setup` belonging to another scope. The `.setup` of `helper.setup` was
    // being read as a macro call, resolved as a bare name up the scope chain, and
    // so counted as a use of the top-level block - which rename then rewrote.
    const SOURCE = [
        'setup   .block',            // 0: the top-level scope
        '        jsr helper.setup',  // 1: a different symbol entirely
        '        .bend',             // 2
        'helper  .proc',             // 3
        'setup:',                    // 4: helper's own
        '        rts',               // 5
        '        .pend',             // 6
    ].join('\n');
    const FILES = [{ source: SOURCE, uri: 'file:///dotted.asm' }];

    function topLevelSetup() {
        const { documentIndex, getText } = withText(FILES);
        const symbol = findSymbolInfo('setup', 'file:///dotted.asm', 0, documentIndex)!;
        expect(symbol.range.start.line).toBe(0);   // the block, not helper's label
        return { symbol, documentIndex, getText };
    }

    it('does not report the tail of a dotted name as a reference', () => {
        const { symbol, documentIndex, getText } = topLevelSetup();
        const refs = findReferences(symbol, documentIndex, getText, false, false);
        expect(refs.map(r => r.range.start.line)).toEqual([]);
    });

    it('still finds a genuine macro call', () => {
        const { documentIndex, getText } = withText([{
            source: 'shout   .macro\n        .endm\n        .shout\n',
            uri: 'file:///macro.asm',
        }]);
        const symbol = findSymbolInfo('shout', 'file:///macro.asm', 0, documentIndex)!;
        const refs = findReferences(symbol, documentIndex, getText, false, false);
        expect(refs.map(r => r.range.start.line)).toEqual([2]);
    });
});

describe('a name with a capital in it', () => {
    // `symbol.name` is lowercased when the document is case-insensitive, which the
    // default is. Matching case-sensitively against that found the definition and
    // none of its uses - and rename rewrote exactly that much.
    const SOURCE = [
        'main',
        '_Loop   = 1',
        '        lda _LOOP',
        '        lda _Loop',
        'Counter = 1 ; the COUNTER',
        '        lda COUNTER',
    ].join('\n');
    const FILES = [{ source: SOURCE, uri: 'file:///caps.asm' }];

    function occurrencesOf(name: string, line: number) {
        const { documentIndex, getText } = withText(FILES);
        const symbol = findSymbolInfo(name, 'file:///caps.asm', line, documentIndex)!;
        return findSymbolOccurrences(symbol, documentIndex, getText, false);
    }

    it('finds a local symbol\'s references whatever case they are written in', () => {
        expect(occurrencesOf('_Loop', 1).map(o => `${o.range.start.line}:${o.range.start.character}`))
            .toEqual(['1:0', '2:12', '3:12']);
    });

    it('finds it in a comment too', () => {
        const inComment = occurrencesOf('Counter', 4).filter(o => o.inComment);
        expect(inComment.map(o => o.range.start.character)).toEqual([18]);
    });

    it('still matches exactly when the document is case-sensitive', () => {
        const { documentIndex, getText } = withText([{ source: SOURCE, uri: 'file:///cs.asm', caseSensitive: true }]);
        const symbol = findSymbolInfo('_Loop', 'file:///cs.asm', 1, documentIndex, true)!;
        const found = findSymbolOccurrences(symbol, documentIndex, getText, true);
        // `_LOOP` is a different symbol under -C, and stays untouched.
        expect(found.map(o => `${o.range.start.line}:${o.range.start.character}`)).toEqual(['1:0', '3:12']);
    });
});

describe('a name inside a string literal', () => {
    // Text, not a reference: rename was rewriting the contents of a .text.
    const SOURCE = 'counter = 1\nmsg     .text "counter here"\n        lda counter';

    it('is not an occurrence', () => {
        const { documentIndex, getText } = withText([{ source: SOURCE, uri: 'file:///str.asm' }]);
        const symbol = findSymbolInfo('counter', 'file:///str.asm', 2, documentIndex)!;
        expect(findSymbolOccurrences(symbol, documentIndex, getText, false)
            .map(o => `${o.range.start.line}:${o.range.start.character}`))
            .toEqual(['0:0', '2:12']);
    });

    it('leaves a real reference on the same line alone', () => {
        const source = 'counter = 1\nmsg     .text "counter", counter';
        const { documentIndex, getText } = withText([{ source, uri: 'file:///str2.asm' }]);
        const symbol = findSymbolInfo('counter', 'file:///str2.asm', 1, documentIndex)!;
        expect(findSymbolOccurrences(symbol, documentIndex, getText, false)
            .map(o => o.range.start.character)).toEqual([0, 25]);
    });
});
