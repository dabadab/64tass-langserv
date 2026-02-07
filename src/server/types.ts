import { Range } from 'vscode-languageserver/node';

export interface LabelDefinition {
    // Symbol name in lowercase (64tass is case-insensitive)
    name: string;
    // Original symbol name preserving case (for display)
    originalName: string;
    uri: string;
    range: Range;
    // Full scope path for directive-based scopes (e.g., "outer.inner" or null for global)
    // Stored lowercase for case-insensitive matching
    scopePath: string | null;
    // For local symbols (_name): the code label they belong to (lowercase)
    localScope: string | null;
    // Whether this is a local symbol (starts with _)
    isLocal: boolean;
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
}
