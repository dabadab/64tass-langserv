import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument } from '../../src/server/parser';
import { DocumentIndex } from '../../src/server/types';
import { DEFAULT_CPU } from '../../src/server/constants';

let docCounter = 0;

/** Create a TextDocument from source code string. */
export function createDoc(source: string, uri?: string): TextDocument {
    const effectiveUri = uri ?? `file:///test-${++docCounter}.asm`;
    return TextDocument.create(effectiveUri, '64tass', 1, source);
}

/** Parse a source string and return {doc, index}. */
export function createAndParse(source: string, uri?: string, caseSensitive = false) {
    const doc = createDoc(source, uri);
    const index = parseDocument(doc, { caseSensitive });
    return { doc, index };
}

export interface BuildIndexSource {
    source: string;
    uri?: string;
    /**
     * Case sensitivity for THIS document. Omitted documents fall back to the
     * first entry's value, so `buildIndex({ source, caseSensitive: true })` still
     * applies to every document - but each entry may override it, which is what
     * the per-document pragma cascade produces in practice.
     */
    caseSensitive?: boolean;
}

/** Build a documentIndex Map from source strings. */
export function buildIndex(...args: BuildIndexSource[]): {
    documentIndex: Map<string, DocumentIndex>;
    docs: TextDocument[];
} {
    // Default for entries that don't specify their own
    const fallback = args[0]?.caseSensitive ?? false;
    const documentIndex = new Map<string, DocumentIndex>();
    const docs: TextDocument[] = [];
    for (const { source, uri, caseSensitive } of args) {
        const { doc, index } = createAndParse(source, uri, caseSensitive ?? fallback);
        documentIndex.set(doc.uri, index);
        docs.push(doc);
    }
    return { documentIndex, docs };
}

/**
 * An empty DocumentIndex, for tests that need one field set and do not care
 * about the rest. Building these by hand goes stale silently whenever the
 * interface grows, so go through here instead.
 */
export function emptyIndex(overrides: Partial<DocumentIndex> = {}): DocumentIndex {
    return {
        labels: [],
        labelsByName: new Map(),
        scopeAtLine: new Map(),
        parametersAtScope: new Map(),
        macroSubLabels: new Map(),
        labelDefinedByMacro: new Map(),
        functionReturnScope: new Map(),
        structInstances: new Map(),
        includes: [],
        includeScopes: new Map(),
        caseSensitive: false,
        cpu: DEFAULT_CPU,
        ...overrides,
    };
}
