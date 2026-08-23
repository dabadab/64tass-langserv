import { describe, it, expect } from 'vitest';
import { computeCycleCounts } from '../../src/server/cycleCounts';
import { parseDocument } from '../../src/server/parser';
import { createDoc } from '../helpers/doc';
import { DocumentIndex } from '../../src/server/types';

function countsFor(source: string, cpu?: string) {
    const doc = createDoc(source, 'file:///cycles.asm');
    const documentIndex = new Map<string, DocumentIndex>([[doc.uri, parseDocument(doc, cpu ? { cpu } : {})]]);
    return computeCycleCounts(doc, documentIndex);
}

/** Each counted line's source text mapped to its count, so cases read as code. */
function labelled(source: string, cpu?: string): Record<string, string> {
    const lines = source.split('\n');
    return Object.fromEntries(countsFor(source, cpu).map(c => [lines[c.line].trim(), c.text]));
}

describe('cycle counts', () => {
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
        // knows which - a guess would be worse than no count.
        expect(labelled('        *= $1000\n        lda elsewhere')).toEqual({});
    });

    it('says nothing on a target with no timing data', () => {
        expect(countsFor('        *= $1000\n        lda $1234', '65816')).toEqual([]);
    });

    it('reports the line each count belongs to', () => {
        expect(countsFor('        *= $1000\n\n        nop\n        rts'))
            .toEqual([{ line: 2, text: '2' }, { line: 3, text: '6' }]);
    });
});
