import { describe, it, expect } from 'vitest';
import { formatLine, formatDocument, DEFAULT_COLUMNS } from '../../src/server/formatting';
import { Range, Position } from 'vscode-languageserver/node';

const format = (line: string) => formatLine(line, DEFAULT_COLUMNS);

describe('formatLine', () => {
    it('aligns label, mnemonic and operand', () => {
        expect(format('start lda #$01')).toBe('start   lda #$01');
        expect(format('   lda   #$01')).toBe('        lda #$01');
    });

    it('aligns a trailing comment', () => {
        expect(format('        nop ; wait')).toBe('        nop'.padEnd(40) + '; wait');
    });

    it('leaves a line that is already aligned alone', () => {
        expect(format('        lda ($10),y')).toBeNull();
        expect(format('outer   .proc')).toBeNull();
    });

    it('never moves a full-line comment', () => {
        expect(format('; a banner')).toBeNull();
        expect(format('        ; an indented note')).toBeNull();
    });

    it('writes an assignment with a single space, as the sources do', () => {
        expect(format('ZP=$10')).toBe('ZP      = $10');
        expect(format('counter := 5')).toBeNull();
    });

    it('handles the program counter', () => {
        expect(format('*=$1000')).toBe('        *= $1000');
    });

    it('keeps a colon on the label it belongs to', () => {
        expect(format('loop:  inx')).toBe('loop:   inx');
    });

    it('gives an overlong field one space rather than a negative gap', () => {
        expect(format('verylonglabelname   lda #1')).toBe('verylonglabelname lda #1');
    });

    it('treats an indented unknown word as a macro call, not a label', () => {
        // At column 0 the same word reads as a label, and each stays where it is.
        expect(format('    drawsprite 1, 2')).toBe('        drawsprite 1, 2');
        expect(format('sprite #drawsprite 1, 2')).toBe('sprite  #drawsprite 1, 2');
    });

    it('does not disturb an anonymous label', () => {
        expect(format('-       inx')).toBeNull();
        expect(format('-  inx')).toBe('-       inx');
        expect(format('        bne -')).toBeNull();
    });

    it('does not mistake a semicolon inside a string for a comment', () => {
        expect(format('msg .text "a;b", 0')).toBe('msg     .text "a;b", 0');
    });

    it('strips trailing whitespace', () => {
        expect(format('        nop   ')).toBe('        nop');
        expect(format('   ')).toBe('');
    });
});

describe('formatDocument', () => {
    it('edits only the lines that change', () => {
        const source = '        *= $1000\nstart lda #1\n        rts\n';
        const edits = formatDocument(source, DEFAULT_COLUMNS);
        expect(edits).toHaveLength(1);
        expect(edits[0].range.start.line).toBe(1);
        expect(edits[0].newText).toBe('start   lda #1');
    });

    it('stays inside the range it was given', () => {
        const source = 'a lda #1\nb lda #2\nc lda #3';
        const edits = formatDocument(source, DEFAULT_COLUMNS,
            Range.create(Position.create(1, 0), Position.create(1, 8)));
        expect(edits.map(e => e.range.start.line)).toEqual([1]);
    });

    it('leaves a .comment block untouched', () => {
        const source = '        .comment\n   art   here\n        .endc\n';
        expect(formatDocument(source, DEFAULT_COLUMNS).map(e => e.range.start.line)).toEqual([]);
    });

    it('honours custom columns', () => {
        const edits = formatDocument('start lda #1', { mnemonic: 16, operand: 24, comment: 48 });
        expect(edits[0].newText).toBe('start' + ' '.repeat(11) + 'lda' + ' '.repeat(5) + '#1');
    });
});
