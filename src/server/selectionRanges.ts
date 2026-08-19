import { SelectionRange, Range, Position } from 'vscode-languageserver/node';
import { computeFoldingRanges } from './folding';
import { parseLineStructure } from './utils';

/**
 * Expand-selection steps for a position: word, then operand, then the code part
 * of the line, then the whole line, then each enclosing block from innermost
 * outwards, then the document.
 *
 * The block levels reuse the folding ranges, so expanding follows exactly the
 * `.proc`/`.block`/`.if` nesting the editor already folds on.
 */
export function computeSelectionRanges(text: string, positions: Position[]): SelectionRange[] {
    const lines = text.split('\n');
    // Innermost first, so the walk outwards is just an ordered list.
    const blocks = computeFoldingRanges(text)
        .filter(f => f.endLine > f.startLine)
        .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));

    return positions.map(position => buildChain(lines, blocks, position));
}

function buildChain(
    lines: string[],
    blocks: { startLine: number; endLine: number }[],
    position: Position
): SelectionRange {
    const ranges: Range[] = [];
    const line = lines[position.line] ?? '';
    const character = Math.min(position.character, line.length);

    const word = wordAround(line, character);
    if (word) ranges.push(Range.create(position.line, word[0], position.line, word[1]));

    // Two operand steps: the comma-separated one under the cursor, then all of
    // them. The first collapses away when it is just the word again.
    const { code, commentStart } = parseLineStructure(line);
    const from = operandStart(code);
    const operand = operandAround(code, from, character);
    if (operand) ranges.push(Range.create(position.line, operand[0], position.line, operand[1]));
    if (character >= from && from < code.trimEnd().length) {
        ranges.push(Range.create(position.line, from, position.line, code.trimEnd().length));
    }

    // The code part of the line, excluding any trailing comment and indentation.
    const codeEnd = (commentStart >= 0 ? line.slice(0, commentStart) : line).trimEnd().length;
    const codeStart = line.length - line.trimStart().length;
    if (codeStart < codeEnd) ranges.push(Range.create(position.line, codeStart, position.line, codeEnd));

    ranges.push(Range.create(position.line, 0, position.line, line.length));

    for (const block of blocks) {
        if (block.startLine <= position.line && position.line <= block.endLine) {
            ranges.push(Range.create(block.startLine, 0, block.endLine, (lines[block.endLine] ?? '').length));
        }
    }

    const lastLine = Math.max(lines.length - 1, 0);
    ranges.push(Range.create(0, 0, lastLine, (lines[lastLine] ?? '').length));

    // The protocol wants strictly widening ranges, so drop any step that did not
    // actually grow on the one before it.
    const chain: Range[] = [];
    for (const range of ranges) {
        const previous = chain[chain.length - 1];
        if (!previous || covers(range, previous)) chain.push(range);
    }

    let result: SelectionRange | undefined;
    for (let i = chain.length - 1; i >= 0; i--) {
        result = { range: chain[i], parent: result };
    }
    return result ?? { range: Range.create(position, position) };
}

/** True if `outer` strictly contains `inner`. */
function covers(outer: Range, inner: Range): boolean {
    const startsBefore = outer.start.line < inner.start.line
        || (outer.start.line === inner.start.line && outer.start.character <= inner.start.character);
    const endsAfter = outer.end.line > inner.end.line
        || (outer.end.line === inner.end.line && outer.end.character >= inner.end.character);
    const same = outer.start.line === inner.start.line && outer.start.character === inner.start.character
        && outer.end.line === inner.end.line && outer.end.character === inner.end.character;
    return startsBefore && endsAfter && !same;
}

const WORD_CHARS = /[a-zA-Z0-9_.]/;

function wordAround(line: string, character: number): [number, number] | null {
    let start = character;
    let end = character;
    while (start > 0 && WORD_CHARS.test(line[start - 1])) start--;
    while (end < line.length && WORD_CHARS.test(line[end])) end++;
    return end > start ? [start, end] : null;
}

/**
 * Where the operands begin: past the mnemonic, and past a label as well when the
 * line has one. A label only counts at column 0, which is how 64tass reads it.
 */
function operandStart(code: string): number {
    const indent = code.length - code.trimStart().length;
    let i = indent;
    for (let token = 0; token < (indent === 0 ? 2 : 1); token++) {
        while (i < code.length && !/\s/.test(code[i])) i++;
        while (i < code.length && /\s/.test(code[i])) i++;
    }
    return i;
}

/**
 * The comma-separated operand under the cursor, e.g. `table,x` selects as one
 * step between the word and the line. Commas inside strings or brackets do not
 * split, so `.text "a,b"` and `lda ($34,x)` stay whole.
 */
function operandAround(code: string, from: number, character: number): [number, number] | null {
    if (character < from || from >= code.length) return null;
    const boundaries = [from - 1];
    let depth = 0;
    let quote: string | null = null;
    for (let i = from; i < code.length; i++) {
        const c = code[i];
        if (quote) {
            if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === '(' || c === '[') {
            depth++;
        } else if (c === ')' || c === ']') {
            depth = Math.max(0, depth - 1);
        } else if (c === ',' && depth === 0) {
            boundaries.push(i);
        }
    }
    boundaries.push(code.length);

    for (let i = 0; i + 1 < boundaries.length; i++) {
        const from = boundaries[i] + 1;
        const to = boundaries[i + 1];
        if (character >= from && character <= to) {
            const start = from + (code.slice(from, to).length - code.slice(from, to).trimStart().length);
            const end = to - (code.slice(from, to).length - code.slice(from, to).trimEnd().length);
            return end > start ? [start, end] : null;
        }
    }
    return null;
}
