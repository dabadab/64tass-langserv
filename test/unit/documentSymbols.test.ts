import { describe, it, expect } from 'vitest';
import { SymbolKind, DocumentSymbol } from 'vscode-languageserver/node';
import { buildDocumentSymbols } from '../../src/server/documentSymbols';
import { createDoc } from '../helpers/doc';
import { parseDocument } from '../../src/server/parser';

function outline(source: string): DocumentSymbol[] {
    return buildDocumentSymbols(parseDocument(createDoc(source)));
}

const names = (symbols: DocumentSymbol[]) => symbols.map(s => s.name);
const find = (symbols: DocumentSymbol[], name: string) => symbols.find(s => s.name === name);

describe('buildDocumentSymbols - flat symbols', () => {
    it('lists top-level labels in document order', () => {
        expect(names(outline('first\nsecond\nthird'))).toEqual(['first', 'second', 'third']);
    });

    it('preserves the original casing of the name', () => {
        expect(names(outline('MyLabel\n        nop'))).toEqual(['MyLabel']);
    });

    it('returns an empty outline for a document with no labels', () => {
        expect(outline('        nop\n        rts')).toEqual([]);
    });

    it('maps each kind to a sensible SymbolKind', () => {
        const symbols = outline([
            'codelbl',
            'datalbl .byte 1',
            'constlbl = 1',
            'varlbl .var 2',
            'p .proc',
            '.pend',
            'b .block',
            '.bend',
            'm .macro',
            '.endm',
            'f .function',
            '.endf',
            's .struct',
            '.ends'
        ].join('\n'));

        expect(find(symbols, 'codelbl')!.kind).toBe(SymbolKind.Function);
        expect(find(symbols, 'datalbl')!.kind).toBe(SymbolKind.Field);
        expect(find(symbols, 'constlbl')!.kind).toBe(SymbolKind.Constant);
        expect(find(symbols, 'varlbl')!.kind).toBe(SymbolKind.Variable);
        expect(find(symbols, 'p')!.kind).toBe(SymbolKind.Function);
        expect(find(symbols, 'b')!.kind).toBe(SymbolKind.Namespace);
        expect(find(symbols, 'm')!.kind).toBe(SymbolKind.Function);
        expect(find(symbols, 'f')!.kind).toBe(SymbolKind.Function);
        expect(find(symbols, 's')!.kind).toBe(SymbolKind.Struct);
    });

    it('shows a constant value as the detail', () => {
        expect(find(outline('val = $FF'), 'val')!.detail).toBe('= $FF');
    });

    it('omits anonymous labels', () => {
        const symbols = outline('main\n-\tinx\n\tbne -\n+\trts');
        expect(names(symbols)).toEqual(['main']);
    });
});

describe('buildDocumentSymbols - nesting', () => {
    const NESTED = [
        'outer  .proc',       // 0
        'inner  .proc',       // 1
        'val = 5',            // 2
        'helper',             // 3
        '        rts',        // 4
        '       .pend',       // 5
        'table  .byte 1',     // 6
        '       .pend',       // 7
        'toplevel'            // 8
    ].join('\n');

    it('nests symbols under the scope that contains them', () => {
        const symbols = outline(NESTED);
        expect(names(symbols)).toEqual(['outer', 'toplevel']);

        const outer = find(symbols, 'outer')!;
        expect(names(outer.children!)).toEqual(['inner', 'table']);

        const inner = find(outer.children!, 'inner')!;
        expect(names(inner.children!)).toEqual(['val', 'helper']);
    });

    it('gives a scope a range covering its body, not just its name', () => {
        const outer = find(outline(NESTED), 'outer')!;
        expect(outer.selectionRange.start.line).toBe(0);
        expect(outer.range.start.line).toBe(0);
        // must extend past its own line to cover the nested content
        expect(outer.range.end.line).toBeGreaterThanOrEqual(6);
    });

    it('keeps selectionRange inside range, as the protocol requires', () => {
        const check = (symbols: DocumentSymbol[]) => {
            for (const s of symbols) {
                expect(s.range.start.line).toBeLessThanOrEqual(s.selectionRange.start.line);
                expect(s.range.end.line).toBeGreaterThanOrEqual(s.selectionRange.end.line);
                if (s.children) check(s.children);
            }
        };
        check(outline(NESTED));
    });

    it('nests local symbols under their code label', () => {
        const symbols = outline('main\n_helper = 1\n        lda #_helper\nother');
        expect(names(symbols)).toEqual(['main', 'other']);
        expect(names(find(symbols, 'main')!.children!)).toEqual(['_helper']);
    });

    it('nests local symbols under a code label inside a scope', () => {
        const symbols = outline('p .proc\nmain\n_x = 1\n.pend');
        const main = find(find(symbols, 'p')!.children!, 'main')!;
        expect(names(main.children!)).toEqual(['_x']);
    });

    it('does not nest a label that merely follows a scope', () => {
        const symbols = outline('p .proc\n.pend\nafter');
        expect(names(symbols)).toEqual(['p', 'after']);
    });
});
