import { describe, it, expect } from 'vitest';
import { evaluateCondition } from '../../src/server/conditions';
import { buildIndex } from '../helpers/doc';

/** Evaluate `cond` against a document containing `defs` above it. */
function evalWith(cond: string, defs = '') {
    const source = `${defs}\n\t.if ${cond}\n\t.endif`;
    const { documentIndex, docs } = buildIndex({ source, uri: `file:///${Math.random()}.asm` });
    return evaluateCondition(cond, docs[0].uri, source.split('\n').length - 2, documentIndex, false);
}

describe('evaluateCondition - literals', () => {
    it('decides numeric literals', () => {
        expect(evalWith('0')).toBe(false);
        expect(evalWith('1')).toBe(true);
        expect(evalWith('$00')).toBe(false);
        expect(evalWith('$FF')).toBe(true);
        expect(evalWith('%0')).toBe(false);
    });
});

describe('evaluateCondition - comparisons', () => {
    // 64tass accepts all of these (verified against the assembler)
    it.each([
        ['1 = 1', true], ['1 = 2', false],
        ['1 == 1', true], ['1 != 2', true], ['1 != 1', false],
        ['1 < 2', true], ['2 < 1', false],
        ['2 > 1', true], ['1 > 2', false],
        ['1 <= 1', true], ['2 <= 1', false],
        ['1 >= 1', true], ['1 >= 2', false],
    ])('%s -> %s', (cond, expected) => {
        expect(evalWith(cond)).toBe(expected);
    });
});

describe('evaluateCondition - operators', () => {
    it('handles negation', () => {
        expect(evalWith('!0')).toBe(true);
        expect(evalWith('!1')).toBe(false);
    });

    it('handles && and ||', () => {
        expect(evalWith('1 && 1')).toBe(true);
        expect(evalWith('1 && 0')).toBe(false);
        expect(evalWith('0 || 1')).toBe(true);
        expect(evalWith('0 || 0')).toBe(false);
    });

    it('handles arithmetic and parentheses', () => {
        expect(evalWith('(1 + 1) = 2')).toBe(true);
        expect(evalWith('(2 * 3) = 6')).toBe(true);
        expect(evalWith('(6 / 2) = 3')).toBe(true);
        expect(evalWith('(5 - 5) = 0')).toBe(true);
    });

    it('does not decide a division by zero', () => {
        expect(evalWith('(1 / 0) = 0')).toBeNull();
    });
});

describe('evaluateCondition - symbols', () => {
    it('resolves a constant from the index', () => {
        expect(evalWith('linking = 1', 'linking = 1')).toBe(true);
        expect(evalWith('linking = 1', 'linking = 0')).toBe(false);
    });

    it('resolves a bare flag', () => {
        expect(evalWith('below_io', 'below_io = 1')).toBe(true);
        expect(evalWith('below_io', 'below_io = 0')).toBe(false);
        expect(evalWith('!below_io', 'below_io = 0')).toBe(true);
    });

    it('resolves a symbol whose value is itself an expression', () => {
        expect(evalWith('total = 6', 'a = 2\nb = 3\ntotal = a * b')).toBe(true);
    });

    it('returns null for an unresolvable symbol', () => {
        expect(evalWith('unknown_flag')).toBeNull();
        expect(evalWith('unknown_flag = 1')).toBeNull();
    });

    it('returns null rather than looping on a self-referential value', () => {
        expect(evalWith('x = 1', 'x = x')).toBeNull();
    });
});

describe('evaluateCondition - undecidable input', () => {
    it('returns null for the program counter', () => {
        expect(evalWith('*>=$1000')).toBeNull();
    });

    it('returns null for an empty or malformed condition', () => {
        expect(evalWith('')).toBeNull();
        expect(evalWith('1 +')).toBeNull();
        expect(evalWith('(1')).toBeNull();
        expect(evalWith('1 1')).toBeNull();
    });

    it('returns null for a string comparison', () => {
        expect(evalWith('"a" = "b"')).toBeNull();
    });
});
