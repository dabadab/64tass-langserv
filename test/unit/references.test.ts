import { describe, it, expect } from 'vitest';
import { DocumentHighlightKind } from 'vscode-languageserver/node';
import { findReferences, findDocumentHighlights, findSymbolOccurrences, findSymbolInfo } from '../../src/server/symbols';
import { buildIndex } from '../helpers/doc';

function withText(sources: { source: string; uri: string }[]) {
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
