import * as path from 'path';
import { pathToFileURL } from 'url';
import { describe, it, expect } from 'vitest';
import { Position } from 'vscode-languageserver/node';
import { getCompletions } from '../../src/server/completions';
import { createDoc, buildIndex } from '../helpers/doc';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'completion');

function docInFixtures(source: string, filename = 'target.asm') {
    return createDoc(source, pathToFileURL(path.join(FIXTURES_DIR, filename)).toString());
}

describe('getCompletions - directives', () => {
    it('suggests directives matching the typed prefix', () => {
        const doc = createDoc('\t.pr');
        const items = getCompletions(doc, Position.create(0, 4), new Map());
        expect(items.map(i => i.label)).toContain('.proc');
    });

    it('suggests scope closers too', () => {
        const doc = createDoc('\t.end');
        const items = getCompletions(doc, Position.create(0, 5), new Map());
        const labels = items.map(i => i.label);
        expect(labels).toContain('.endm');
        expect(labels).toContain('.endproc');
    });

    it('does not suggest directives inside a comment', () => {
        const doc = createDoc('\t; see .pr');
        const items = getCompletions(doc, Position.create(0, 10), new Map());
        expect(items).toHaveLength(0);
    });
});

describe('getCompletions - opcodes', () => {
    it('suggests opcodes as the first token on a line', () => {
        const doc = createDoc('\tld');
        const items = getCompletions(doc, Position.create(0, 3), new Map());
        const labels = items.map(i => i.label);
        expect(labels).toContain('lda');
        expect(labels).toContain('ldx');
        expect(labels).toContain('ldy');
    });

    it('suggests opcodes as the second token after a code label', () => {
        const doc = createDoc('start in');
        const items = getCompletions(doc, Position.create(0, 8), new Map());
        const labels = items.map(i => i.label);
        expect(labels).toContain('inx');
        expect(labels).toContain('inc');
    });

    it('does not suggest opcodes in operand position after a real opcode', () => {
        const doc = createDoc('lda f');
        const items = getCompletions(doc, Position.create(0, 5), new Map());
        expect(items.map(i => i.label)).not.toContain('inx');
    });
});

describe('getCompletions - symbols', () => {
    it('suggests visible labels in operand position', () => {
        const source = 'foo\n        lda f';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///sym.asm' });
        const items = getCompletions(docs[0], Position.create(1, 18), documentIndex);
        expect(items.map(i => i.label)).toContain('foo');
    });

    it('does not suggest out-of-scope local symbols', () => {
        const source = 'a\n_x = 1\nb\n        lda _';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///sym2.asm' });
        // Line 3 is under localScope 'b', _x belongs to localScope 'a'
        const items = getCompletions(docs[0], Position.create(3, 17), documentIndex);
        expect(items.map(i => i.label)).not.toContain('_x');
    });

    it('excludes macro and function names as an opcode operand (bcc target)', () => {
        const source = 'm .macro\n.endm\nfn .function\n.endf\ntarget\n        bcc t';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///sym3.asm' });
        const items = getCompletions(docs[0], Position.create(5, 13), documentIndex);
        const labels = items.map(i => i.label);
        expect(labels).toContain('target');
        expect(labels).not.toContain('m');
        expect(labels).not.toContain('fn');
    });

    it('includes macro/function names for a non-opcode directive argument (e.g. .assert)', () => {
        const source = 'm .macro\n.endm\n        .assert m';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///sym4.asm' });
        const items = getCompletions(docs[0], Position.create(2, 17), documentIndex);
        expect(items.map(i => i.label)).toContain('m');
    });

    it('offers no completions for .enc arguments', () => {
        const source = 'screen_enc\n        .enc s';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///sym5.asm' });
        const items = getCompletions(docs[0], Position.create(1, 14), documentIndex);
        expect(items).toHaveLength(0);
    });

    it('offers no completions for .cpu arguments', () => {
        const { documentIndex, docs } = buildIndex({ source: '        .cpu 6', uri: 'file:///sym6.asm' });
        const items = getCompletions(docs[0], Position.create(0, 14), documentIndex);
        expect(items).toHaveLength(0);
    });

    it('suggests .function parameters inside the function body', () => {
        const source = 'ptr_set .function ptr, val\n        lda p\n.endf';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///params.asm' });
        const items = getCompletions(docs[0], Position.create(1, 13), documentIndex);
        const labels = items.map(i => i.label);
        // Prefix narrowing is left to the client, per LSP convention - both are returned
        expect(labels).toContain('ptr');
        expect(labels).toContain('val');
    });

    it('suggests .macro parameters inside the macro body', () => {
        const source = 'm .macro a, b\n        lda a\n.endm';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///params2.asm' });
        const items = getCompletions(docs[0], Position.create(1, 13), documentIndex);
        expect(items.map(i => i.label)).toContain('b');
    });

    it('does not suggest parameters outside the function/macro body', () => {
        const source = 'ptr_set .function ptr, val\n.endf\n        lda p';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///params3.asm' });
        const items = getCompletions(docs[0], Position.create(2, 13), documentIndex);
        expect(items.map(i => i.label)).not.toContain('ptr');
    });
});

describe('getCompletions - .include file paths', () => {
    it('suggests matching source files and filters out non-source files', () => {
        const doc = docInFixtures('\t.include "');
        const items = getCompletions(doc, Position.create(0, 11), new Map());
        const labels = items.map(i => i.label);
        expect(labels).toContain('main.asm');
        expect(labels).toContain('other.asm');
        expect(labels).toContain('sub/');
        expect(labels).not.toContain('notes.txt');
        expect(labels).not.toContain('data.bin');
    });

    it('filters by the typed filename prefix', () => {
        const doc = docInFixtures('\t.include "ot');
        const items = getCompletions(doc, Position.create(0, 13), new Map());
        expect(items.map(i => i.label)).toEqual(['other.asm']);
    });

    it('does not filter by extension for .binary', () => {
        const doc = docInFixtures('\t.binary "');
        const items = getCompletions(doc, Position.create(0, 10), new Map());
        const labels = items.map(i => i.label);
        expect(labels).toContain('data.bin');
        expect(labels).toContain('notes.txt');
    });

    it('lists a subdirectory contents when the partial path includes it', () => {
        const doc = docInFixtures('\t.include "sub/');
        const items = getCompletions(doc, Position.create(0, 15), new Map());
        expect(items.map(i => i.label)).toContain('nested.asm');
    });

    it('does not suggest files once the string is already closed', () => {
        const doc = docInFixtures('\t.include "main.asm" ; ');
        const items = getCompletions(doc, Position.create(0, 24), new Map());
        expect(items).toHaveLength(0);
    });
});

describe('completion across compilation units', () => {
    const OTHER = 'file:///other/the_forest.asm';
    const MINE = 'file:///mine/main.asm';

    function setup() {
        return buildIndex(
            { source: 'start\n        lda ', uri: MINE },
            { source: 'stop_X  = 1\nstop_Y  = 2', uri: OTHER },
        );
    }

    it('does not offer symbols from an unrelated file', () => {
        const { documentIndex, docs } = setup();
        const items = getCompletions(docs[0], Position.create(1, 12), documentIndex,
            { visibleUris: new Set([MINE]) });
        expect(items.map(i => i.label)).not.toContain('stop_X');
    });

    it('still offers symbols from the same file', () => {
        const { documentIndex, docs } = setup();
        const items = getCompletions(docs[0], Position.create(1, 12), documentIndex,
            { visibleUris: new Set([MINE]) });
        expect(items.map(i => i.label)).toContain('start');
    });

    it('offers symbols from a file in the same unit', () => {
        const { documentIndex, docs } = setup();
        const items = getCompletions(docs[0], Position.create(1, 12), documentIndex,
            { visibleUris: new Set([MINE, OTHER]) });
        expect(items.map(i => i.label)).toContain('stop_X');
    });

    it('falls back to the whole index when no unit is given', () => {
        // Keeps the old behaviour for callers that have no include graph.
        const { documentIndex, docs } = setup();
        expect(getCompletions(docs[0], Position.create(1, 12), documentIndex).map(i => i.label))
            .toContain('stop_X');
    });
});

describe('nothing is completed after a comma in an operand', () => {
    /** Complete at the end of `line`, with the document indexed for `cpu`. */
    function completeAtEnd(line: string, cpu = '6502', extra = '') {
        const source = `tbl     .byte 0\nstop_X  = 1\n${extra}${line}`;
        const { documentIndex, docs } = buildIndex({ source });
        // Re-index under the requested CPU by prepending a .cpu directive instead
        // of reaching into the index.
        const withCpu = buildIndex({ source: `        .cpu "${cpu}"\n${source}` });
        const doc = cpu === '6502' ? docs[0] : withCpu.docs[0];
        const index = cpu === '6502' ? documentIndex : withCpu.documentIndex;
        const lineNum = doc.getText().split('\n').length - 1;
        return getCompletions(doc, Position.create(lineNum, line.length), index)
            .map(i => i.label);
    }

    // Only an index register can follow the comma, and those are single letters -
    // so a suggestion can only arrive after it would have been useful, where it
    // just intercepts Enter. Nothing is offered instead.
    it.each([
        ['lda tbl,', '        lda tbl,'],
        ['ldx tbl,', '        ldx tbl,'],
        ['inc tbl,', '        inc tbl,'],
        ['lda (tbl,', '        lda (tbl,'],
        ['lda (tbl),', '        lda (tbl),'],
    ])('offers nothing at "%s"', (_name, line) => {
        expect(completeAtEnd(line)).toEqual([]);
    });

    it('offers nothing once a register has been typed either', () => {
        // The reported bug: the popup appeared here, holding the Enter key.
        expect(completeAtEnd('        lda tbl,y')).toEqual([]);
        expect(completeAtEnd('        lda tbl,x')).toEqual([]);
    });

    it('never offers a label where an index belongs', () => {
        for (const line of ['        lda tbl,', '        lda tbl,y', '        lda (tbl),']) {
            expect(completeAtEnd(line)).not.toContain('stop_X');
            expect(completeAtEnd(line)).not.toContain('tbl');
        }
    });

    it('tolerates a space after the comma', () => {
        expect(completeAtEnd('        lda tbl, ')).toEqual([]);
    });

    it('stays silent on targets with extra index registers', () => {
        // The suppression is still decided per CPU and per bracket position.
        expect(completeAtEnd('        lda tbl,', '65816')).toEqual([]);
        expect(completeAtEnd('        lda (tbl,', '65816')).toEqual([]);
        expect(completeAtEnd('        lda (tbl),', '4510')).toEqual([]);
    });

    it('falls back to symbols where the operand is an address, not an index', () => {
        // "jmp $1234," has no register form, so a label is genuinely valid there.
        expect(completeAtEnd('        jmp tbl,')).toContain('tbl');
    });

    it('still completes symbols after a comma in a data directive', () => {
        expect(completeAtEnd('        .byte 1,')).toContain('tbl');
    });

    it('still completes symbols where there is no comma', () => {
        expect(completeAtEnd('        lda ')).toContain('tbl');
    });

    it('is not confused by a comma inside a string', () => {
        expect(completeAtEnd('        .text "a,b" ')).toContain('tbl');
    });
});
