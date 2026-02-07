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

// Tokenize an expression into values, operators, and parentheses
// Used for validating operator presence between data directive values
export function tokenizeExpression(expr: string): Token[] {
    const tokens: Token[] = [];
    const operators = /^(,|\+|-|\*|\/|&|\||<<|>>|<|>|\^)/;
    const parens = /^[()]/;
    const value = /^(\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|%[01]+|0b[01]+|\d+|[a-zA-Z_][a-zA-Z0-9_]*)/;

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
