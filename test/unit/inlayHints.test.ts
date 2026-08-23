import { describe, it, expect } from 'vitest';
import { Range, Position } from 'vscode-languageserver/node';
import { computeInlayHints } from '../../src/server/inlayHints';
import { parseDocument } from '../../src/server/parser';
import { createDoc } from '../helpers/doc';
import { DocumentIndex } from '../../src/server/types';

function hintsFor(source: string, cpu?: string) {
    const doc = createDoc(source, 'file:///cycles.asm');
    const documentIndex = new Map<string, DocumentIndex>([[doc.uri, parseDocument(doc, cpu ? { cpu } : {})]]);
    const whole = Range.create(Position.create(0, 0), Position.create(source.split('\n').length, 0));
    return computeInlayHints(doc, whole, documentIndex);
}

function labelled(source: string, cpu?: string): Record<string, string> {
    const lines = source.split('\n');
    return Object.fromEntries(hintsFor(source, cpu).map(h => [lines[h.position.line].trim(), h.label as string]));
}

describe('cycle inlay hints', () => {
    it('counts each addressing mode separately', () => {
        expect(labelled([
            'ZP      = $10',
            '        *= $1000',
            '        lda #$01',
            '        lda ZP',
            '        lda $1234',
            '        nop',
        ].join('\n'))).toEqual({
            'lda #$01': '2',
            'lda ZP': '3',      // the constant resolves, so this is the zeropage form
            'lda $1234': '4',
            'nop': '2',
        });
    });

    it('marks the conditional extras', () => {
        expect(labelled([
            'start   *= $1000',
            '        lda $1234,x',
            '        beq start',
        ].join('\n'))).toEqual({
            'lda $1234,x': '4*',      // +1 across a page
            'beq start': '2**',       // +1 taken, +2 across a page
        });
    });

    it('reads the instruction, not the first three letters', () => {
        // `jsr sub` is an instruction with an operand, not a label called jsr.
        expect(labelled('        *= $1000\n        jsr sub\nsub     rts')).toEqual({
            'jsr sub': '6',
            'sub     rts': '6',
        });
    });

    it('says nothing when the mode cannot be pinned down', () => {
        // Zeropage or absolute decides between 3 and 4 cycles, and nothing here
        // knows which - a guess would be worse than no hint.
        expect(labelled('        *= $1000\n        lda elsewhere')).toEqual({});
    });

    it('says nothing on a target with no timing data', () => {
        expect(hintsFor('        *= $1000\n        lda $1234', '65816')).toEqual([]);
    });

    it('sits at the end of the code, before any comment', () => {
        const source = '        *= $1000\n        nop          ; wait';
        const [hint] = hintsFor(source);
        expect(hint.position.line).toBe(1);
        expect(hint.position.character).toBe('        nop'.length);
        expect(hint.paddingLeft).toBe(true);
    });

    it('only covers the range asked for', () => {
        const source = '        *= $1000\n        nop\n        nop';
        const doc = createDoc(source, 'file:///range.asm');
        const documentIndex = new Map<string, DocumentIndex>([[doc.uri, parseDocument(doc)]]);
        const hints = computeInlayHints(doc, Range.create(Position.create(2, 0), Position.create(2, 0)), documentIndex);
        expect(hints.map(h => h.position.line)).toEqual([2]);
    });
});
