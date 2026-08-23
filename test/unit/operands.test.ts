import { describe, it, expect } from 'vitest';
import { parseOperand, indexRegistersFor, findAddressingProblem } from '../../src/server/operands';

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

    it('marks a form no target accepts, so the CPU guess cannot excuse it', () => {
        expect(findAddressingProblem('6502i', 'lda', '($10),x')?.universal).toBe(true);
    });

    it('marks a form another target does accept', () => {
        // `lda $10,s` is a real 65816 mode, so on a guessed target it must not be
        // reported at all - only the declared-CPU path may.
        expect(findAddressingProblem('6502i', 'lda', '$10,s')?.universal).toBe(false);
    });
});
