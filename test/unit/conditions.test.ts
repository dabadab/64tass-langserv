import { describe, it, expect } from 'vitest';
import { evaluateCondition, computeBranchPaths, areMutuallyExclusive } from '../../src/server/conditions';
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

describe('computeBranchPaths', () => {
    const paths = (src: string) => computeBranchPaths(src.split('\n'));

    it('gives lines outside any conditional an empty path', () => {
        const p = paths('start\n        nop');
        expect(p.get(0)).toEqual([]);
        expect(p.get(1)).toEqual([]);
    });

    it('numbers the branches of a chain in order', () => {
        const p = paths([
            '        .if 1',   // 0
            'a',               // 1 -> branch 0
            '        .elsif 1',// 2
            'b',               // 3 -> branch 1
            '        .else',   // 4
            'c',               // 5 -> branch 2
            '        .endif',  // 6
            'd'                // 7 -> outside
        ].join('\n'));
        expect(p.get(1)![0].branch).toBe(0);
        expect(p.get(3)![0].branch).toBe(1);
        expect(p.get(5)![0].branch).toBe(2);
        expect(p.get(7)).toEqual([]);
    });

    it('nests paths', () => {
        const p = paths([
            '        .if 1',   // 0
            '        .if 1',   // 1
            'inner',           // 2
            '        .endif',  // 3
            '        .endif'   // 4
        ].join('\n'));
        expect(p.get(2)).toHaveLength(2);
    });

    it('gives separate chains distinct ids', () => {
        const p = paths([
            '        .if 1', 'a', '        .endif',
            '        .if 1', 'b', '        .endif'
        ].join('\n'));
        expect(p.get(1)![0].chain).not.toBe(p.get(4)![0].chain);
    });

    it('ignores a conditional inside a string literal', () => {
        const p = paths('        .text "a .if b"\nstart');
        expect(p.get(1)).toEqual([]);
    });
});

describe('areMutuallyExclusive', () => {
    const paths = (src: string) => computeBranchPaths(src.split('\n'));

    it('is false for two lines outside any conditional', () => {
        expect(areMutuallyExclusive([], [])).toBe(false);
    });

    it('is true for different branches of one chain', () => {
        const p = paths('        .if 1\na\n        .else\nb\n        .endif');
        expect(areMutuallyExclusive(p.get(1), p.get(3))).toBe(true);
    });

    it('is false within the same branch', () => {
        const p = paths('        .if 1\na\nb\n        .endif');
        expect(areMutuallyExclusive(p.get(1), p.get(2))).toBe(false);
    });

    it('is false for inside versus outside a conditional', () => {
        // The assembler DOES reject this pair, so they must not be excluded
        const p = paths('a\n        .if 1\nb\n        .endif');
        expect(areMutuallyExclusive(p.get(0), p.get(2))).toBe(false);
    });

    it('is true when an outer chain diverges, even from a nested branch', () => {
        const p = paths([
            '        .if 1',   // 0
            '        .if 1',   // 1
            'a',               // 2
            '        .endif',  // 3
            '        .else',   // 4
            'b',               // 5
            '        .endif'   // 6
        ].join('\n'));
        expect(areMutuallyExclusive(p.get(2), p.get(5))).toBe(true);
    });

    it('is false for unrelated chains', () => {
        const p = paths([
            '        .if 1', 'a', '        .endif',
            '        .if 1', 'b', '        .endif'
        ].join('\n'));
        expect(areMutuallyExclusive(p.get(1), p.get(4))).toBe(false);
    });
});
