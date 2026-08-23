/**
 * Laying the cycle counts out as a column.
 *
 * The arithmetic lives here, away from anything that imports `vscode`, so it can
 * be tested - the same split that keeps `server.ts` thin. `extension.ts` does the
 * drawing and nothing else.
 */

/** A count as the server reports it. */
export interface CycleCount {
    line: number;
    text: string;
}

/**
 * Padding is done with NON-BREAKING spaces on purpose: the column is rendered
 * through CSS `content`, which collapses ordinary runs of whitespace, so plain
 * spaces would leave the numbers ragged.
 */
const PAD = ' ';

/** How wide the column has to be to hold every count in the document. */
export function columnWidth(counts: readonly CycleCount[]): number {
    return counts.reduce((widest, count) => Math.max(widest, count.text.length), 0);
}

/**
 * One line's column text, right-aligned in `width`.
 *
 * A line with no count still gets a blank of the full width: without it the code
 * on that line would start further left than the code above and below, which is
 * exactly the raggedness this whole change is about.
 */
export function columnText(text: string | undefined, width: number): string {
    const content = text ?? '';
    return PAD.repeat(Math.max(0, width - content.length)) + content;
}
