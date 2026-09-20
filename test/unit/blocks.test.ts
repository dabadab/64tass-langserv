import { describe, it, expect } from 'vitest';
import { blockDirectivesOn, findWeakLines } from '../../src/server/blocks';

describe('blockDirectivesOn', () => {
    it('finds an opener and a closer', () => {
        expect(blockDirectivesOn('outer   .proc').opened).toEqual(['.proc']);
        expect(blockDirectivesOn('        .pend').closed).toEqual(['.pend']);
    });

    it('ignores a directive inside a comment', () => {
        expect(blockDirectivesOn('        lda #1   ; restore with .pend later').closed).toEqual([]);
        expect(blockDirectivesOn('        lda #1   ; a .block here').opened).toEqual([]);
    });

    it('ignores a directive inside a string', () => {
        expect(blockDirectivesOn('        .text "use .bend to close"').closed).toEqual([]);
        expect(blockDirectivesOn('        .text "a .proc b"').opened).toEqual([]);
    });

    it('accepts a directive straight after a label colon', () => {
        // "outer:.proc" is valid (verified against the assembler).
        expect(blockDirectivesOn('outer:.proc').opened).toEqual(['.proc']);
    });

    it('does not read a dotted reference as a directive', () => {
        expect(blockDirectivesOn('        lda outer.proc').opened).toEqual([]);
    });

    it('reports both when a line opens and closes', () => {
        const { opened, closed } = blockDirectivesOn('        .block\n'.trim() + ' .bend');
        expect(opened).toContain('.block');
        expect(closed).toContain('.bend');
    });

    it('is case-insensitive', () => {
        expect(blockDirectivesOn('OUTER   .PROC').opened).toEqual(['.proc']);
    });
});

describe('findWeakLines', () => {
    it('covers the body, not the delimiters', () => {
        expect([...findWeakLines(['        .weak', 'a       = 1', '        .endweak', 'b       = 2'])])
            .toEqual([1]);
    });

    it('nests', () => {
        const lines = ['        .weak', 'a = 1', '        .weak', 'b = 2', '        .endweak', 'c = 3', '        .endweak', 'd = 4'];
        // The inner pair is inside the outer region, and counts as such.
        expect([...findWeakLines(lines)]).toEqual([1, 2, 3, 4, 5]);
    });

    it('ignores one written in a comment or a string', () => {
        expect([...findWeakLines(['        nop ; .weak', '        .text ".weak"', 'a = 1'])]).toEqual([]);
    });
});
