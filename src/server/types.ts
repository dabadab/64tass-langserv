import { Range } from 'vscode-languageserver/node';

// What kind of definition a label came from. Used to decide where it's valid to
// suggest one (e.g. a .macro name is never a valid opcode operand - macros are
// invoked as ".name", not referenced as an address).
export type LabelKind =
    | 'code'       // plain code label ("start:" or "start lda #1")
    | 'data'       // data-directive label ("table .byte 1,2,3") or a macro-call label
    | 'const'      // constant assignment ("val = $FF") or a local (_name) symbol
    | 'proc' | 'block' | 'macro' | 'function' | 'struct' | 'union' | 'namespace'; // scope openers

export interface LabelDefinition {
    // Symbol name in canonical form for matching (lowercase if case-insensitive, original case if case-sensitive)
    name: string;
    // Original symbol name preserving case (for display)
    originalName: string;
    uri: string;
    range: Range;
    // Full scope path for directive-based scopes (e.g., "outer.inner" or null for global)
    // Stored in canonical form for matching
    scopePath: string | null;
    // For local symbols (_name): the code label they belong to (in canonical form)
    localScope: string | null;
    // Whether this is a local symbol (starts with _)
    isLocal: boolean;
    // What kind of definition this came from (see LabelKind)
    kind: LabelKind;
    // Whether this is an anonymous label (+ or -)
    isAnonymous?: boolean;
    // For anonymous labels: count of symbols in definition (+++  = 3)
    anonymousCount?: number;
    value?: string;
    // Documentation comment from same line, line above, or line below
    comment?: string;
}

export interface DocumentIndex {
    labels: LabelDefinition[];
    // Maps line number to { scopePath, localScope }
    scopeAtLine: Map<number, { scopePath: string | null; localScope: string | null }>;
    // Maps scope path to list of parameter names (for .function and .macro)
    parametersAtScope: Map<string, string[]>;
    // Maps macro name to list of sub-labels it defines in its body
    macroSubLabels: Map<string, string[]>;
    // Maps label name to the macro used to define it (for labels defined via macro calls)
    labelDefinedByMacro: Map<string, string>;
    // URIs of files included via .include directive
    includes: string[];
    // The effective case-sensitivity this index was built with: either the
    // workspace's 64tass.caseSensitive setting, or a per-file override from a
    // "; 64tass-langserv: case-sensitive" / "case-insensitive" pragma (see
    // detectCaseSensitivityPragma in utils.ts). Query-time lookups should use
    // this rather than assuming a single global value, since a pragma in one
    // compilation unit's root doesn't affect a sibling unit with no pragma.
    caseSensitive: boolean;
}
