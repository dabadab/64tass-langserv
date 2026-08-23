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
const BOUNDARY = '(?:^|[\\s:])';
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
