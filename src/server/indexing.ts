import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentIndex } from './types';
import { IncludeGraph } from './includes';
import { parseDocument } from './parser';
import { detectCaseSensitivityPragma } from './utils';

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
    log?: (message: string) => void;
}

/**
 * Index a document and, recursively, everything it `.include`s.
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
    inheritedCaseSensitive: boolean = context.defaultCaseSensitive
): void {
    // Prevent circular includes
    if (indexedUris.has(document.uri)) {
        return;
    }
    indexedUris.add(document.uri);

    // The root URI is the top-level document that initiated the indexing
    const effectiveRootUri = rootUri ?? document.uri;

    const pragma = detectCaseSensitivityPragma(document.getText());
    const effectiveCaseSensitive = pragma ?? inheritedCaseSensitive;

    const index = parseDocument(document, effectiveCaseSensitive, context.log);
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

        indexDocument(includeDoc, context, indexedUris, effectiveRootUri, effectiveCaseSensitive);
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
