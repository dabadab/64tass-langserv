import { DocumentIndex } from './types';
import { countDefinitions, findSymbolInfo } from './symbols';
import { parseNumericValue, parseLineStructure, stripStrings, findCommentBlockLines } from './utils';
import { BOUNDARY } from './blocks';

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
    /** Documents assembled together with `uri`; restricts symbol lookups. */
    unit?: ReadonlySet<string>;
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
    caseSensitive = false,
    unit?: ReadonlySet<string>
): Truth {
    const value = evalExpr(expr, { uri, line, documentIndex, caseSensitive, unit, seen: new Set() });
    if (value === null) return null;
    return value !== 0;
}

/**
 * Evaluate an expression to a number, or null when it cannot be decided - an
 * unresolved symbol, the program counter, a string, an operator not modelled.
 * Same conservative contract as evaluateCondition: never guess.
 */
export function evaluateExpression(
    expr: string,
    uri: string,
    line: number,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive = false,
    unit?: ReadonlySet<string>
): number | null {
    return evalExpr(expr, { uri, line, documentIndex, caseSensitive, unit, seen: new Set() });
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
            // 64tass FLOORS: `-7 / 2` is -4, not the -3 truncation gives
            // (verified - the assembler names the value in its own error).
            left = op === '*' ? left * right : Math.floor(left / right);
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
        const { uri, line, documentIndex, caseSensitive, unit, seen } = this.ctx;
        if (seen.has(name)) return null; // self-referential definition
        const symbol = findSymbolInfo(name, uri, line, documentIndex, caseSensitive, true, unit);
        if (!symbol || symbol.value === undefined) return null;
        // A `.var` assigned more than once has no single value here: which
        // assignment is in force depends on what the assembler executed to reach
        // this line (verified: after `v .var 1` / `v .var 2`, `.if v == 1` takes
        // the else branch, and deciding it from the first definition marked the
        // live branch dead and reported a symbol in the dead one).
        if (symbol.kind === 'var' && countDefinitions(symbol, uri, documentIndex, unit) > 1) return null;

        const direct = parseNumericValue(symbol.value);
        if (direct !== null) return direct;

        // The value may itself be an expression over other constants
        return evalExpr(symbol.value, { ...this.ctx, seen: new Set([...seen, name]) });
    }
}

/**
 * What a line does to a conditional chain, if anything.
 *
 * One classifier for both scanners - `findDeadLines` needs the condition text and
 * `computeBranchPaths` only the shape, but which lines COUNT has to be one
 * answer. They carried a regex each, on a boundary that did not match the one
 * `blockDirectivesOn` uses, so `lbl:.if 1` opened a block for the unclosed-block
 * check and no chain at all for these two (verified: the assembler takes it).
 */
export type ConditionalKind = 'open' | 'elsif' | 'else' | 'end';

export interface ConditionalLine {
    kind: ConditionalKind;
    /** The directive itself, lowercased: `.ifeq` is not decided like `.if`. */
    directive: string;
    /** Everything after it, for the branches that carry a condition. */
    condition: string;
}

const CONDITIONAL_PATTERNS: [ConditionalKind, RegExp][] = [
    ['end', new RegExp(`${BOUNDARY}\\.(endif|fi|endswitch)\\b(.*)$`, 'i')],
    ['open', new RegExp(`${BOUNDARY}\\.(if|ifeq|ifne|ifmi|ifpl|switch)\\b(.*)$`, 'i')],
    // `.case` and `.default` advance a branch exactly as `.elsif` does: a
    // `.switch` assembles at most one of them, so same-named labels in two cases
    // never coexist (verified - and twice in ONE case is a real duplicate, which
    // the branch numbering still catches).
    ['elsif', new RegExp(`${BOUNDARY}\\.(elsif|elif|case|default)\\b(.*)$`, 'i')],
    ['else', new RegExp(`${BOUNDARY}\\.(else)\\b(.*)$`, 'i')],
];

export function conditionalOn(code: string): ConditionalLine | null {
    for (const [kind, pattern] of CONDITIONAL_PATTERNS) {
        const match = code.match(pattern);
        if (match) return { kind, directive: match[1].toLowerCase(), condition: match[2] ?? '' };
    }
    return null;
}

/** One step of a line's position through nested conditionals. */
export interface BranchStep {
    /** Identifies the .if/.elsif/.else/.endif chain */
    chain: number;
    /** Which branch of that chain: 0 = .if, 1 = first .elsif/.else, ... */
    branch: number;
}

/**
 * Where each line sits within the document's conditional structure.
 *
 * Used to tell apart labels that merely *look* duplicated: the assembler
 * assembles at most one branch of a chain, so two definitions in different
 * branches never collide - regardless of whether the condition can be decided
 * statically. A line outside any conditional gets an empty path.
 */
export function computeBranchPaths(lines: string[]): Map<number, BranchStep[]> {
    // A `.comment` block holds prose, and prose says things like "disabled with
    // .if 0". Reading that as a conditional opens a chain that never closes and
    // marks the rest of the file dead (verified: 64tass reports the errors below
    // it, and the extension used to suppress them).
    const commentBlockLines = findCommentBlockLines(lines);
    const paths = new Map<number, BranchStep[]>();
    const stack: BranchStep[] = [];
    let nextChain = 0;

    for (let i = 0; i < lines.length; i++) {
        if (commentBlockLines.has(i)) continue;
        const code = stripStrings(parseLineStructure(lines[i]).code);

        const conditional = conditionalOn(code);

        if (conditional?.kind === 'end') {
            stack.pop();
            paths.set(i, [...stack]);
            continue;
        }

        if (conditional?.kind === 'open') {
            paths.set(i, [...stack]);
            stack.push({ chain: nextChain++, branch: 0 });
            continue;
        }

        if ((conditional?.kind === 'elsif' || conditional?.kind === 'else') && stack.length > 0) {
            // Replace the frame rather than mutating it: the stored paths share
            // these step objects, so mutating would retroactively rewrite the
            // branch recorded for every line already seen in this chain.
            const top = stack[stack.length - 1];
            stack[stack.length - 1] = { chain: top.chain, branch: top.branch + 1 };
            paths.set(i, [...stack]);
            continue;
        }

        paths.set(i, [...stack]);
    }

    return paths;
}

/**
 * Whether two lines can never both be assembled, because somewhere they sit in
 * different branches of the same conditional chain.
 */
export function areMutuallyExclusive(a: BranchStep[] = [], b: BranchStep[] = []): boolean {
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) {
        if (a[i].chain !== b[i].chain) return false; // diverged into unrelated chains
        if (a[i].branch !== b[i].branch) return true;
    }
    return false;
}
