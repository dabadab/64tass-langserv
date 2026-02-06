import { describe, it, expect } from 'vitest';
import {
    OPCODES,
    SCOPE_OPENERS,
    OPENER_TO_CLOSERS,
    CLOSING_DIRECTIVES,
    FOLDING_PAIRS,
    BUILTINS,
    BUILTIN_DIRECTIVES_PATTERN
} from '../../src/server/constants';

describe('OPCODES', () => {
    it('contains standard 6502 opcodes', () => {
        const standard = ['lda', 'sta', 'jmp', 'jsr', 'rts', 'rti', 'brk', 'nop',
            'adc', 'sbc', 'and', 'ora', 'eor', 'cmp', 'cpx', 'cpy',
            'inc', 'dec', 'inx', 'dex', 'iny', 'dey',
            'tax', 'tay', 'txa', 'tya', 'tsx', 'txs',
            'pha', 'pla', 'php', 'plp',
            'bcc', 'bcs', 'beq', 'bne', 'bmi', 'bpl', 'bvc', 'bvs',
            'clc', 'sec', 'cli', 'sei', 'cld', 'sed', 'clv',
            'asl', 'lsr', 'rol', 'ror', 'bit', 'ldx', 'ldy', 'stx', 'sty'];
        for (const op of standard) {
            expect(OPCODES.has(op), `missing opcode: ${op}`).toBe(true);
        }
    });

    it('contains undocumented opcodes', () => {
        const undocumented = ['lax', 'sax', 'dcp', 'isb', 'slo', 'sre', 'rla', 'rra'];
        for (const op of undocumented) {
            expect(OPCODES.has(op), `missing undocumented opcode: ${op}`).toBe(true);
        }
    });

    it('stores all opcodes in lowercase', () => {
        for (const op of OPCODES) {
            expect(op).toBe(op.toLowerCase());
        }
    });
});

describe('SCOPE_OPENERS', () => {
    it('contains all scope-creating directives', () => {
        const expected = ['.proc', '.block', '.macro', '.function', '.struct', '.union', '.namespace'];
        expect(Object.keys(SCOPE_OPENERS).sort()).toEqual(expected.sort());
    });

    it('every opener has an entry in OPENER_TO_CLOSERS', () => {
        for (const open of Object.keys(SCOPE_OPENERS)) {
            expect(OPENER_TO_CLOSERS[open], `${open} missing from OPENER_TO_CLOSERS`).toBeDefined();
        }
    });
});

describe('CLOSING_DIRECTIVES', () => {
    it('is consistent reverse of OPENER_TO_CLOSERS', () => {
        for (const [open, closers] of Object.entries(OPENER_TO_CLOSERS)) {
            for (const close of closers) {
                expect(CLOSING_DIRECTIVES[close], `${close} missing from CLOSING_DIRECTIVES`).toBeDefined();
                expect(CLOSING_DIRECTIVES[close]).toContain(open);
            }
        }
    });
});

describe('FOLDING_PAIRS', () => {
    it('maps each opener to its first closer', () => {
        for (const [open, closers] of Object.entries(OPENER_TO_CLOSERS)) {
            expect(FOLDING_PAIRS[open]).toBe(closers[0]);
        }
    });
});

describe('BUILTINS', () => {
    it('contains registers', () => {
        expect(BUILTINS.has('a')).toBe(true);
        expect(BUILTINS.has('x')).toBe(true);
        expect(BUILTINS.has('y')).toBe(true);
    });

    it('contains common built-in functions', () => {
        const fns = ['abs', 'len', 'sin', 'cos', 'sqrt', 'format', 'range'];
        for (const fn of fns) {
            expect(BUILTINS.has(fn), `missing builtin: ${fn}`).toBe(true);
        }
    });

    it('does not overlap with OPCODES', () => {
        for (const b of BUILTINS) {
            expect(OPCODES.has(b), `'${b}' is in both BUILTINS and OPCODES`).toBe(false);
        }
    });
});

describe('BUILTIN_DIRECTIVES_PATTERN', () => {
    it('matches common directives', () => {
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.byte')).toBe(true);
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.word')).toBe(true);
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.text')).toBe(true);
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.include')).toBe(true);
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.org')).toBe(true);
    });

    it('does not match user macros', () => {
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.mymacro')).toBe(false);
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.custom')).toBe(false);
    });
});
