import { DocumentSymbol, SymbolKind, Range, Position } from 'vscode-languageserver/node';
import { DocumentIndex, LabelDefinition, LabelKind } from './types';

/**
 * Stand-in for "end of line": the outline has no access to line lengths, and the
 * LSP caps a character offset at uinteger max, so MAX_SAFE_INTEGER is rejected.
 */
const END_OF_LINE = 2147483647;

/** How each kind of definition shows up in the outline. */
const SYMBOL_KINDS: Record<LabelKind, SymbolKind> = {
    code: SymbolKind.Function,      // a code label is a jump target
    data: SymbolKind.Field,
    const: SymbolKind.Constant,
    var: SymbolKind.Variable,
    proc: SymbolKind.Function,
    block: SymbolKind.Namespace,
    macro: SymbolKind.Function,
    function: SymbolKind.Function,
    struct: SymbolKind.Struct,
    union: SymbolKind.Struct,       // LSP has no Union kind
    namespace: SymbolKind.Namespace
};

/** Kinds that open a scope, and therefore can contain other symbols. */
const SCOPE_KINDS: ReadonlySet<LabelKind> = new Set<LabelKind>([
    'proc', 'block', 'macro', 'function', 'struct', 'union', 'namespace'
]);

/** The scope path a scope-opening label introduces, e.g. "outer" + "inner" -> "outer.inner". */
function childScopePath(label: LabelDefinition): string {
    return label.scopePath ? `${label.scopePath}.${label.name}` : label.name;
}

/**
 * Line extent of every scope, derived from scopeAtLine: a scope covers every line
 * recorded as being in it or in one of its descendants. Lets the outline give each
 * scope a range spanning its body rather than just its name, which is what
 * breadcrumbs and "expand selection" use to decide what the cursor is inside of.
 */
function scopeExtents(index: DocumentIndex): Map<string, { start: number; end: number }> {
    const extents = new Map<string, { start: number; end: number }>();

    const widen = (path: string, line: number) => {
        const current = extents.get(path);
        if (!current) extents.set(path, { start: line, end: line });
        else {
            if (line < current.start) current.start = line;
            if (line > current.end) current.end = line;
        }
    };

    for (const [line, scope] of index.scopeAtLine) {
        if (!scope.scopePath) continue;
        // A line in "a.b.c" also lies within "a.b" and "a"
        const parts = scope.scopePath.split('.');
        for (let i = 1; i <= parts.length; i++) {
            widen(parts.slice(0, i).join('.'), line);
        }
    }
    return extents;
}

/**
 * Build the hierarchical outline for a document (LSP textDocument/documentSymbol).
 *
 * Symbols nest by directive scope (`.proc`/`.block`/...), and local `_name`
 * symbols nest under the code label they belong to. Anonymous labels (+ / -) are
 * omitted: they have no name and would fill the outline with noise.
 */
export function buildDocumentSymbols(index: DocumentIndex): DocumentSymbol[] {
    const extents = scopeExtents(index);
    const roots: DocumentSymbol[] = [];

    // Scope path -> the symbol representing it, so children can be attached
    const scopeSymbols = new Map<string, DocumentSymbol>();
    // "scopePath\0codeLabelName" -> that code label's symbol, for local symbols
    const codeLabels = new Map<string, DocumentSymbol>();

    const childrenOf = (symbol: DocumentSymbol): DocumentSymbol[] =>
        (symbol.children ??= []);

    for (const label of index.labels) {
        if (label.isAnonymous) continue;

        const isScope = SCOPE_KINDS.has(label.kind);
        const scopePath = isScope ? childScopePath(label) : null;
        const extent = scopePath ? extents.get(scopePath) : undefined;

        // A scope spans its body; anything else is just its own name
        const range = extent
            ? Range.create(
                Position.create(Math.min(extent.start, label.range.start.line), 0),
                Position.create(Math.max(extent.end, label.range.end.line), END_OF_LINE))
            : label.range;

        const symbol: DocumentSymbol = {
            name: label.originalName,
            kind: SYMBOL_KINDS[label.kind],
            range,
            selectionRange: label.range,
            detail: label.value !== undefined ? `= ${label.value}` : undefined
        };

        // Attach to the innermost container we know about
        const parent = label.isLocal && label.localScope
            ? codeLabels.get(`${label.scopePath ?? ''}\0${label.localScope}`)
            : undefined;
        const container = parent ?? (label.scopePath ? scopeSymbols.get(label.scopePath) : undefined);

        if (container) childrenOf(container).push(symbol);
        else roots.push(symbol);

        if (scopePath) scopeSymbols.set(scopePath, symbol);
        if (label.kind === 'code') codeLabels.set(`${label.scopePath ?? ''}\0${label.name}`, symbol);
    }

    return roots;
}
