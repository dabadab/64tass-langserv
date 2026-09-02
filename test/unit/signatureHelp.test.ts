import { describe, it, expect } from 'vitest';
import { findCallContext, getSignatureHelp } from '../../src/server/signatureHelp';
import { buildIndex, createDoc } from '../helpers/doc';
import { parseDocument } from '../../src/server/parser';
import { DocumentIndex } from '../../src/server/types';

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
        const signature = help.signatures[0];
        expect(signature.label).toBe('fn(x, y)');
        expect(help.activeParameter).toBe(0);

        // Offsets into the label, not substrings: a substring match finds `val`
        // inside `value`, and always highlights the first of two same-named ones.
        const sliced = signature.parameters!.map(p => {
            const [start, end] = p.label as [number, number];
            return signature.label.slice(start, end);
        });
        expect(sliced).toEqual(['x', 'y']);
    });

    it('advances the active parameter past a comma', () => {
        expect(getSignatureHelp('        lda #fn(1, ', index())!.activeParameter).toBe(1);
    });

    it('clamps the active parameter to the last one', () => {
        // typing a third argument to a two-parameter callable
        expect(getSignatureHelp('        lda #fn(1, 2, 3', index())!.activeParameter).toBe(1);
    });

    it('works for macro calls, written the way one is called', () => {
        // 64tass takes `#mac 1, 2` - no parentheses, and commas between the
        // arguments (verified: `#mac 1 2` is "2nd argument is missing").
        expect(getSignatureHelp('        #mac ', index())!.signatures[0].label).toBe('mac a, b');
        expect(getSignatureHelp('        #mac ', index())!.activeParameter).toBe(0);
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

describe('a macro call as it is typed', () => {
    // What the popup does keystroke by keystroke, which is the point of it.
    const SOURCE = 'PTR_SET .macro ptr, val\n        lda #<val\n        .endm';

    function typed(text: string) {
        const doc = createDoc(SOURCE, 'file:///typed.asm');
        const documentIndex = new Map<string, DocumentIndex>([[doc.uri, parseDocument(doc)]]);
        const help = getSignatureHelp(text, documentIndex);
        if (!help) return null;
        const signature = help.signatures[0];
        const [start, end] = signature.parameters![help.activeParameter!].label as [number, number];
        return { label: signature.label, bold: signature.label.slice(start, end) };
    }

    it('says nothing until the name is finished', () => {
        expect(typed('        #PTR_SET')).toBeNull();
    });

    it('points at the first parameter as soon as one is expected', () => {
        expect(typed('        #PTR_SET ')).toEqual({ label: 'PTR_SET ptr, val', bold: 'ptr' });
    });

    it('stays on it while that argument is being written', () => {
        expect(typed('        #PTR_SET $c000')?.bold).toBe('ptr');
    });

    it('moves on at the comma', () => {
        // 64tass separates macro arguments with commas - `#PTR_SET $c000 1234`
        // does not assemble ("2nd argument is missing").
        expect(typed('        #PTR_SET $c000,')?.bold).toBe('val');
        expect(typed('        #PTR_SET $c000, 1234')?.bold).toBe('val');
    });

    it('keeps pointing at the last one past the end', () => {
        expect(typed('        #PTR_SET $c000, 1234, 5')?.bold).toBe('val');
    });
});
