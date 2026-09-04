import { SignatureHelp, SignatureInformation, ParameterInformation } from 'vscode-languageserver/node';
import { DocumentIndex, LabelDefinition } from './types';
import { findSymbolInfo } from './symbols';
import { parseLineStructure } from './utils';
import { OPCODES } from './constants';

/**
 * A call being typed on the current line: which callable, and which argument the
 * cursor is in.
 *
 * Recognises every call form 64tass accepts, all verified against the assembler
 * and all four legal for a `.function` as much as a `.macro`: "#name arg, arg",
 * ".name arg, arg", a bare "name arg, arg" as the statement on the line, and
 * "name(arg, arg)" inside an expression.
 */
export interface CallContext {
    name: string;
    /** Zero-based index of the argument the cursor sits in. */
    argumentIndex: number;
    /**
     * How this call is being written. The popup follows the CALL rather than the
     * declaration: `PTR_SET` may be a `.function` and still be invoked as a
     * statement, which is how whole projects use them, and showing parentheses
     * there describes a line the user is not typing.
     */
    form: 'paren' | 'statement';
}

/**
 * Identify the call the cursor is inside, given the text of the line up to it.
 * Returns null when the cursor is not within a call's argument list.
 */
export function findCallContext(linePrefix: string): CallContext | null {
    // Only the code portion matters; a call cannot start inside a comment
    const code = parseLineStructure(linePrefix).code;

    // Function call: name( ... - take the innermost unclosed parenthesis
    let depth = 0;
    for (let i = code.length - 1; i >= 0; i--) {
        const ch = code[i];
        if (ch === ')') depth++;
        else if (ch === '(') {
            if (depth === 0) {
                const before = code.slice(0, i);
                const name = before.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
                if (name) {
                    return { name: name[1], argumentIndex: countArguments(code.slice(i + 1)), form: 'paren' };
                }
                return null;
            }
            depth--;
        }
    }

    // Prefixed call: "#name args" or ".name args" as the statement on this line
    const prefixed = code.match(/^\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\s*:?\s+)?[#.]([a-zA-Z_][a-zA-Z0-9_]*)(\s+[\s\S]*)?$/);
    if (prefixed && prefixed[2] !== undefined) {
        return { name: prefixed[1], argumentIndex: countArguments(prefixed[2]), form: 'statement' };
    }

    // Bare call: "name args", the form 64tass warns about with -Wmacro-prefix and
    // accepts all the same. Whether the name IS callable is mostly the caller's
    // business - `start lda #1` looks identical and finds no parameters, so
    // nothing is shown - but an instruction is filtered out here, since the
    // assembler reads `nop ` as one whatever a macro of that name might say.
    const bare = code.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)(\s+[\s\S]*)$/);
    // A directive after the name makes it a definition (`PTR_SET .function a, b`)
    // or a data label, and `=` an assignment: never a call.
    if (bare && !/^\s*[.#]/.test(bare[2]) && !/^\s*:?=/.test(bare[2])
        && !OPCODES.has(bare[1].toLowerCase())) {
        return { name: bare[1], argumentIndex: countArguments(bare[2]), form: 'statement' };
    }

    return null;
}

/** Arguments already separated by a comma, ignoring commas nested in parentheses. */
function countArguments(args: string): number {
    let count = 0;
    let depth = 0;
    for (const ch of args) {
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) count++;
    }
    return count;
}

/**
 * Where a macro's or function's parameters are keyed: `parametersAtScope` and its
 * two companions are all keyed by FULL scope path, so a bare name finds nothing
 * for anything defined inside a `.proc`, `.block` or `.namespace`.
 */
export function calleeScopePath(symbol: LabelDefinition): string {
    return symbol.scopePath ? `${symbol.scopePath}.${symbol.name}` : symbol.name;
}

/**
 * How a call is written, and where each parameter sits in that text.
 *
 * The way the thing is actually invoked: `fn(a, b)` for a function, `mac a, b`
 * for a macro, which 64tass calls as `#mac 1, 2` - it does NOT take arguments
 * separated by spaces (verified: `#mac 1 2` is "2nd argument is missing").
 *
 * The parameter positions are offsets rather than substrings because that is
 * what makes the client bold the RIGHT one: a substring match would find `val`
 * inside `value`, and a parameter written twice would always highlight the first.
 */
export function callSignature(
    name: string,
    parameters: readonly string[],
    form: 'paren' | 'statement'
): { label: string; parameters: ParameterInformation[] } {
    const open = form === 'paren' ? '(' : ' ';
    const close = form === 'paren' ? ')' : '';

    let label = `${name}${open}`;
    const marks: ParameterInformation[] = [];
    parameters.forEach((parameter, i) => {
        if (i > 0) label += ', ';
        marks.push({ label: [label.length, label.length + parameter.length] });
        label += parameter;
    });
    return { label: label + close, parameters: marks };
}

/**
 * Build signature help for the call under the cursor (LSP textDocument/signatureHelp).
 *
 * Parameter names come from parametersAtScope, which the parser already fills in
 * for .macro and .function definitions.
 */
export function getSignatureHelp(
    linePrefix: string,
    uri: string,
    line: number,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive = false,
    unit?: ReadonlySet<string>
): SignatureHelp | null {
    const call = findCallContext(linePrefix);
    if (!call) return null;

    // Resolved like any other reference, rather than looked up by bare name in
    // whichever document came first: the maps are keyed by full scope path, so a
    // macro inside a `.proc` never matched - and taking the first document to
    // carry the name made the answer depend on indexing order.
    const callee = findSymbolInfo(call.name, uri, line, documentIndex, caseSensitive, true, unit);
    if (!callee || (callee.kind !== 'macro' && callee.kind !== 'function')) return null;

    const index = documentIndex.get(callee.uri);
    const path = calleeScopePath(callee);
    const parameters = index?.parametersAtScope.get(path);
    if (!parameters || parameters.length === 0) return null;

    // The definition's own wording for the parameters - `parametersAtScope` has
    // them normalized for matching, which is not what a caller wants to read.
    const declared = index?.parameterTextAtScope.get(path) ?? parameters;
    const built = callSignature(callee.originalName, declared, call.form);

    const signature: SignatureInformation = {
        label: built.label,
        parameters: built.parameters,
    };

    return {
        signatures: [signature],
        activeSignature: 0,
        // Clamp: typing past the last parameter should keep highlighting it
        activeParameter: Math.min(call.argumentIndex, parameters.length - 1)
    };
}
