import { describe, it, expect } from 'vitest';
import { parseOperand, indexRegistersFor, findAddressingProblem, addressExpressionOf, bytesForValue } from '../../src/server/operands';

describe('parseOperand', () => {
    it('reads a plain address', () => {
        expect(parseOperand('$1234')).toEqual({ kind: 'address', shape: { bracket: '', inside: null, outside: null } });
    });

    it('reads an index after a comma', () => {
        expect(parseOperand('$10,x')).toEqual({ kind: 'address', shape: { bracket: '', inside: null, outside: 'x' } });
    });

    it('separates an index inside the brackets from one after them', () => {
        expect(parseOperand('($10,x)')).toEqual({ kind: 'address', shape: { bracket: '(', inside: 'x', outside: null } });
        expect(parseOperand('($10),y')).toEqual({ kind: 'address', shape: { bracket: '(', inside: null, outside: 'y' } });
    });

    it('reads both at once, as the 65816 stack form has', () => {
        expect(parseOperand('($10,s),y')).toEqual({ kind: 'address', shape: { bracket: '(', inside: 's', outside: 'y' } });
    });

    it('keeps the bracket character', () => {
        expect(parseOperand('[$10],y')).toEqual({ kind: 'address', shape: { bracket: '[', inside: null, outside: 'y' } });
    });

    it('does not mistake a parenthesised expression for an indirection', () => {
        // `lda (lbl)+1` assembles as a plain address (verified) - the brackets only
        // make it indirect when they wrap the whole operand.
        expect(parseOperand('(lbl)+1')).toEqual({ kind: 'address', shape: { bracket: '', inside: null, outside: null } });
    });

    it('marks the forms it does not model', () => {
        expect(parseOperand('')).toEqual({ kind: 'implied' });
        expect(parseOperand('#$10')).toEqual({ kind: 'immediate' });
        expect(parseOperand('$01,$02')).toEqual({ kind: 'multi' });
        expect(parseOperand('0,$10,lbl')).toEqual({ kind: 'multi' });
    });
});

describe('indexRegistersFor', () => {
    it('is per position, not per opcode alone', () => {
        expect(indexRegistersFor('6502i', 'lda', 'plain')).toEqual(['x', 'y']);
        expect(indexRegistersFor('6502i', 'lda', 'inside')).toEqual(['x']);
        expect(indexRegistersFor('6502i', 'lda', 'after-close')).toEqual(['y']);
    });

    it('still sees an index inside a pattern that also has one outside', () => {
        // `($10,s),y`: the inside 's' used to be lost once shapes carried one index.
        expect(indexRegistersFor('65816', 'lda', 'inside')).toContain('s');
    });
});

describe('findAddressingProblem', () => {
    it('reports an index the mnemonic has no mode for', () => {
        expect(findAddressingProblem('6502i', 'ldx', '$10,x')?.message)
            .toBe("no x indexed addressing mode for opcode 'ldx'");
    });

    it('reports an index in the wrong position', () => {
        expect(findAddressingProblem('6502i', 'lda', '($10),x')?.message)
            .toBe("no indirect x indexed addressing mode for opcode 'lda'");
        expect(findAddressingProblem('6502i', 'lda', '($10,y)')?.message)
            .toBe("no y indexed indirect addressing mode for opcode 'lda'");
    });

    it('reports a combination that exists only as separate modes', () => {
        expect(findAddressingProblem('6502i', 'lda', '($10,x),y')?.message)
            .toBe("no x indexed indirect y indexed addressing mode for opcode 'lda'");
    });

    it('accepts every form the mnemonic does have', () => {
        for (const operand of ['$10', '$1234', '$10,x', '$1234,y', '($10,x)', '($10),y']) {
            expect(findAddressingProblem('6502i', 'lda', operand)).toBeNull();
        }
    });

    it('says nothing about immediates, implied forms or register operands', () => {
        expect(findAddressingProblem('6502i', 'lda', '#$1234')).toBeNull();
        expect(findAddressingProblem('6502i', 'nop', '')).toBeNull();
        expect(findAddressingProblem('6502i', 'asl', 'a')).toBeNull();
    });

    it('says nothing about the bbr/mvn families', () => {
        expect(findAddressingProblem('r65c02', 'bbr', '0,$10,lbl')).toBeNull();
        expect(findAddressingProblem('65816', 'mvn', '$01,$02')).toBeNull();
    });

    it('leaves the size and bank suffixes alone', () => {
        // `lda $10,b` assembles - ,b is an addressing-size override, not an index.
        expect(findAddressingProblem('6502i', 'lda', '$10,b')).toBeNull();
    });

    it('says nothing about a mnemonic this target does not have', () => {
        expect(findAddressingProblem('6502i', 'bra', '($10),x')).toBeNull();
    });

    it('judges against the target it is given, whatever other targets have', () => {
        // `lda $10,s` is a real 65816 mode and no 6502 one, and a 6502i file is
        // told so: the checks follow the target in force rather than waiting for
        // one to be declared.
        expect(findAddressingProblem('6502i', 'lda', '$10,s')).not.toBeNull();
        expect(findAddressingProblem('65816', 'lda', '$10,s')).toBeNull();
    });
});

describe('addressExpressionOf', () => {
    it('takes the address out of the operand', () => {
        expect(addressExpressionOf('$c000,x')).toBe('$c000');
        expect(addressExpressionOf('($10),y')).toBe('$10');
        expect(addressExpressionOf('($10,x)')).toBe('$10');
        expect(addressExpressionOf('[label],z')).toBe('label');
        expect(addressExpressionOf(' $1234 ')).toBe('$1234');
    });

    it('keeps brackets that are arithmetic rather than the operand\'s', () => {
        // `sty ($100)/2,x` assembles - the address is $80. Cutting at the first
        // `)` evaluated `$100` and reported a line the assembler takes.
        expect(addressExpressionOf('($100)/2,x')).toBe('($100)/2');
        expect(addressExpressionOf('(lbl+1)*2')).toBe('(lbl+1)*2');
        expect(addressExpressionOf('($1234)')).toBe('$1234');
    });

    it('leaves immediates to the immediate check', () => {
        expect(addressExpressionOf('#$12')).toBeNull();
        expect(addressExpressionOf('')).toBeNull();
    });
});

describe('bytesForValue', () => {
    it('counts the bytes a value needs', () => {
        expect(bytesForValue(0xff)).toBe(1);
        expect(bytesForValue(0x100)).toBe(2);
        expect(bytesForValue(0xffff)).toBe(2);
        expect(bytesForValue(0x10000)).toBe(3);
    });

    it('has nothing to say about a negative or fractional value', () => {
        expect(bytesForValue(-1)).toBeNull();
        expect(bytesForValue(1.5)).toBeNull();
    });
});

describe('findAddressingProblem - operand width', () => {
    // `sty` has $hh,x but no $hhhh,x, so the shape is right and the width is not.
    // All of these were checked against the assembler.
    it('reports an address too wide for the only form of its shape', () => {
        expect(findAddressingProblem('6502i', 'sty', '$c000,x', 0xc000)?.message)
            .toBe("not a direct page address '$c000'");
        expect(findAddressingProblem('6502i', 'stx', '$c000,y', 0xc000)?.message)
            .toBe("not a direct page address '$c000'");
    });

    it('accepts the same shape at a width the mnemonic has', () => {
        expect(findAddressingProblem('6502i', 'sty', '$10,x', 0x10)).toBeNull();
        expect(findAddressingProblem('6502i', 'ldy', '$c000,x', 0xc000)).toBeNull();
        expect(findAddressingProblem('6502i', 'lda', '$c000,x', 0xc000)).toBeNull();
    });

    it('says nothing when the value is unknown', () => {
        // A forward reference or an external symbol: the width cannot be judged.
        expect(findAddressingProblem('6502i', 'sty', 'screen,x')).toBeNull();
        expect(findAddressingProblem('6502i', 'sty', 'screen,x', null)).toBeNull();
    });

    it('accepts a value narrower than the mode, which the assembler pads', () => {
        expect(findAddressingProblem('6502i', 'jsr', '$10', 0x10)).toBeNull();
    });

    it('reports a value past every form the mnemonic has', () => {
        expect(findAddressingProblem('6502i', 'lda', '$123456', 0x123456)?.message)
            .toBe("'$123456' does not fit in 16 bits");
    });

    it('says nothing on a target whose direct page can be moved', () => {
        // `.dpage $c000` makes `sty $c010,x` assemble on the 65816 (verified), so
        // the value alone cannot decide there.
        expect(findAddressingProblem('65816', 'sty', '$c000,x', 0xc000)).toBeNull();
    });

    it('leaves a relative branch alone, which carries no address width', () => {
        expect(findAddressingProblem('6502i', 'beq', '$c000', 0xc000)).toBeNull();
    });

    it('is per target: the 65CE02 has the absolute form the 6502 lacks', () => {
        expect(findAddressingProblem('65ce02', 'sty', '$c000,x', 0xc000)).toBeNull();
    });
});
