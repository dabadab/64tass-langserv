import { describe, it, expect } from 'vitest';
import { Position, Range, SelectionRange } from 'vscode-languageserver/node';
import { computeSelectionRanges } from '../../src/server/selectionRanges';

/** The chain of selected texts, innermost first. */
function chain(source: string, line: number, character: number): string[] {
    const [result] = computeSelectionRanges(source, [Position.create(line, character)]);
    const lines = source.split('\n');
    const out: string[] = [];
    for (let node: SelectionRange | undefined = result; node; node = node.parent) {
        out.push(slice(lines, node.range));
    }
    return out;
}

function slice(lines: string[], range: Range): string {
    if (range.start.line === range.end.line) {
        return lines[range.start.line].slice(range.start.character, range.end.character);
    }
    return [
        lines[range.start.line].slice(range.start.character),
        ...lines.slice(range.start.line + 1, range.end.line),
        lines[range.end.line].slice(0, range.end.character),
    ].join('\n');
}

describe('computeSelectionRanges', () => {
    it('starts at the word under the cursor', () => {
        expect(chain('        lda table,x', 0, 13)[0]).toBe('table');
    });

    it('expands from the word to the operand', () => {
        // "table" then "table,x" - the indexed operand is a meaningful step.
        const steps = chain('        lda table,x', 0, 13);
        expect(steps.slice(0, 2)).toEqual(['table', 'table,x']);
    });

    it('does not split an operand on a comma inside brackets', () => {
        const steps = chain('        lda ($34,x)', 0, 14);
        expect(steps).toContain('($34,x)');
    });

    it('does not split on a comma inside a string', () => {
        const steps = chain('        .text "a,b"', 0, 16);
        expect(steps).toContain('.text "a,b"');
    });

    it('expands to the code without the trailing comment, then the whole line', () => {
        const steps = chain('        lda #1   ; load one', 0, 13);
        expect(steps).toContain('lda #1');
        expect(steps).toContain('        lda #1   ; load one');
        expect(steps.indexOf('lda #1')).toBeLessThan(steps.indexOf('        lda #1   ; load one'));
    });

    it('expands through the enclosing block', () => {
        const source = [
            'outer   .proc',
            '        lda #1',
            '        .pend',
        ].join('\n');
        const steps = chain(source, 1, 13);
        expect(steps).toContain(source);
    });

    it('expands innermost block first when they nest', () => {
        const source = [
            'outer   .proc',
            'inner   .block',
            '        lda #1',
            '        .bend',
            '        .pend',
        ].join('\n');
        const steps = chain(source, 2, 13);
        const innerAt = steps.findIndex(s => s.startsWith('inner') && s.includes('.bend'));
        const outerAt = steps.findIndex(s => s.startsWith('outer'));
        expect(innerAt).toBeGreaterThan(-1);
        expect(outerAt).toBeGreaterThan(innerAt);
    });

    it('ends at the whole document', () => {
        const source = 'start\n        lda #1\n        rts';
        expect(chain(source, 1, 13).at(-1)).toBe(source);
    });

    it('widens strictly at every step', () => {
        const source = 'outer   .proc\n        lda table,x  ; c\n        .pend';
        const steps = chain(source, 1, 13);
        for (let i = 1; i < steps.length; i++) {
            expect(steps[i].length, `${JSON.stringify(steps[i])} should be wider than ${JSON.stringify(steps[i - 1])}`)
                .toBeGreaterThan(steps[i - 1].length);
        }
    });

    it('handles a position on a blank line', () => {
        expect(() => chain('start\n\n        rts', 1, 0)).not.toThrow();
    });

    it('handles a character past the end of the line', () => {
        expect(() => chain('start', 0, 99)).not.toThrow();
    });

    it('answers each requested position independently', () => {
        const results = computeSelectionRanges('        lda one,x\n        sta two,y', [
            Position.create(0, 13),
            Position.create(1, 13),
        ]);
        expect(results).toHaveLength(2);
        expect(slice('        lda one,x\n        sta two,y'.split('\n'), results[0].range)).toBe('one');
        expect(slice('        lda one,x\n        sta two,y'.split('\n'), results[1].range)).toBe('two');
    });
});
