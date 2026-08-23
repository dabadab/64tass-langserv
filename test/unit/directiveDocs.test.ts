import { describe, it, expect } from 'vitest';
import { Position } from 'vscode-languageserver/node';
import { DIRECTIVE_DOCS } from '../../src/server/directiveDocs';
import { directiveHover, buildHover } from '../../src/server/hover';
import { ALL_DIRECTIVES } from '../../src/server/constants';
import { getWordAtPosition } from '../../src/server/symbols';
import { buildIndex } from '../helpers/doc';

const text = (hover: ReturnType<typeof directiveHover>) =>
    String((hover!.contents as { value: string }).value);

describe('directive documentation', () => {
    it('covers every directive the extension recognises', () => {
        // A directive added to the tables without regenerating the docs would
        // hover blank; this is the reminder to re-run the generator.
        const missing = ALL_DIRECTIVES.filter(d => !(`.${d}` in DIRECTIVE_DOCS));
        expect(missing).toEqual([]);
    });

    it('carries a syntax line and a description for each', () => {
        for (const [name, doc] of Object.entries(DIRECTIVE_DOCS)) {
            expect(doc.syntax, name).toContain(name);
            expect(doc.description.length, name).toBeGreaterThan(0);
        }
    });

    it('gives closers of the same block the same description', () => {
        // `.pend` and `.endproc` share one entry in the manual.
        expect(DIRECTIVE_DOCS['.endproc'].description).toBe(DIRECTIVE_DOCS['.pend'].description);
        expect(DIRECTIVE_DOCS['.endproc'].syntax).toBe('.endproc');
    });
});

describe('directiveHover', () => {
    it('shows the syntax, the description and where it came from', () => {
        const hover = directiveHover('.byte');
        expect(text(hover)).toContain('.byte <expression>');
        expect(text(hover)).toContain('Create bytes from 8 bit unsigned constants');
        expect(text(hover)).toContain('64tass manual');
    });

    it('is case-insensitive, as the assembler is', () => {
        expect(text(directiveHover('.BYTE'))).toBe(text(directiveHover('.byte')));
    });

    it('says nothing about a word that is not a directive', () => {
        expect(directiveHover('.mymacro')).toBeNull();
        expect(directiveHover('byte')).toBeNull();
    });

    it('answers for a directive rather than a same-named macro', () => {
        // Verified against the assembler: a macro called `byte` does not take
        // over `.byte`, which still emits a byte.
        const source = 'byte    .macro\n        nop\n        .endm\n        .byte 1';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///dirhover.asm' });
        const word = getWordAtPosition(docs[0], Position.create(3, 10))!;
        expect(word).toBe('.byte');
        expect(text(buildHover(word, docs[0], 3, documentIndex, false, '6502i'))).toContain('Create bytes');
    });

    it('leaves a matched closer to the hover that names its scope', () => {
        const source = 'outer   .proc\n        nop\n        .pend';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///closer.asm' });
        const word = getWordAtPosition(docs[0], Position.create(2, 11))!;
        expect(text(buildHover(word, docs[0], 2, documentIndex, false, '6502i'))).toContain('Closes');
    });

    it('describes an unmatched closer, which has no scope to name', () => {
        const source = '        .pend';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///stray.asm' });
        const word = getWordAtPosition(docs[0], Position.create(0, 11))!;
        expect(text(buildHover(word, docs[0], 0, documentIndex, false, '6502i')))
            .toContain('End of a procedure block');
    });
});
