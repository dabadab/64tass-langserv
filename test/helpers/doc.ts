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
export function createAndParse(source: string, uri?: string) {
    const doc = createDoc(source, uri);
    const index = parseDocument(doc);
    return { doc, index };
}

/** Build a documentIndex Map from source strings. */
export function buildIndex(...sources: Array<{ source: string; uri?: string }>): {
    documentIndex: Map<string, DocumentIndex>;
    docs: TextDocument[];
} {
    const documentIndex = new Map<string, DocumentIndex>();
    const docs: TextDocument[] = [];
    for (const { source, uri } of sources) {
        const { doc, index } = createAndParse(source, uri);
        documentIndex.set(doc.uri, index);
        docs.push(doc);
    }
    return { documentIndex, docs };
}
