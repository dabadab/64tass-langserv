import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentIndex } from './types';
import { IncludeGraph } from './includes';
import { parseDocument } from './parser';
import { detectCaseSensitivityPragma, detectCpu } from './utils';

/**
 * Everything indexing needs from the server, injected so the logic can be
 * exercised without an LSP connection.
 */
export interface IndexContext {
    /** The index being populated; mutated in place. */
    documentIndex: Map<string, DocumentIndex>;
    /** Which roots reach which included files; mutated in place. */
    includeGraph: IncludeGraph;
    /**
     * Text of a document by URI. MUST prefer the open buffer over the file on
     * disk - indexing has no other way to reach a document's contents, so this is
     * what keeps an include's unsaved edits from being reverted (see L3).
     */
    getDocumentText: (uri: string) => string | null;
    /** An open document by URI, if the editor has one. */
    getOpenDocument: (uri: string) => TextDocument | undefined;
    /** Workspace case-sensitivity, used when no pragma overrides it. */
    defaultCaseSensitive: boolean;
    /** Workspace CPU target, used when no directive or pragma overrides it. */
    defaultCpu: string;
    /**
     * Absolute directories searched for includes that are not next to the
     * includer, mirroring 64tass's `-I` flag (`64tass.includePaths`).
     */
    includePaths: readonly string[];
    log?: (message: string) => void;
}

/**
 * Index a document and, recursively, everything it `.include`s.
 *
 * A `label .binclude "f"` wraps f's contents in a block scope, so f is parsed with
 * that scope as its base and its symbols resolve as `label.sym`. Plain `.include`
 * is textual and keeps whatever scope is already in effect.
 *
 * Case sensitivity cascades: a pragma in a file overrides the inherited value for
 * that file and everything below it, so a whole compilation unit shares one
 * effective setting even when only its root declares it.
 *
 * An included file that is open in the editor is indexed from its buffer rather
 * than from disk, so unsaved edits are not silently reverted when the parent is
 * re-indexed.
 */
export function indexDocument(
    document: TextDocument,
    context: IndexContext,
    indexedUris: Set<string> = new Set(),
    rootUri?: string,
    inheritedCaseSensitive: boolean = context.defaultCaseSensitive,
    inheritedCpu: string = context.defaultCpu,
    // Scope this document's contents belong to, non-null once a `.binclude` above
    // it opened one. Inherited by plain `.include`s, since those are textual.
    baseScope: string | null = null
): void {
    // Prevent circular includes
    if (indexedUris.has(document.uri)) {
        return;
    }
    indexedUris.add(document.uri);

    // The root URI is the top-level document that initiated the indexing
    const effectiveRootUri = rootUri ?? document.uri;

    const text = document.getText();
    const pragma = detectCaseSensitivityPragma(text);
    const effectiveCaseSensitive = pragma ?? inheritedCaseSensitive;
    // Same cascade as case sensitivity: a `.cpu` directive or cpu pragma in this
    // file applies to it and everything it includes, unless one of those overrides
    // it again further down.
    const effectiveCpu = detectCpu(text) ?? inheritedCpu;

    const index = parseDocument(document, {
        caseSensitive: effectiveCaseSensitive,
        log: context.log,
        cpu: effectiveCpu,
        baseScope,
        includePaths: context.includePaths,
    });
    context.documentIndex.set(document.uri, index);

    for (const includeUri of index.includes) {
        // Track that this root document references this included file
        context.includeGraph.addRef(includeUri, effectiveRootUri);

        if (indexedUris.has(includeUri)) continue;

        // getDocumentText returns the open buffer when there is one, so an include
        // being edited is indexed from its unsaved contents rather than from disk.
        // Reusing the open TextDocument directly avoids re-creating it.
        const includeDoc = context.getOpenDocument(includeUri)
            ?? createDocument(includeUri, context.getDocumentText(includeUri));
        if (!includeDoc) continue;

        // A .binclude records the full scope path its contents land in; a plain
        // .include has no entry and simply stays in whatever scope we are already in.
        const childScope = index.includeScopes.get(includeUri) ?? baseScope;
        indexDocument(includeDoc, context, indexedUris, effectiveRootUri, effectiveCaseSensitive, effectiveCpu, childScope);
    }
}

function createDocument(uri: string, content: string | null): TextDocument | null {
    return content === null ? null : TextDocument.create(uri, '64tass', 1, content);
}

/**
 * Remove a root's include references, returning the URIs no root reaches any
 * more. An orphan is only dropped from the index if it is not open in its own
 * right - an open document keeps its entry regardless of who includes it.
 */
export function clearIncludeRefs(rootUri: string, context: IndexContext): void {
    for (const uri of context.includeGraph.clearRoot(rootUri)) {
        if (!context.getOpenDocument(uri)) context.documentIndex.delete(uri);
    }
}
