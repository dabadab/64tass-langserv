import { SignatureHelp, SignatureInformation, ParameterInformation } from 'vscode-languageserver/node';
import { DocumentIndex } from './types';
import { parseLineStructure } from './utils';

/**
 * A call being typed on the current line: which callable, and which argument the
 * cursor is in.
 *
 * Recognises the three call forms 64tass accepts (all verified against the
 * assembler): "#name arg, arg" and ".name arg, arg" for macros, and
 * "name(arg, arg)" for functions.
 */
export interface CallContext {
    name: string;
    /** Zero-based index of the argument the cursor sits in. */
    argumentIndex: number;
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
                    return { name: name[1], argumentIndex: countArguments(code.slice(i + 1)) };
                }
                return null;
            }
            depth--;
        }
    }

    // Macro call: "#name args" or ".name args" as the statement on this line
    const macro = code.match(/^\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\s*:?\s+)?[#.]([a-zA-Z_][a-zA-Z0-9_]*)(\s+[\s\S]*)?$/);
    if (macro && macro[2] !== undefined) {
        return { name: macro[1], argumentIndex: countArguments(macro[2]) };
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
 * Build signature help for the call under the cursor (LSP textDocument/signatureHelp).
 *
 * Parameter names come from parametersAtScope, which the parser already fills in
 * for .macro and .function definitions.
 */
export function getSignatureHelp(
    linePrefix: string,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive = false
): SignatureHelp | null {
    const call = findCallContext(linePrefix);
    if (!call) return null;

    const lookup = caseSensitive ? call.name : call.name.toLowerCase();

    for (const [, index] of documentIndex) {
        const parameters = index.parametersAtScope.get(lookup);
        if (!parameters || parameters.length === 0) continue;

        // Prefer the definition's own casing for the label
        const label = index.labels.find(l => l.name === lookup)?.originalName ?? call.name;

        const signature: SignatureInformation = {
            label: `${label}(${parameters.join(', ')})`,
            parameters: parameters.map((p): ParameterInformation => ({ label: p }))
        };

        return {
            signatures: [signature],
            activeSignature: 0,
            // Clamp: typing past the last parameter should keep highlighting it
            activeParameter: Math.min(call.argumentIndex, parameters.length - 1)
        };
    }

    return null;
}
