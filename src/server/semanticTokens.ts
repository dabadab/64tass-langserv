import { DocumentIndex, LabelKind } from './types';
import { OPCODES, BUILTINS, ALL_DIRECTIVES } from './constants';
import { parseLineStructure, stripStrings } from './utils';
import { findSymbolInfo, isParameter } from './symbols';

/**
 * Token types this server emits, in the order the client legend expects.
 * Semantic tokens exist to say what the TextMate grammar cannot: whether a
 * ".name" is a builtin directive or a call to a user macro, and what kind of
 * thing a bare identifier actually refers to.
 */
export const TOKEN_TYPES = [
    'namespace',
    'function',
    'macro',
    'variable',
    'property',
    'parameter',
    'keyword'
] as const;

export const TOKEN_MODIFIERS = [
    'declaration',
    'readonly',
    'defaultLibrary'
] as const;

export type TokenType = typeof TOKEN_TYPES[number];

export interface SemanticToken {
    line: number;
    startCharacter: number;
    length: number;
    tokenType: TokenType;
    /** Modifier names; encoded as a bitset by the caller */
    tokenModifiers: string[];
}

/** What a symbol of each kind should look like. */
const KIND_TOKEN: Record<LabelKind, TokenType> = {
    code: 'function',
    data: 'property',
    const: 'variable',
    var: 'variable',
    proc: 'function',
    block: 'namespace',
    macro: 'macro',
    function: 'function',
    struct: 'namespace',
    union: 'namespace',
    namespace: 'namespace'
};

const DIRECTIVE_SET = new Set(ALL_DIRECTIVES);

/** Encode modifier names into the bitset the protocol uses. */
export function encodeModifiers(modifiers: string[]): number {
    let bits = 0;
    for (const modifier of modifiers) {
        const index = TOKEN_MODIFIERS.indexOf(modifier as typeof TOKEN_MODIFIERS[number]);
        if (index >= 0) bits |= 1 << index;
    }
    return bits;
}

/**
 * Classify every identifier in a document.
 *
 * Only emits a token where the classification is known: an unresolvable
 * identifier is left alone so the TextMate grammar's colouring stands, rather
 * than being overridden with a guess.
 */
export function buildSemanticTokens(
    text: string,
    uri: string,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive = false
): SemanticToken[] {
    const tokens: SemanticToken[] = [];
    const index = documentIndex.get(uri);
    if (!index) return tokens;

    const lines = text.split('\n');
    const normalize = (name: string) => caseSensitive ? name : name.toLowerCase();

    // Definitions by position, so a label's own declaration is marked as such
    const declarations = new Map<string, LabelKind>();
    for (const label of index.labels) {
        if (label.isAnonymous) continue;
        declarations.set(`${label.range.start.line}:${label.range.start.character}`, label.kind);
    }

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        // Strings blanked (offsets preserved) so text inside a literal is not classified
        const code = stripStrings(parseLineStructure(lines[lineNum]).code);
        const scope = index.scopeAtLine.get(lineNum);

        // ".something": either a builtin directive or a call to a user macro
        const dotted = /\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let dotMatch;
        while ((dotMatch = dotted.exec(code)) !== null) {
            // Skip the ".member" half of a qualified reference like tbl.lo
            if (dotMatch.index > 0 && /[a-zA-Z0-9_]/.test(code[dotMatch.index - 1])) continue;

            const name = normalize(dotMatch[1]);
            if (DIRECTIVE_SET.has(name)) {
                tokens.push({
                    line: lineNum,
                    startCharacter: dotMatch.index,
                    length: dotMatch[0].length,
                    tokenType: 'keyword',
                    tokenModifiers: ['defaultLibrary']
                });
            } else if (findSymbolInfo(`.${dotMatch[1]}`, uri, lineNum, documentIndex, caseSensitive)) {
                // Resolves to a user-defined symbol: a macro invocation
                tokens.push({
                    line: lineNum,
                    startCharacter: dotMatch.index + 1,
                    length: dotMatch[1].length,
                    tokenType: 'macro',
                    tokenModifiers: []
                });
            }
        }

        // Bare identifiers
        const word = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
        let wordMatch;
        while ((wordMatch = word.exec(code)) !== null) {
            const start = wordMatch.index;
            const name = wordMatch[0];

            // Part of a dotted construct - handled above, or a qualified member
            if (start > 0 && code[start - 1] === '.') continue;

            const lower = name.toLowerCase();
            if (OPCODES.has(lower)) continue;   // opcodes are the grammar's job
            if (BUILTINS.has(lower)) continue;  // registers and builtin functions

            const declared = declarations.get(`${lineNum}:${start}`);
            if (declared) {
                tokens.push({
                    line: lineNum,
                    startCharacter: start,
                    length: name.length,
                    tokenType: KIND_TOKEN[declared],
                    tokenModifiers: declared === 'const' ? ['declaration', 'readonly'] : ['declaration']
                });
                continue;
            }

            if (isParameter(name, scope?.scopePath ?? null, index, caseSensitive)) {
                tokens.push({
                    line: lineNum, startCharacter: start, length: name.length,
                    tokenType: 'parameter', tokenModifiers: []
                });
                continue;
            }

            const symbol = findSymbolInfo(name, uri, lineNum, documentIndex, caseSensitive);
            if (symbol) {
                tokens.push({
                    line: lineNum,
                    startCharacter: start,
                    length: name.length,
                    tokenType: KIND_TOKEN[symbol.kind],
                    tokenModifiers: symbol.kind === 'const' ? ['readonly'] : []
                });
            }
            // else: unknown - leave it to the grammar rather than guessing
        }
    }

    return tokens.sort((a, b) => a.line - b.line || a.startCharacter - b.startCharacter);
}
