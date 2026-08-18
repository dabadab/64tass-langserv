export interface LineStructure {
    code: string;        // Everything before ; (or full line if no comment)
    commentStart: number; // Position of ; (-1 if none)
}

// Parse line structure in a single scan, returning both code portion and comment position
// In 64tass, "" inside a string is an escaped quote, backslashes are literal
export function parseLineStructure(line: string): LineStructure {
    let inString = false;
    let stringChar = '';
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inString) {
            if (char === stringChar) {
                // Check for escaped quote (doubled quote)
                if (i + 1 < line.length && line[i + 1] === stringChar) {
                    i++; // Skip the escaped quote
                } else {
                    inString = false;
                }
            }
        } else {
            if (char === '"' || char === "'") {
                inString = true;
                stringChar = char;
            } else if (char === ';') {
                return { code: line.substring(0, i), commentStart: i };
            }
        }
    }
    return { code: line, commentStart: -1 };
}

// Strip comments from a line (handle strings to avoid stripping ; inside strings)
// In 64tass, "" inside a string is an escaped quote, backslashes are literal
export function stripComment(line: string): string {
    return parseLineStructure(line).code;
}

// Strip string literals from a line, replacing contents with spaces to preserve positions
// Used to avoid matching symbols inside string literals
export function stripStrings(line: string): string {
    let result = '';
    let inString = false;
    let stringChar = '';
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inString) {
            if (char === stringChar) {
                // Check for escaped quote (doubled quote)
                if (i + 1 < line.length && line[i + 1] === stringChar) {
                    result += '  '; // Replace both quotes with spaces
                    i++;
                } else {
                    result += char; // Keep the closing quote
                    inString = false;
                }
            } else {
                result += ' '; // Replace string content with space
            }
        } else {
            result += char;
            if (char === '"' || char === "'") {
                inString = true;
                stringChar = char;
            }
        }
    }
    return result;
}

// Find comment start position in a line (returns -1 if no comment)
// In 64tass, "" inside a string is an escaped quote, backslashes are literal
export function getCommentStart(line: string): number {
    return parseLineStructure(line).commentStart;
}

// Extract comment text from a line (returns the text after ;, preserving indentation)
// Strips one leading space if present (conventional separator after ;)
export function extractComment(line: string): string | null {
    const idx = line.indexOf(';');
    if (idx >= 0) {
        let comment = line.substring(idx + 1).trimEnd();
        // Remove single leading space (conventional "; comment" format)
        if (comment.startsWith(' ')) {
            comment = comment.substring(1);
        }
        return comment.length > 0 ? comment : null;
    }
    return null;
}

// Get associated comment for a block label at lineNum
// Checks: same line, lines above, lines below (in that priority order)
// Multiple consecutive comment lines are joined together
export function getBlockComment(lines: string[], lineNum: number): string | undefined {
    // Same line comment
    const sameLine = extractComment(lines[lineNum]);
    if (sameLine) return sameLine;

    // Lines above (must be comment-only lines, collect all consecutive)
    if (lineNum > 0 && /^\s*;/.test(lines[lineNum - 1])) {
        const commentLines: string[] = [];
        for (let i = lineNum - 1; i >= 0; i--) {
            if (/^\s*;/.test(lines[i])) {
                const comment = extractComment(lines[i]);
                if (comment) commentLines.unshift(comment);
            } else {
                break;
            }
        }
        if (commentLines.length > 0) {
            return commentLines.join('  \n');
        }
    }

    // Lines below (must be comment-only lines, collect all consecutive)
    if (lineNum < lines.length - 1 && /^\s*;/.test(lines[lineNum + 1])) {
        const commentLines: string[] = [];
        for (let i = lineNum + 1; i < lines.length; i++) {
            if (/^\s*;/.test(lines[i])) {
                const comment = extractComment(lines[i]);
                if (comment) commentLines.push(comment);
            } else {
                break;
            }
        }
        if (commentLines.length > 0) {
            return commentLines.join('  \n');
        }
    }

    return undefined;
}

// Parse a numeric value from various formats (decimal, hex, binary)
export function parseNumericValue(value: string): number | null {
    const trimmed = value.trim();

    // Hexadecimal: $FF or 0xFF or 0xABC
    const hexMatch = trimmed.match(/^\$([0-9a-fA-F]+)$/) || trimmed.match(/^0x([0-9a-fA-F]+)$/i);
    if (hexMatch) {
        return parseInt(hexMatch[1], 16);
    }

    // Binary: %10101010 or 0b10101010
    const binMatch = trimmed.match(/^%([01]+)$/) || trimmed.match(/^0b([01]+)$/i);
    if (binMatch) {
        return parseInt(binMatch[1], 2);
    }

    // Decimal: 123 or -123
    const decMatch = trimmed.match(/^-?\d+$/);
    if (decMatch) {
        return parseInt(trimmed, 10);
    }

    return null;
}

// Format a number in binary, decimal, and hexadecimal
export function formatNumericValue(num: number): string {
    const bin = num >= 0 ? '%' + num.toString(2) : '-' + '%' + Math.abs(num).toString(2);
    const dec = num.toString(10);
    const hex = num >= 0 ? '$' + num.toString(16).toUpperCase() : '-$' + Math.abs(num).toString(16).toUpperCase();
    return `${bin}, ${dec}, ${hex}`;
}

// Token types for expression tokenization
export interface Token {
    type: 'value' | 'operator' | 'paren';
    text: string;
    start: number;
}

// A single value in an expression. Order matters: the longest/most specific
// alternatives come first, since the regex takes the first that matches.
//   - floats before integers, so "360.0" is one value and not 360 / . / 0
//     (all of "360.0", ".5", "1." and exponents like "1e2" are valid to 64tass)
//   - dotted identifiers as one value, so a scope-qualified reference like
//     "tbl.lo" is not read as two values with a missing operator between them
//   - macro arguments ("\1", "\@", "\name") as values rather than being skipped
//     as unknown characters
const VALUE_PATTERN = new RegExp('^(' + [
    '\\$[0-9a-fA-F]+',                              // $FF
    '0x[0-9a-fA-F]+',                               // 0xFF
    '%[01]+',                                       // %1010
    '0b[01]+',                                      // 0b1010
    '\\\\(?:@|\\d+|[a-zA-Z_][a-zA-Z0-9_]*)',        // \1, \@, \name
    '(?:\\d+\\.\\d*|\\.\\d+|\\d+)(?:[eE][+-]?\\d+)?', // 360.0, 1., .5, 1e2, 2.5e-3
    '[a-zA-Z_][a-zA-Z0-9_]*(?:\\.[a-zA-Z_][a-zA-Z0-9_]*)*' // name, tbl.lo, a.b.c
].join('|') + ')');

// Tokenize an expression into values, operators, and parentheses
// Used for validating operator presence between data directive values
export function tokenizeExpression(expr: string): Token[] {
    const tokens: Token[] = [];
    const operators = /^(,|\+|-|\*|\/|&|\||<<|>>|<|>|\^)/;
    const parens = /^[()]/;
    const value = VALUE_PATTERN;

    let pos = 0;
    while (pos < expr.length) {
        // Skip whitespace
        if (/\s/.test(expr[pos])) {
            pos++;
            continue;
        }

        const char = expr[pos];

        // Try to match string literal (single or double quoted)
        if (char === '"' || char === "'") {
            const stringStart = pos;
            const quote = char;
            pos++; // Skip opening quote

            // Scan until closing quote (handle escaped quotes "")
            while (pos < expr.length) {
                if (expr[pos] === quote) {
                    // Check for doubled quote escape
                    if (pos + 1 < expr.length && expr[pos + 1] === quote) {
                        pos += 2; // Skip both quotes
                    } else {
                        pos++; // Skip closing quote
                        break;
                    }
                } else {
                    pos++;
                }
            }

            tokens.push({
                type: 'value',
                text: expr.substring(stringStart, pos),
                start: stringStart
            });
            continue;
        }

        const remaining = expr.substring(pos);

        // Try to match operator (check multi-char first)
        const opMatch = remaining.match(operators);
        if (opMatch) {
            tokens.push({ type: 'operator', text: opMatch[0], start: pos });
            pos += opMatch[0].length;
            continue;
        }

        // Try to match paren
        const parenMatch = remaining.match(parens);
        if (parenMatch) {
            tokens.push({ type: 'paren', text: parenMatch[0], start: pos });
            pos += 1;
            continue;
        }

        // Try to match value (number or identifier)
        const valMatch = remaining.match(value);
        if (valMatch) {
            tokens.push({ type: 'value', text: valMatch[0], start: pos });
            pos += valMatch[0].length;
            continue;
        }

        // Unknown character, skip
        pos++;
    }

    return tokens;
}

/**
 * Escapes special regex characters to prevent regex injection.
 * Use this when constructing RegExp from user input or file content.
 *
 * Security: This function prevents regex injection and ReDoS (Regular Expression Denial of Service)
 * attacks by escaping all special regex metacharacters.
 *
 * @param input - String to escape for use in regex pattern
 * @returns Escaped string safe for use in RegExp constructor
 * @throws TypeError if input is not a string
 */
export function escapeRegex(input: string): string {
    if (typeof input !== 'string') {
        throw new TypeError('escapeRegex expects a string input');
    }
    // Escape all special regex characters: . * + ? ^ $ { } ( ) | [ ] \
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Extension-only pragma comment for overriding case sensitivity per file, e.g.:
//   ; 64tass-langserv: case-sensitive
//   ; 64tass-langserv: case-insensitive
// This is a plain comment as far as 64tass itself is concerned - it has no
// in-source way to control case sensitivity (only the -C command-line flag),
// so this pragma only affects how this extension reads the file. It does not
// change what the real compiler does; keep -C in sync with it yourself.
const CASE_SENSITIVITY_PRAGMA = /^\s*;\s*64tass-langserv\s*:\s*(case-sensitive|case-insensitive)\s*$/i;

/**
 * Scan a document's text for the case-sensitivity pragma. Returns the first
 * match found (top to bottom), or null if the pragma isn't present.
 */
export function detectCaseSensitivityPragma(text: string): boolean | null {
    for (const line of text.split('\n')) {
        const match = line.match(CASE_SENSITIVITY_PRAGMA);
        if (match) {
            return match[1].toLowerCase() === 'case-sensitive';
        }
    }
    return null;
}

// Extension-only pragma for defining a symbol, mirroring 64tass's "-D label=value"
// command-line flag:
//   ; 64tass-langserv: define linking = 0
// Like the case-sensitivity pragma this is an ordinary comment to the assembler.
// It exists so build-time flags that a project passes with -D (and which therefore
// appear nowhere in the source) can still be resolved - most usefully to decide
// which .if branches are dead. Keep it in sync with the -D flags of your real build.
const DEFINE_PRAGMA = /^\s*;\s*64tass-langserv\s*:\s*define\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(\S+)\s*$/i;

export interface PragmaDefine {
    name: string;
    value: string;
    line: number;
    /** Column where the defined name starts, for the label's range */
    nameStart: number;
}

/**
 * Scan a document's text for "; 64tass-langserv: define NAME = VALUE" pragmas.
 * Later definitions of the same name win, matching how a re-assignable variable
 * behaves; all occurrences are returned so each can be indexed as a definition.
 */
export function detectDefinePragmas(text: string): PragmaDefine[] {
    const defines: PragmaDefine[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(DEFINE_PRAGMA);
        if (match) {
            defines.push({
                name: match[1],
                value: match[2],
                line: i,
                nameStart: lines[i].indexOf(match[1], lines[i].toLowerCase().indexOf('define'))
            });
        }
    }
    return defines;
}
