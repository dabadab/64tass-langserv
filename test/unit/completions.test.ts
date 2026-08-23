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
    const OTHER = 'file:///other/elsewhere.asm';
    const MINE = 'file:///mine/main.asm';

    function setup() {
        return buildIndex(
            { source: 'start\n        lda ', uri: MINE },
            { source: 'far_symbol  = 1\nstop_Y  = 2', uri: OTHER },
        );
    }

    it('does not offer symbols from an unrelated file', () => {
        const { documentIndex, docs } = setup();
        const items = getCompletions(docs[0], Position.create(1, 12), documentIndex,
            { visibleUris: new Set([MINE]) });
        expect(items.map(i => i.label)).not.toContain('far_symbol');
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
        expect(items.map(i => i.label)).toContain('far_symbol');
    });

    it('falls back to the whole index when no unit is given', () => {
        // Keeps the old behaviour for callers that have no include graph.
        const { documentIndex, docs } = setup();
        expect(getCompletions(docs[0], Position.create(1, 12), documentIndex).map(i => i.label))
            .toContain('far_symbol');
    });
});

describe('index register completion after a comma', () => {
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

    it('offers only X and Y after "lda tbl,"', () => {
        expect(completeAtEnd('        lda tbl,')).toEqual(['x', 'y']);
    });

    it('does not offer labels there', () => {
        // The reported bug: any visible symbol was suggested as an index.
        expect(completeAtEnd('        lda tbl,')).not.toContain('far_symbol');
        expect(completeAtEnd('        lda tbl,')).not.toContain('tbl');
    });

    it('offers only Y for ldx, which has no X-indexed form', () => {
        expect(completeAtEnd('        ldx tbl,')).toEqual(['y']);
    });

    it('offers only X for inc', () => {
        expect(completeAtEnd('        inc tbl,')).toEqual(['x']);
    });

    it('offers X inside brackets and Y outside them', () => {
        expect(completeAtEnd('        lda (tbl,')).toEqual(['x']);
        expect(completeAtEnd('        lda (tbl),')).toEqual(['y']);
    });

    it('adds the stack register on the 65816', () => {
        expect(completeAtEnd('        lda tbl,', '65816')).toEqual(['s', 'x', 'y']);
    });

    it('adds Z on the 4510, but only where it is valid', () => {
        // Verified: "lda $10,z" is rejected, "lda ($10),z" is accepted - Z only
        // indexes after a closing bracket.
        expect(completeAtEnd('        lda tbl,', '4510')).toEqual(['x', 'y']);
        expect(completeAtEnd('        lda (tbl),', '4510')).toEqual(['y', 'z']);
    });

    it('offers the stack register only inside brackets on the 65816', () => {
        expect(completeAtEnd('        lda (tbl,', '65816')).toEqual(['s', 'x']);
        expect(completeAtEnd('        lda (tbl),', '65816')).toEqual(['y']);
    });

    it('filters by what has been typed', () => {
        expect(completeAtEnd('        lda tbl,y')).toEqual(['y']);
    });

    it('tolerates a space after the comma', () => {
        expect(completeAtEnd('        lda tbl, ')).toEqual(['x', 'y']);
    });

    it('falls back to symbols where the operand is an address, not an index', () => {
        // "jmp $1234," has no register form; the third operand of bbr is a label.
        expect(completeAtEnd('        jmp tbl,')).toContain('tbl');
    });

    it('still completes symbols after a comma in a data directive', () => {
        expect(completeAtEnd('        .byte 1,')).toContain('tbl');
    });

    it('still completes symbols where there is no comma', () => {
        expect(completeAtEnd('        lda ')).toContain('tbl');
    });

    it('is not confused by a comma inside a string', () => {
        expect(completeAtEnd('        .text "a,b" ')).not.toEqual(['x', 'y']);
    });
});

describe('opcode completion follows the CPU', () => {
    /** Complete `line` in a document whose .cpu directive selects `cpu`. */
    function completeAtEnd(line: string, cpu: string) {
        const source = `        .cpu "${cpu}"\n${line}`;
        const { documentIndex, docs } = buildIndex({ source });
        return getCompletions(docs[0], Position.create(1, line.length), documentIndex)
            .map(i => i.label);
    }

    it('does not offer mnemonics the target does not have', () => {
        // bra/brl/bbr/bsr belong to other targets; a 6502 cannot assemble them.
        const items = completeAtEnd('        b', '6502');
        expect(items).toContain('bne');
        for (const absent of ['bra', 'brl', 'bbr', 'bbs', 'bsr']) {
            expect(items, absent).not.toContain(absent);
        }
    });

    it('offers them where the target does have them', () => {
        expect(completeAtEnd('        b', '65816')).toEqual(expect.arrayContaining(['bra', 'brl']));
        expect(completeAtEnd('        b', 'r65c02')).toEqual(expect.arrayContaining(['bbr', 'bbs', 'bra']));
    });

    it('keeps the undocumented opcodes to 6502i', () => {
        expect(completeAtEnd('        la', '6502i')).toContain('lax');
        expect(completeAtEnd('        la', '6502')).not.toContain('lax');
    });

    it('applies in the opcode slot after a label too', () => {
        const items = completeAtEnd('start   b', '6502');
        expect(items).toContain('bne');
        expect(items).not.toContain('bra');
    });
});

describe('completion after a dot', () => {
    const SOURCE = [
        'panel   .proc',
        'entry',
        '        rts',
        'matrix  .byte 0',
        '_hidden = 1',
        'helper  .macro',
        '        .endm',
        '        .pend',
        'toplevel = 1',
        '        jsr panel.',
    ].join('\n');

    /** Complete at the END of the last line, so renaming a symbol cannot skew it. */
    const atEnd = (source: string) => {
        const { documentIndex, docs } = buildIndex({ source });
        const lines = source.split('\n');
        const line = lines.length - 1;
        return getCompletions(docs[0], Position.create(line, lines[line].length), documentIndex)
            .map(i => i.label);
    };

    it('offers the members of the named scope', () => {
        expect(atEnd(SOURCE)).toEqual(expect.arrayContaining(['entry', 'matrix']));
    });

    it('does not offer symbols from the enclosing scope', () => {
        // The reported bug: "panel." listed top-level symbols, none of which can
        // follow the dot.
        const items = atEnd(SOURCE);
        expect(items).not.toContain('toplevel');
        expect(items).not.toContain('panel');
    });

    it('leaves out local symbols, which a dot cannot reach', () => {
        expect(atEnd(SOURCE)).not.toContain('_hidden');
    });

    it('filters by operand kind after an opcode', () => {
        // A macro inside the scope is not a valid jsr target.
        expect(atEnd(SOURCE)).not.toContain('helper');
    });

    it('offers a macro member where any symbol is valid', () => {
        expect(atEnd(SOURCE.replace('        jsr panel.', '        .byte panel.'))).toContain('helper');
    });

    it('still works once part of the member name is typed', () => {
        expect(atEnd(SOURCE.replace('        jsr panel.', '        jsr panel.en'))).toContain('entry');
    });

    it('resolves a nested scope path', () => {
        const source = [
            'outer   .proc',
            'inner   .proc',
            'deep    .byte 0',
            '        .pend',
            '        .pend',
            '        lda outer.inner.',
        ].join('\n');
        expect(atEnd(source)).toContain('deep');
    });

    it('matches the scope case-insensitively by default', () => {
        expect(atEnd(SOURCE.replace('        jsr panel.', '        jsr PANEL.'))).toContain('entry');
    });

    it('offers a struct instance the members of its type', () => {
        const source = [
            'pt      .struct',
            'posx    .byte 0',
            'posy    .byte 0',
            '        .endstruct',
            'p1      .dstruct pt',
            '        lda p1.',
        ].join('\n');
        expect(atEnd(source)).toEqual(expect.arrayContaining(['posx', 'posy']));
    });

    it('offers a label on a macro call the macro\'s own labels', () => {
        const source = [
            'emit    .macro',
            'target  lda #0',
            '        .endm',
            '        * = $1000',
            'inst    #emit',
            '        sta inst.',
        ].join('\n');
        expect(atEnd(source)).toContain('target');
    });

    it('offers nothing for a scope that does not exist', () => {
        expect(atEnd(SOURCE.replace('        jsr panel.', '        jsr nosuchscope.'))).toEqual([]);
    });
});

describe('completion carries documentation', () => {
    it('attaches a plain constant\'s comment as documentation', () => {
        const source = 'counter = $10   ; how many trees\nstart\n        lda #';
        const { documentIndex, docs } = buildIndex({ source });
        const item = getCompletions(docs[0], Position.create(2, 13), documentIndex)
            .find(i => i.label === 'counter');
        expect(item?.documentation).toBe('how many trees');
    });
});

describe('getCompletions - semicolons inside strings', () => {
    // A ';' in a string literal is not a comment. indexOf(';') treated it as one
    // and silently killed completion for the rest of the line.
    it('still completes after a string containing a semicolon', () => {
        const source = 'counter = 1\nmsg     .text "a;b", ';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///semi.asm' });
        const items = getCompletions(docs[0], Position.create(1, source.split('\n')[1].length), documentIndex);
        expect(items.map(i => i.label)).toContain('counter');
    });

    it('still suppresses completion in a real comment', () => {
        const source = 'counter = 1\n        lda #0 ; set c';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///semi2.asm' });
        const items = getCompletions(docs[0], Position.create(1, source.split('\n')[1].length), documentIndex);
        expect(items).toHaveLength(0);
    });
});
