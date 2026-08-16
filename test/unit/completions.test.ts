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
