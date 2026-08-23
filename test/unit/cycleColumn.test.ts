import { describe, it, expect } from 'vitest';
import { columnWidth, columnText } from '../../src/client/cycleColumn';

const NBSP = ' ';

describe('columnWidth', () => {
    it('is the widest count in the document', () => {
        expect(columnWidth([{ line: 0, text: '4' }, { line: 1, text: '2**' }, { line: 2, text: '4*' }])).toBe(3);
    });

    it('is zero when there is nothing to show', () => {
        expect(columnWidth([])).toBe(0);
    });
});

describe('columnText', () => {
    it('right-aligns within the column', () => {
        expect(columnText('4', 3)).toBe(`${NBSP}${NBSP}4`);
        expect(columnText('2**', 3)).toBe('2**');
    });

    it('gives a line with no count a blank of the same width', () => {
        // Otherwise the code on that line would start further left than the rest.
        expect(columnText(undefined, 3)).toBe(NBSP.repeat(3));
        expect(columnText(undefined, 3)).toHaveLength(3);
    });

    it('pads with non-breaking spaces, which CSS content will not collapse', () => {
        expect(columnText('4', 4)).not.toContain(' ');
    });

    it('never truncates a count wider than the column', () => {
        expect(columnText('2**', 1)).toBe('2**');
    });
});
