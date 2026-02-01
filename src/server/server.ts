import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
    TextDocumentSyncKind,
    DefinitionParams,
    Location,
    Range,
    Position
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

interface LabelDefinition {
    name: string;
    uri: string;
    range: Range;
}

// Cache of label definitions per document
const labelIndex: Map<string, LabelDefinition[]> = new Map();

// Patterns for label definitions
const LABEL_PATTERNS = [
    // Label at start of line (with optional colon): "label:" or "label"
    /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/,
    // Label followed by directive: "label .macro", "label .function", "label .proc", etc.
    /^([a-zA-Z_][a-zA-Z0-9_]*)\s+\.(macro|function|proc|block|struct|union|segment)\b/i,
    // Label at line start followed by instruction or data directive
    /^([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:\.(byte|word|addr|fill|text|ptext|null)|[a-zA-Z]{3}\s)/i,
    // Label at line start alone on line or followed by comment
    /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:;|$)/,
    // Constant assignment: "label = value" or "label := value"
    /^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:?=\s*/,
    // Local label inside scope (indented, no leading underscore requirement in tass64)
    /^(\t+| {2,})([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|:?=|\.(byte|word|addr|fill)|\s*$)/,
];

function parseLabels(document: TextDocument): LabelDefinition[] {
    const labels: LabelDefinition[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];

        // Skip empty lines and comment-only lines
        if (/^\s*;/.test(line) || /^\s*$/.test(line)) {
            continue;
        }

        // Try each pattern
        let match: RegExpMatchArray | null = null;
        let labelName: string | null = null;
        let startChar = 0;

        // Pattern 1: Label with colon at start
        match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
        if (match) {
            labelName = match[1];
            startChar = 0;
        }

        // Pattern 2: Label followed by directive
        if (!labelName) {
            match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+\.(macro|function|proc|block|struct|union|segment)\b/i);
            if (match) {
                labelName = match[1];
                startChar = 0;
            }
        }

        // Pattern 3: Label followed by instruction or data
        if (!labelName) {
            match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:\.(byte|word|addr|fill|text|ptext|null|lohi_tbl|hilo_tbl|lo_tbl)|[A-Za-z]{3}\s)/i);
            if (match) {
                labelName = match[1];
                startChar = 0;
            }
        }

        // Pattern 4: Label alone or before comment
        if (!labelName) {
            match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:;|$)/);
            if (match && match[1].length > 0) {
                labelName = match[1];
                startChar = 0;
            }
        }

        // Pattern 5: Constant assignment (can be indented)
        if (!labelName) {
            match = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:?=/);
            if (match) {
                labelName = match[2];
                startChar = match[1].length;
            }
        }

        if (labelName) {
            labels.push({
                name: labelName,
                uri: document.uri,
                range: Range.create(
                    Position.create(lineNum, startChar),
                    Position.create(lineNum, startChar + labelName.length)
                )
            });
        }
    }

    return labels;
}

function indexDocument(document: TextDocument): void {
    const labels = parseLabels(document);
    labelIndex.set(document.uri, labels);
}

function getWordAtPosition(document: TextDocument, position: Position): string | null {
    const text = document.getText();
    const lines = text.split('\n');
    const line = lines[position.line];

    if (!line) return null;

    // Find word boundaries
    let start = position.character;
    let end = position.character;

    // Expand left
    while (start > 0 && /[a-zA-Z0-9_.]/.test(line[start - 1])) {
        start--;
    }

    // Expand right
    while (end < line.length && /[a-zA-Z0-9_.]/.test(line[end])) {
        end++;
    }

    const word = line.substring(start, end);
    return word.length > 0 ? word : null;
}

function findDefinition(word: string): Location | null {
    // Handle scoped references like "tbl.lo" - get the base name
    const baseName = word.split('.')[0];

    // Search all indexed documents
    for (const [uri, labels] of labelIndex) {
        for (const label of labels) {
            if (label.name === word || label.name === baseName) {
                return Location.create(uri, label.range);
            }
        }
    }

    return null;
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            definitionProvider: true
        }
    };
});

connection.onInitialized(() => {
    connection.console.log('tass64 language server initialized');

    // Index all currently open documents
    documents.all().forEach(indexDocument);
});

connection.onDefinition((params: DefinitionParams): Location | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    return findDefinition(word);
});

documents.onDidChangeContent(change => {
    // Re-index the document when it changes
    indexDocument(change.document);
});

documents.onDidClose(event => {
    // Remove from index when closed
    labelIndex.delete(event.document.uri);
});

documents.listen(connection);
connection.listen();
