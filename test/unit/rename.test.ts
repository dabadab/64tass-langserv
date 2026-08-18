import { describe, it, expect } from 'vitest';
import { WorkspaceEdit } from 'vscode-languageserver/node';
import { computeRenameEdits, findSymbolInfo, isRenameable, isValidSymbolName } from '../../src/server/symbols';
import { buildIndex } from '../helpers/doc';

// Helper: build a getDocumentText function backed by the (immutable) source docs.
function textLookup(docs: { uri: string; getText(): string }[]) {
    const map = new Map(docs.map(d => [d.uri, d.getText()]));
    return (uri: string) => map.get(uri) ?? null;
}

function codeChanges(edit: WorkspaceEdit | null, uri: string) {
    return edit?.changes?.[uri] ?? [];
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

describe('computeRenameEdits - per-document case sensitivity', () => {
    it('uses the document\'s own indexed case sensitivity, not a stale caller-supplied default', () => {
        // Indexed as case-sensitive: "Item" is stored with its exact case.
        const source = 'Item\n        jsr Item';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///cs.asm', caseSensitive: true });
        const getText = textLookup(docs);

        const symbol = findSymbolInfo('Item', docs[0].uri, 0, documentIndex, true);
        expect(symbol).not.toBeNull();

        // Caller passes a stale/wrong default (false) - if computeRenameEdits blindly
        // trusted it instead of reading this document's own stored setting, the
        // case-sensitive lookup for "Item" would fail (findSymbolInfo would lowercase
        // it to "item", which doesn't equal the exact-case stored label "Item").
        const edit = computeRenameEdits(symbol!, 'Element', documentIndex, getText, false);
        const edits = codeChanges(edit, docs[0].uri);

        expect(edits).toHaveLength(2); // definition + the jsr reference
        expect(edits.every(e => e.newText === 'Element')).toBe(true);
    });
});

describe('computeRenameEdits - anonymous labels', () => {
    // Renaming an anonymous label used to rewrite its definition while leaving
    // every "bne -" pointing at nothing, silently breaking the file.
    const source = 'main\n-\tinx\n\tbne -\n\tbne -';

    it('refuses to rename a backward anonymous label', () => {
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///anon.asm' });
        const getText = textLookup(docs);

        const symbol = findSymbolInfo('-', docs[0].uri, 2, documentIndex);
        expect(symbol).not.toBeNull();
        expect(symbol!.isAnonymous).toBe(true);

        expect(computeRenameEdits(symbol!, 'newname', documentIndex, getText, false)).toBeNull();
    });

    it('refuses to rename a forward anonymous label', () => {
        const fwd = 'main\n\tbcc +\n+\tinx';
        const { documentIndex, docs } = buildIndex({ source: fwd, uri: 'file:///anon2.asm' });
        const getText = textLookup(docs);

        const symbol = findSymbolInfo('+', docs[0].uri, 1, documentIndex);
        expect(symbol).not.toBeNull();
        expect(computeRenameEdits(symbol!, 'newname', documentIndex, getText, false)).toBeNull();
    });

    it('isRenameable rejects anonymous labels but accepts named ones', () => {
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///anon3.asm' });

        const anon = findSymbolInfo('-', docs[0].uri, 2, documentIndex);
        expect(isRenameable(anon!)).toBe(false);

        const named = findSymbolInfo('main', docs[0].uri, 2, documentIndex);
        expect(isRenameable(named!)).toBe(true);
    });

    it('still renames a normal label in a file that contains anonymous labels', () => {
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///anon4.asm' });
        const getText = textLookup(docs);

        const symbol = findSymbolInfo('main', docs[0].uri, 0, documentIndex);
        const edit = computeRenameEdits(symbol!, 'entry', documentIndex, getText, false);
        expect(edit).not.toBeNull();
        expect(codeChanges(edit, docs[0].uri)).toHaveLength(1);
    });
});

describe('computeRenameEdits - across files', () => {
    // A symbol defined in one file and used in another: both must be edited.
    const MAIN = 'main\n        jsr shared\n        lda #shared';
    const DEP = 'shared\n        rts';

    function twoFiles() {
        const built = buildIndex(
            { source: MAIN, uri: 'file:///main.asm' },
            { source: DEP, uri: 'file:///dep.asm' }
        );
        const texts = new Map([['file:///main.asm', MAIN], ['file:///dep.asm', DEP]]);
        return { ...built, getText: (uri: string) => texts.get(uri) ?? null };
    }

    it('edits the definition in its own file and the references in another', () => {
        const { documentIndex, getText } = twoFiles();
        const symbol = findSymbolInfo('shared', 'file:///main.asm', 1, documentIndex);
        expect(symbol!.uri).toBe('file:///dep.asm');

        const edit = computeRenameEdits(symbol!, 'renamed', documentIndex, getText, false);
        expect(codeChanges(edit, 'file:///dep.asm')).toHaveLength(1);   // the definition
        expect(codeChanges(edit, 'file:///main.asm')).toHaveLength(2);  // both references
    });

    it('skips a document whose text cannot be read', () => {
        const { documentIndex } = twoFiles();
        const symbol = findSymbolInfo('shared', 'file:///main.asm', 1, documentIndex);
        // Only dep.asm is readable; main.asm's references must simply be absent
        const onlyDep = (uri: string) => uri === 'file:///dep.asm' ? DEP : null;

        const edit = computeRenameEdits(symbol!, 'renamed', documentIndex, onlyDep, false);
        expect(codeChanges(edit, 'file:///dep.asm')).toHaveLength(1);
        expect(codeChanges(edit, 'file:///main.asm')).toHaveLength(0);
    });
});

describe('computeRenameEdits - comment occurrences', () => {
    // Comment edits go through documentChanges with a needsConfirmation
    // annotation, so the editor shows them in a preview unchecked by default.
    const source = 'start\t; start of the program\n        jsr start';

    it('returns documentChanges with an annotation when comments match', () => {
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///c.asm' });
        const getText = textLookup(docs);
        const symbol = findSymbolInfo('start', docs[0].uri, 1, documentIndex);

        const edit = computeRenameEdits(symbol!, 'begin', documentIndex, getText, false)!;
        expect(edit.changes).toBeUndefined();
        expect(edit.documentChanges).toBeDefined();
        expect(edit.changeAnnotations?.['commentRename']?.needsConfirmation).toBe(true);
    });

    it('annotates only the comment occurrence, not the code ones', () => {
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///c2.asm' });
        const getText = textLookup(docs);
        const symbol = findSymbolInfo('start', docs[0].uri, 1, documentIndex);

        const edit = computeRenameEdits(symbol!, 'begin', documentIndex, getText, false)!;
        const edits = (edit.documentChanges![0] as { edits: { annotationId?: string }[] }).edits;
        const annotated = edits.filter(e => e.annotationId === 'commentRename');
        const plain = edits.filter(e => e.annotationId === undefined);

        expect(annotated).toHaveLength(1);   // the word inside the comment
        expect(plain).toHaveLength(2);       // definition + the jsr reference
    });

    it('uses the plain changes format when no comment matches', () => {
        const noComment = 'start\n        jsr start';
        const { documentIndex, docs } = buildIndex({ source: noComment, uri: 'file:///c3.asm' });
        const getText = textLookup(docs);
        const symbol = findSymbolInfo('start', docs[0].uri, 1, documentIndex);

        const edit = computeRenameEdits(symbol!, 'begin', documentIndex, getText, false)!;
        expect(edit.changes).toBeDefined();
        expect(edit.documentChanges).toBeUndefined();
    });
});

describe('isValidSymbolName', () => {
    // Verified against the assembler: it accepts the first group, rejects the second
    it.each(['foo', '_foo', 'foo123', 'FooBar', '_', 'a1_b2'])('accepts %s', (name) => {
        expect(isValidSymbolName(name)).toBe(true);
    });

    it.each(['1abc', 'foo-bar', 'foo bar', '', '.foo', 'foo.bar', '+', 'foo!'])('rejects %s', (name) => {
        expect(isValidSymbolName(name)).toBe(false);
    });
});

describe('computeRenameEdits - invalid new names', () => {
    // Renaming to an unusable name would write un-assemblable text at every
    // reference, so it is refused outright rather than half-applied.
    const source = 'start\n        jsr start';

    it.each(['1abc', 'foo-bar', 'foo bar', '', 'foo.bar'])('refuses to rename to %s', (newName) => {
        const { documentIndex, docs } = buildIndex({ source, uri: `file:///inv-${newName || 'empty'}.asm` });
        const getText = textLookup(docs);
        const symbol = findSymbolInfo('start', docs[0].uri, 1, documentIndex);

        expect(computeRenameEdits(symbol!, newName, documentIndex, getText, false)).toBeNull();
    });

    it('still allows a valid new name', () => {
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///valid.asm' });
        const getText = textLookup(docs);
        const symbol = findSymbolInfo('start', docs[0].uri, 1, documentIndex);

        const edit = computeRenameEdits(symbol!, 'begin', documentIndex, getText, false);
        expect(codeChanges(edit, docs[0].uri)).toHaveLength(2);
    });
});
