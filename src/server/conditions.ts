import { DocumentIndex } from './types';
import { findSymbolInfo } from './symbols';
import { parseNumericValue } from './utils';

/**
 * Result of evaluating a conditional expression.
 * `null` means "could not be determined" - the deliberate default whenever
 * anything is unrecognised, so an undecidable condition never suppresses
 * diagnostics.
 */
export type Truth = boolean | null;

type Ctx = {
    uri: string;
    line: number;
    documentIndex: Map<string, DocumentIndex>;
    caseSensitive: boolean;
    /** guards against a symbol whose value refers back to itself */
    seen: Set<string>;
};

/**
 * Evaluate a .if/.elsif condition to a definite true/false, or null when it
 * cannot be decided statically.
 *
 * Supports what 64tass conditions in practice actually use (all verified against
 * the assembler): numeric literals, symbols resolved through the index, ! && ||,
 * the comparisons = == != < > <= >=, + - * /, and parentheses. Anything else -
 * the program counter "*", string values, unresolvable symbols - yields null.
 *
 * Deliberately conservative: callers use a definite `false` to mark a branch dead,
 * so a wrong `false` would hide real diagnostics, whereas a null costs nothing.
 */
export function evaluateCondition(
    expr: string,
    uri: string,
    line: number,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive = false
): Truth {
    const value = evalExpr(expr, { uri, line, documentIndex, caseSensitive, seen: new Set() });
    if (value === null) return null;
    return value !== 0;
}

/** Evaluate an expression to a number, or null if undecidable. */
function evalExpr(expr: string, ctx: Ctx): number | null {
    const tokens = tokenize(expr);
    if (tokens === null || tokens.length === 0) return null;
    const parser = new Parser(tokens, ctx);
    const value = parser.parseOr();
    // Any trailing tokens mean we did not understand the whole expression
    if (value === null || !parser.atEnd()) return null;
    return value;
}

const TOKEN_PATTERN = /^(\s+|\$[0-9a-fA-F]+|%[01]+|\d+|[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*|<=|>=|==|!=|&&|\|\||[-+*/()<>!=])/;

function tokenize(expr: string): string[] | null {
    const tokens: string[] = [];
    let rest = expr.trim();
    while (rest.length > 0) {
        const m = rest.match(TOKEN_PATTERN);
        if (!m) return null; // unrecognised character - refuse to guess
        if (m[1].trim() !== '') tokens.push(m[1]);
        rest = rest.slice(m[1].length);
    }
    return tokens;
}

class Parser {
    private pos = 0;
    constructor(private tokens: string[], private ctx: Ctx) {}

    atEnd(): boolean { return this.pos >= this.tokens.length; }
    private peek(): string | undefined { return this.tokens[this.pos]; }
    private take(): string | undefined { return this.tokens[this.pos++]; }

    parseOr(): number | null {
        let left = this.parseAnd();
        while (left !== null && this.peek() === '||') {
            this.take();
            const right = this.parseAnd();
            if (right === null) return null;
            left = (left !== 0 || right !== 0) ? 1 : 0;
        }
        return left;
    }

    private parseAnd(): number | null {
        let left = this.parseComparison();
        while (left !== null && this.peek() === '&&') {
            this.take();
            const right = this.parseComparison();
            if (right === null) return null;
            left = (left !== 0 && right !== 0) ? 1 : 0;
        }
        return left;
    }

    private parseComparison(): number | null {
        const left = this.parseAdditive();
        if (left === null) return null;
        const op = this.peek();
        if (op && ['=', '==', '!=', '<', '>', '<=', '>='].includes(op)) {
            this.take();
            const right = this.parseAdditive();
            if (right === null) return null;
            switch (op) {
                case '=': case '==': return left === right ? 1 : 0;
                case '!=': return left !== right ? 1 : 0;
                case '<': return left < right ? 1 : 0;
                case '>': return left > right ? 1 : 0;
                case '<=': return left <= right ? 1 : 0;
                case '>=': return left >= right ? 1 : 0;
            }
        }
        return left;
    }

    private parseAdditive(): number | null {
        let left = this.parseMultiplicative();
        while (left !== null && (this.peek() === '+' || this.peek() === '-')) {
            const op = this.take();
            const right = this.parseMultiplicative();
            if (right === null) return null;
            left = op === '+' ? left + right : left - right;
        }
        return left;
    }

    private parseMultiplicative(): number | null {
        let left = this.parseUnary();
        while (left !== null && (this.peek() === '*' || this.peek() === '/')) {
            const op = this.take();
            const right = this.parseUnary();
            if (right === null) return null;
            if (op === '/' && right === 0) return null; // don't decide on a division by zero
            left = op === '*' ? left * right : Math.trunc(left / right);
        }
        return left;
    }

    private parseUnary(): number | null {
        if (this.peek() === '!') {
            this.take();
            const v = this.parseUnary();
            return v === null ? null : (v === 0 ? 1 : 0);
        }
        if (this.peek() === '-') {
            this.take();
            const v = this.parseUnary();
            return v === null ? null : -v;
        }
        if (this.peek() === '+') {
            this.take();
            return this.parseUnary();
        }
        return this.parsePrimary();
    }

    private parsePrimary(): number | null {
        const tok = this.take();
        if (tok === undefined) return null;

        if (tok === '(') {
            const v = this.parseOr();
            if (v === null || this.take() !== ')') return null;
            return v;
        }

        const numeric = parseNumericValue(tok);
        if (numeric !== null) return numeric;

        if (/^[a-zA-Z_]/.test(tok)) return this.resolveSymbol(tok);

        return null; // "*" (program counter) and anything else: undecidable
    }

    /** Resolve a symbol to a number through the index, following one level of value. */
    private resolveSymbol(name: string): number | null {
        const { uri, line, documentIndex, caseSensitive, seen } = this.ctx;
        if (seen.has(name)) return null; // self-referential definition
        const symbol = findSymbolInfo(name, uri, line, documentIndex, caseSensitive);
        if (!symbol || symbol.value === undefined) return null;

        const direct = parseNumericValue(symbol.value);
        if (direct !== null) return direct;

        // The value may itself be an expression over other constants
        return evalExpr(symbol.value, { ...this.ctx, seen: new Set([...seen, name]) });
    }
}
