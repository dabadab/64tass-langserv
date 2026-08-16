import { describe, it, expect } from 'vitest';
import { WorkspaceEdit } from 'vscode-languageserver/node';
import { computeRenameEdits, findSymbolInfo } from '../../src/server/symbols';
import { buildIndex } from '../helpers/doc';

// Helper: build a getDocumentText function backed by the (immutable) source docs.
function textLookup(docs: { uri: string; getText(): string }[]) {
    const map = new Map(docs.map(d => [d.uri, d.getText()]));
    return (uri: string) => map.get(uri) ?? null;
}

function codeChanges(edit: WorkspaceEdit, uri: string) {
    return edit.changes?.[uri] ?? [];
}

describe('computeRenameEdits - .proc scope rename (regression for HI/LO/random.init bug)', () => {
    const source = [
        'random\t.proc',
        '',
        '\tLO: .byte $00',
        '\tHI: .byte $00',
        'init:',
        '\trts',
        '.pend',
        '',
        '\tjsr random.init',
        '\tlda random.HI'
    ].join('\n');

    it('renaming the proc label only touches the scope-prefix segment, not the member', () => {
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///proc.asm' });
        const getText = textLookup(docs);

        const symbol = findSymbolInfo('random', docs[0].uri, 0, documentIndex);
        expect(symbol).not.toBeNull();

        const edit = computeRenameEdits(symbol!, 'qwe', documentIndex, getText, false);
        const edits = codeChanges(edit, docs[0].uri);

        // Definition line + "random.init" prefix + "random.HI" prefix
        expect(edits).toHaveLength(3);
        expect(edits.every(e => e.newText === 'qwe')).toBe(true);

        // The definition
        expect(edits.some(e => e.range.start.line === 0 && e.range.start.character === 0)).toBe(true);
        // "jsr random.init" - "random" starts at column 6 (after "\tjsr ")
        const jsrLine = source.split('\n')[8];
        const randomCol = jsrLine.indexOf('random');
        expect(edits.some(e => e.range.start.line === 8 && e.range.start.character === randomCol)).toBe(true);
        // "lda random.HI"
        const ldaLine = source.split('\n')[9];
        const randomCol2 = ldaLine.indexOf('random');
        expect(edits.some(e => e.range.start.line === 9 && e.range.start.character === randomCol2)).toBe(true);

        // "init" and "HI" segments must NOT be renamed
        const initCol = jsrLine.indexOf('init');
        expect(edits.some(e => e.range.start.line === 8 && e.range.start.character === initCol)).toBe(false);
    });

    it('renaming the member via a scope-qualified reference only touches the member segment', () => {
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///proc.asm' });
        const getText = textLookup(docs);

        const symbol = findSymbolInfo('random.init', docs[0].uri, 8, documentIndex);
        expect(symbol).not.toBeNull();
        expect(symbol!.name).toBe('init');

        const edit = computeRenameEdits(symbol!, 'start', documentIndex, getText, false);
        const edits = codeChanges(edit, docs[0].uri);

        // Definition ("init:") + the "init" segment of "random.init"
        expect(edits).toHaveLength(2);

        const jsrLine = source.split('\n')[8];
        const randomCol = jsrLine.indexOf('random');
        // "random" prefix must be untouched
        expect(edits.some(e => e.range.start.character === randomCol)).toBe(false);
    });

    it('HI and LO (colon + data directive labels) are indexed and renameable', () => {
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///proc.asm' });
        const getText = textLookup(docs);

        const hi = findSymbolInfo('HI', docs[0].uri, 3, documentIndex);
        expect(hi).not.toBeNull();
        expect(hi!.scopePath).toBe('random');

        const edit = computeRenameEdits(hi!, 'hival', documentIndex, getText, false);
        const edits = codeChanges(edit, docs[0].uri);

        // Definition ("HI:") + the "HI" segment of "random.HI"
        expect(edits).toHaveLength(2);
        expect(edits.every(e => e.newText === 'hival')).toBe(true);
    });
});

describe('computeRenameEdits - local symbols', () => {
    it('only renames references within the same localScope', () => {
        const source = [
            'a',
            '_x = 1',
            '        lda #_x',
            'b',
            '_x = 2',
            '        lda #_x'
        ].join('\n');
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///local.asm' });
        const getText = textLookup(docs);

        const symbol = findSymbolInfo('_x', docs[0].uri, 1, documentIndex);
        expect(symbol).not.toBeNull();

        const edit = computeRenameEdits(symbol!, '_y', documentIndex, getText, false);
        const edits = codeChanges(edit, docs[0].uri);

        // Definition on line 1 + reference on line 2 only (not the unrelated _x under scope 'b')
        expect(edits).toHaveLength(2);
        expect(edits.some(e => e.range.start.line === 1)).toBe(true);
        expect(edits.some(e => e.range.start.line === 2)).toBe(true);
        expect(edits.some(e => e.range.start.line === 4)).toBe(false);
        expect(edits.some(e => e.range.start.line === 5)).toBe(false);
    });
});
