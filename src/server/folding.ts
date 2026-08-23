import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver/node';
import { CLOSING_DIRECTIVES } from './constants';
import { blockDirectivesOn } from './blocks';

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
        const { opened, closed } = blockDirectivesOn(lines[lineNum]);

        for (const directive of opened) {
            stack.push({ directive, line: lineNum });
        }

        for (const closer of closed) {
            const openers = CLOSING_DIRECTIVES[closer];
            // Pair with the most recent opener this closer can close.
            for (let i = stack.length - 1; i >= 0; i--) {
                if (openers.includes(stack[i].directive)) {
                    const startLine = stack[i].line;
                    stack.splice(i, 1);
                    ranges.push(FoldingRange.create(
                        startLine, lineNum, undefined, undefined, FoldingRangeKind.Region
                    ));
                    break;
                }
            }
        }
    }

    return ranges;
}
