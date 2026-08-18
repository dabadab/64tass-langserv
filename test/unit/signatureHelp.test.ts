import { describe, it, expect } from 'vitest';
import { findCallContext, getSignatureHelp } from '../../src/server/signatureHelp';
import { buildIndex } from '../helpers/doc';

// All three call forms are accepted by the assembler (verified)
const DEFS = 'mac .macro a, b\n.endm\nfn .function x, y\n.endf\nnoargs .macro\n.endm';
const index = () => buildIndex({ source: DEFS, uri: 'file:///s.asm' }).documentIndex;

describe('findCallContext', () => {
    it('recognises a function call and the active argument', () => {
        expect(findCallContext('        lda #fn(')).toEqual({ name: 'fn', argumentIndex: 0 });
        expect(findCallContext('        lda #fn(1, ')).toEqual({ name: 'fn', argumentIndex: 1 });
        expect(findCallContext('        lda #fn(1, 2')).toEqual({ name: 'fn', argumentIndex: 1 });
    });

    it('recognises both macro call forms', () => {
        expect(findCallContext('        #mac ')).toEqual({ name: 'mac', argumentIndex: 0 });
        expect(findCallContext('        .mac 1, ')).toEqual({ name: 'mac', argumentIndex: 1 });
    });

    it('recognises a macro call after a label', () => {
        expect(findCallContext('lbl     #mac 1, ')).toEqual({ name: 'mac', argumentIndex: 1 });
        expect(findCallContext('lbl:    .mac ')).toEqual({ name: 'mac', argumentIndex: 0 });
    });

    it('ignores commas nested inside parentheses', () => {
        expect(findCallContext('        lda #fn(g(1, 2), ')).toEqual({ name: 'fn', argumentIndex: 1 });
    });

    it('uses the innermost unclosed call', () => {
        expect(findCallContext('        lda #fn(1, g(')).toEqual({ name: 'g', argumentIndex: 0 });
    });

    it('returns null once the call is closed', () => {
        expect(findCallContext('        lda #fn(1, 2)')).toBeNull();
    });

    it('returns null outside any call', () => {
        expect(findCallContext('        lda #1')).toBeNull();
        expect(findCallContext('')).toBeNull();
        expect(findCallContext('start')).toBeNull();
    });

    it('does not look inside a comment', () => {
        expect(findCallContext('        nop ; see fn(')).toBeNull();
    });
});

describe('getSignatureHelp', () => {
    it('reports the signature and active parameter for a function', () => {
        const help = getSignatureHelp('        lda #fn(', index())!;
        expect(help.signatures[0].label).toBe('fn(x, y)');
        expect(help.signatures[0].parameters!.map(p => p.label)).toEqual(['x', 'y']);
        expect(help.activeParameter).toBe(0);
    });

    it('advances the active parameter past a comma', () => {
        expect(getSignatureHelp('        lda #fn(1, ', index())!.activeParameter).toBe(1);
    });

    it('clamps the active parameter to the last one', () => {
        // typing a third argument to a two-parameter callable
        expect(getSignatureHelp('        lda #fn(1, 2, 3', index())!.activeParameter).toBe(1);
    });

    it('works for macro calls', () => {
        expect(getSignatureHelp('        #mac ', index())!.signatures[0].label).toBe('mac(a, b)');
        expect(getSignatureHelp('        .mac 1, ', index())!.activeParameter).toBe(1);
    });

    it('returns null for an unknown callable', () => {
        expect(getSignatureHelp('        lda #nope(', index())).toBeNull();
    });

    it('returns null for a callable with no parameters', () => {
        expect(getSignatureHelp('        #noargs ', index())).toBeNull();
    });

    it('matches case-insensitively by default', () => {
        expect(getSignatureHelp('        lda #FN(', index())!.signatures[0].label).toBe('fn(x, y)');
    });
});
