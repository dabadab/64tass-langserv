import { OPENER_TO_CLOSERS, CLOSING_DIRECTIVES } from './constants';
import { parseLineStructure, stripStrings } from './utils';

/**
 * The one place that decides which block directives a line contains.
 *
 * There used to be three: the parser's scope stack, the unclosed-block check in
 * diagnostics, and the folding ranges, each with its own regex and its own idea
 * of what to match against. That divergence was a bug rather than a style
 * problem - the parser tested the RAW line, so a `.pend` inside a comment or a
 * `.bend` inside a string closed the enclosing scope, and every label after it
 * was filed under the wrong one.
 *
 * Comments and string contents are removed first, so only real directives count.
 */
/**
 * Two sets rather than an ordered list with columns, which is enough because
 * 64tass has NO statement separator: `y .block .bend`, `y .block : .bend` and
 * `a: b: nop` are all "extra characters on line" or "general syntax" (verified).
 * One line therefore carries at most one opener or closer of interest, and the
 * order consumers resolve them in cannot be observed on source that assembles.
 */
export interface BlockDirectives {
    /** Opening directives on the line, e.g. `.proc`. */
    opened: string[];
    /** Closing directives on the line, e.g. `.pend`. */
    closed: string[];
}

// Built once. These used to be constructed per directive per line.
//
// A directive may follow a label's colon with no space - "outer:.proc" is valid
// (verified) - so ':' counts as a boundary too. A letter before the dot must not:
// that is what keeps the dotted reference "outer.proc" from reading as an opener.
// Safe: directive names come from the static tables in constants.ts.
export const BOUNDARY = '(?:^|[\\s:])';
const OPENER_PATTERNS: [string, RegExp][] = Object.keys(OPENER_TO_CLOSERS)
    .map(directive => [directive, new RegExp(`${BOUNDARY}\\${directive}\\b`, 'i')]);
const CLOSER_PATTERNS: [string, RegExp][] = Object.keys(CLOSING_DIRECTIVES)
    .map(directive => [directive, new RegExp(`${BOUNDARY}\\${directive}\\b`, 'i')]);

export function blockDirectivesOn(line: string): BlockDirectives {
    // Blank the comment and any string contents, keeping offsets, so a directive
    // name that is only being talked about does not count as one.
    const code = stripStrings(parseLineStructure(line).code);
    return {
        opened: OPENER_PATTERNS.filter(([, pattern]) => pattern.test(code)).map(([directive]) => directive),
        closed: CLOSER_PATTERNS.filter(([, pattern]) => pattern.test(code)).map(([directive]) => directive),
    };
}

/**
 * The lines inside a `.weak` region.
 *
 * A weak definition is 64tass's stand-in for `.ifdef`: "any symbols defined
 * inside can be overridden by stronger symbols in the same scope from outside",
 * so a strong definition beside a weak one is no duplicate in either order. Two
 * WEAK definitions of one name still are (all verified), which is why this is a
 * set of lines rather than a blanket exemption.
 *
 * Nests, and is blind to `.weak` written in a comment or a string, since it asks
 * `blockDirectivesOn` like every other block scanner.
 */
export function findWeakLines(lines: string[]): Set<number> {
    const inside = new Set<number>();
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
        const { opened, closed } = blockDirectivesOn(lines[i]);
        const before = depth;
        if (closed.includes('.endweak')) depth = Math.max(0, depth - 1);
        if (opened.includes('.weak')) depth++;
        // Inside at both ends of the line, so the outermost `.weak` and
        // `.endweak` are out and a nested pair is in - where they belong.
        if (Math.min(before, depth) > 0) inside.add(i);
    }
    return inside;
}
