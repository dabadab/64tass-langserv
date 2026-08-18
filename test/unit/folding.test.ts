import { describe, it, expect } from 'vitest';
import { FoldingRangeKind } from 'vscode-languageserver/node';
import { computeFoldingRanges } from '../../src/server/folding';

const pairs = (source: string) =>
    computeFoldingRanges(source).map(r => [r.startLine, r.endLine]).sort((a, b) => a[0] - b[0]);

describe('computeFoldingRanges', () => {
    it('folds a .proc block', () => {
        expect(pairs('p .proc\n        nop\n.pend')).toEqual([[0, 2]]);
    });

    it('reports regions', () => {
        expect(computeFoldingRanges('p .proc\n.pend')[0].kind).toBe(FoldingRangeKind.Region);
    });

    it.each([
        ['.proc', '.pend'],
        ['.block', '.bend'],
        ['.macro', '.endm'],
        ['.function', '.endf'],
        ['.struct', '.ends'],
        ['.union', '.endu'],
        ['.namespace', '.endn'],
        ['.if', '.endif'],
        ['.for', '.next'],
    ])('folds %s/%s', (open, close) => {
        expect(pairs(`        ${open}\n        nop\n        ${close}`)).toEqual([[0, 2]]);
    });

    it('folds nested blocks independently', () => {
        const source = ['outer .proc', 'inner .proc', '        nop', '.pend', '.pend'].join('\n');
        expect(pairs(source)).toEqual([[0, 4], [1, 3]]);
    });

    it('matches a closer to the most recent compatible opener', () => {
        const source = ['a .proc', 'b .block', '.bend', '.pend'].join('\n');
        expect(pairs(source)).toEqual([[0, 3], [1, 2]]);
    });

    it('accepts an alternative closer', () => {
        expect(pairs('        .if 1\n        nop\n        .fi')).toEqual([[0, 2]]);
    });

    it('produces nothing for an unclosed block', () => {
        expect(pairs('p .proc\n        nop')).toEqual([]);
    });

    it('ignores a closer with no opener', () => {
        expect(pairs('        nop\n.pend')).toEqual([]);
    });

    it('produces nothing for a document with no blocks', () => {
        expect(pairs('start\n        lda #1\n        rts')).toEqual([]);
    });

    it('handles an empty document', () => {
        expect(pairs('')).toEqual([]);
    });
});

describe('computeFoldingRanges - directives in strings and comments', () => {
    // The C6 fix touched this path but could not be covered while the function
    // lived in server.ts; these are that fix's first real tests.
    it('ignores a block directive inside a string literal', () => {
        expect(pairs('        .text "text with .proc inside"')).toEqual([]);
    });

    it('ignores a closing directive inside a string literal', () => {
        expect(pairs('        .text "close it .pend here"')).toEqual([]);
    });

    it('does not let a string corrupt a real fold', () => {
        const source = ['p .proc', '        .text "nested .proc word"', '.pend'].join('\n');
        expect(pairs(source)).toEqual([[0, 2]]);
    });

    it('ignores a directive in a comment', () => {
        expect(pairs('        nop ; .proc mentioned here')).toEqual([]);
    });

    it('folds a block whose lines carry trailing comments', () => {
        expect(pairs('p .proc ; open\n        nop\n.pend ; close')).toEqual([[0, 2]]);
    });
});
