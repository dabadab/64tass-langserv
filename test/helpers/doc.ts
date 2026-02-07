import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument } from '../../src/server/parser';
import { DocumentIndex } from '../../src/server/types';

let docCounter = 0;

/** Create a TextDocument from source code string. */
export function createDoc(source: string, uri?: string): TextDocument {
    const effectiveUri = uri ?? `file:///test-${++docCounter}.asm`;
    return TextDocument.create(effectiveUri, '64tass', 1, source);
}

/** Parse a source string and return {doc, index}. */
export function createAndParse(source: string, uri?: string, caseSensitive = false) {
    const doc = createDoc(source, uri);
    const index = parseDocument(doc, caseSensitive);
    return { doc, index };
}

/** Build a documentIndex Map from source strings. */
export function buildIndex(...args: Array<{ source: string; uri?: string; caseSensitive?: boolean }>): {
    documentIndex: Map<string, DocumentIndex>;
    docs: TextDocument[];
} {
    // Extract caseSensitive from first argument if provided
    const caseSensitive = args[0]?.caseSensitive ?? false;
    const documentIndex = new Map<string, DocumentIndex>();
    const docs: TextDocument[] = [];
    for (const { source, uri } of args) {
        const { doc, index } = createAndParse(source, uri, caseSensitive);
        documentIndex.set(doc.uri, index);
        docs.push(doc);
    }
    return { documentIndex, docs };
}
