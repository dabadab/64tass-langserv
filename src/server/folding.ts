import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver/node';
import { FOLDING_PAIRS, CLOSING_DIRECTIVES } from './constants';
import { parseLineStructure, stripStrings } from './utils';

/**
 * Foldable regions of a document: each block-opening directive paired with the
 * closer that matches it.
 *
 * Takes the text rather than a TextDocument so it can be exercised directly.
 */
export function computeFoldingRanges(text: string): FoldingRange[] {
    const ranges: FoldingRange[] = [];
    const lines = text.split('\n');

    const stack: { directive: string; line: number }[] = [];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const { code } = parseLineStructure(lines[lineNum]);
        // Blank out string contents first, so a directive name inside a literal
        // (.text "a .proc b") doesn't push a phantom entry onto the fold stack
        const line = stripStrings(code).toLowerCase();

        // Check for opening directives
        for (const open of Object.keys(FOLDING_PAIRS)) {
            // Safe: directive name from static constant (FOLDING_PAIRS)
            const openPattern = new RegExp(`(?:^|\\s)\\${open}\\b`);
            if (openPattern.test(line)) {
                stack.push({ directive: open, line: lineNum });
            }
        }

        // Check for closing directives
        for (const [close, openers] of Object.entries(CLOSING_DIRECTIVES)) {
            // Safe: directive name from static constant (CLOSING_DIRECTIVES)
            const closePattern = new RegExp(`(?:^|\\s)\\${close}\\b`);
            if (closePattern.test(line)) {
                // Find the most recent matching opener
                for (let i = stack.length - 1; i >= 0; i--) {
                    if (openers.includes(stack[i].directive)) {
                        const startLine = stack[i].line;
                        stack.splice(i, 1);
                        ranges.push(FoldingRange.create(
                            startLine,
                            lineNum,
                            undefined,
                            undefined,
                            FoldingRangeKind.Region
                        ));
                        break;
                    }
                }
            }
        }
    }

    return ranges;
}
