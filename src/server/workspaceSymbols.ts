import { SymbolInformation, SymbolKind, Location } from 'vscode-languageserver/node';
import { DocumentIndex, LabelDefinition, LabelKind } from './types';

/** How each kind of definition is reported to workspace symbol search. */
const SYMBOL_KINDS: Record<LabelKind, SymbolKind> = {
    code: SymbolKind.Function,
    data: SymbolKind.Field,
    const: SymbolKind.Constant,
    var: SymbolKind.Variable,
    proc: SymbolKind.Function,
    block: SymbolKind.Namespace,
    macro: SymbolKind.Function,
    function: SymbolKind.Function,
    struct: SymbolKind.Struct,
    union: SymbolKind.Struct,
    namespace: SymbolKind.Namespace
};

/**
 * Subsequence match, the behaviour editors expect from a symbol picker: "sinit"
 * matches "sprite_init". Case-insensitive, since the query is typed casually
 * regardless of how the symbol is stored.
 */
export function fuzzyMatches(query: string, name: string): boolean {
    if (query === '') return true;
    const q = query.toLowerCase();
    const n = name.toLowerCase();
    let qi = 0;
    for (let ni = 0; ni < n.length && qi < q.length; ni++) {
        if (n[ni] === q[qi]) qi++;
    }
    return qi === q.length;
}

/** Rank: exact name first, then prefix, then substring, then loose subsequence. */
function score(query: string, name: string): number {
    if (query === '') return 3;
    const q = query.toLowerCase();
    const n = name.toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return 3;
}

/**
 * Search every indexed document for symbols matching `query`
 * (LSP workspace/symbol - Ctrl+T).
 *
 * Anonymous labels are skipped: they have no name to search for. Local `_name`
 * symbols are included but carry their code label as the container, since their
 * bare name is rarely unique across a project.
 */
export function findWorkspaceSymbols(
    query: string,
    documentIndex: Map<string, DocumentIndex>,
    limit = 500
): SymbolInformation[] {
    const matches: { symbol: SymbolInformation; rank: number; name: string }[] = [];

    for (const [, index] of documentIndex) {
        for (const label of index.labels) {
            if (label.isAnonymous) continue;
            if (!fuzzyMatches(query, label.originalName)) continue;

            matches.push({
                rank: score(query, label.originalName),
                name: label.originalName,
                symbol: {
                    name: label.originalName,
                    kind: SYMBOL_KINDS[label.kind],
                    location: Location.create(label.uri, label.range),
                    containerName: containerOf(label)
                }
            });
        }
    }

    matches.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name));
    return matches.slice(0, limit).map(m => m.symbol);
}

/** Scope path a symbol lives in, or the code label for a local symbol. */
function containerOf(label: LabelDefinition): string | undefined {
    if (label.isLocal && label.localScope) {
        return label.scopePath ? `${label.scopePath}.${label.localScope}` : label.localScope;
    }
    return label.scopePath ?? undefined;
}
