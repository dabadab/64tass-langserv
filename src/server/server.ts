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
    Position,
    FoldingRangeParams,
    FoldingRange,
    FoldingRangeKind,
    HoverParams,
    Hover,
    MarkupKind,
    ReferenceParams,
    RenameParams,
    WorkspaceEdit,
    TextEdit,
    AnnotatedTextEdit,
    ChangeAnnotation,
    TextDocumentEdit,
    OptionalVersionedTextDocumentIdentifier
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { DocumentIndex } from './types';
import { FOLDING_PAIRS, CLOSING_DIRECTIVES } from './constants';
import { parseLineStructure, parseNumericValue, formatNumericValue, escapeRegex } from './utils';
import { parseDocument } from './parser';
import { getWordAtPosition, findSymbolInfo, findDefinition } from './symbols';
import { validateDocument } from './diagnostics';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

const documentIndex: Map<string, DocumentIndex> = new Map();

// Configuration settings
interface Settings {
    caseSensitive: boolean;
}

// Default settings
let globalSettings: Settings = { caseSensitive: false };
let hasConfigurationCapability = false;

// Tracks which parent documents reference each included file (for cleanup)
// Maps included file URI -> Set of parent document URIs that include it
const includeRefCount: Map<string, Set<string>> = new Map();

// Remove all include references from a root document and clean up orphaned includes
function clearIncludeRefs(rootUri: string): void {
    const orphanedUris: string[] = [];

    for (const [includeUri, refs] of includeRefCount) {
        refs.delete(rootUri);
        if (refs.size === 0) {
            orphanedUris.push(includeUri);
            includeRefCount.delete(includeUri);
        }
    }

    // Remove orphaned includes from documentIndex
    for (const uri of orphanedUris) {
        documentIndex.delete(uri);
    }
}

function indexDocument(document: TextDocument, indexedUris: Set<string> = new Set(), rootUri?: string): void {
    // Prevent circular includes
    if (indexedUris.has(document.uri)) {
        return;
    }
    indexedUris.add(document.uri);

    // The root URI is the top-level document that initiated the indexing
    const effectiveRootUri = rootUri ?? document.uri;

    const index = parseDocument(document, globalSettings.caseSensitive, (msg) => connection.console.warn(msg));
    documentIndex.set(document.uri, index);

    // Recursively index included files and track references
    for (const includeUri of index.includes) {
        // Track that this root document references this included file
        if (!includeRefCount.has(includeUri)) {
            includeRefCount.set(includeUri, new Set());
        }
        includeRefCount.get(includeUri)!.add(effectiveRootUri);

        if (!indexedUris.has(includeUri)) {
            try {
                const includePath = fileURLToPath(includeUri);
                const content = fs.readFileSync(includePath, 'utf-8');
                const includeDoc = TextDocument.create(includeUri, '64tass', 1, content);
                indexDocument(includeDoc, indexedUris, effectiveRootUri);
            } catch (e) {
                connection.console.warn(`Failed to read included file '${includeUri}': ${e}`);
            }
        }
    }
}

function computeFoldingRanges(document: TextDocument): FoldingRange[] {
    const ranges: FoldingRange[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    const stack: { directive: string; line: number }[] = [];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const { code } = parseLineStructure(lines[lineNum]);
        const line = code.toLowerCase();

        // Check for opening directives
        for (const open of Object.keys(FOLDING_PAIRS)) {
            // Safe: directive name from static constant (FOLDING_PAIRS)
            const openPattern = new RegExp(`(?:^|\\s)\\${open}\\b`);
            if (openPattern.test(line)) {
                stack.push({ directive: open, line: lineNum });
            }
        }

        // Check for closing directives
        for (const [close, openers] of Object.entries(CLOSING_DIRECTIVES)) {
            // Safe: directive name from static constant (CLOSING_DIRECTIVES)
            const closePattern = new RegExp(`(?:^|\\s)\\${close}\\b`);
            if (closePattern.test(line)) {
                // Find the most recent matching opener
                for (let i = stack.length - 1; i >= 0; i--) {
                    if (openers.includes(stack[i].directive)) {
                        const startLine = stack[i].line;
                        stack.splice(i, 1);
                        ranges.push(FoldingRange.create(
                            startLine,
                            lineNum,
                            undefined,
                            undefined,
                            FoldingRangeKind.Region
                        ));
                        break;
                    }
                }
            }
        }
    }

    return ranges;
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
    const capabilities = params.capabilities;
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: true,
            foldingRangeProvider: true,
            hoverProvider: true
        }
    };
});

connection.onInitialized(() => {
    connection.console.log('64tass language server initialized');

    if (hasConfigurationCapability) {
        // Request configuration
        connection.workspace.getConfiguration('64tass').then(
            (config: any) => {
                globalSettings = {
                    caseSensitive: config.caseSensitive ?? false
                };
            },
            (error) => {
                connection.console.warn(`Failed to get configuration: ${error}`);
            }
        );
    }

    documents.all().forEach(doc => indexDocument(doc));
});

// Handle configuration changes
connection.onDidChangeConfiguration(() => {
    if (hasConfigurationCapability) {
        connection.workspace.getConfiguration('64tass').then(
            (config: any) => {
                globalSettings = {
                    caseSensitive: config.caseSensitive ?? false
                };
                // Re-index all documents with new settings
                documents.all().forEach(doc => indexDocument(doc));
            },
            (error) => {
                connection.console.warn(`Failed to get configuration: ${error}`);
            }
        );
    }
});

connection.onDefinition((params: DefinitionParams): Location | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    // Check if cursor is on an .include file path
    const text = document.getText();
    const lines = text.split('\n');
    const line = lines[params.position.line];
    if (line) {
        const includeMatch = line.match(/^\s*\.include\s+(["'])([^"']+)\1/i);
        if (includeMatch) {
            const quote = includeMatch[1];
            const includePath = includeMatch[2];
            // Find the position of the path in the line
            const pathStart = line.indexOf(quote) + 1;
            const pathEnd = pathStart + includePath.length;

            // Check if cursor is within the path
            if (params.position.character >= pathStart && params.position.character <= pathEnd) {
                try {
                    const currentPath = fileURLToPath(document.uri);
                    const currentDir = path.dirname(currentPath);
                    const resolvedPath = path.resolve(currentDir, includePath);
                    if (fs.existsSync(resolvedPath)) {
                        return Location.create(
                            pathToFileURL(resolvedPath).toString(),
                            Range.create(Position.create(0, 0), Position.create(0, 0))
                        );
                    }
                } catch (e) {
                    connection.console.warn(`Failed to resolve include path for definition: ${e}`);
                }
            }
        }
    }

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    return findDefinition(word, params.textDocument.uri, params.position.line, documentIndex, globalSettings.caseSensitive);
});

connection.onFoldingRanges((params: FoldingRangeParams): FoldingRange[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    return computeFoldingRanges(document);
});

connection.onHover((params: HoverParams): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    const symbol = findSymbolInfo(word, params.textDocument.uri, params.position.line, documentIndex, globalSettings.caseSensitive);
    if (!symbol) return null;

    let content = `**${symbol.originalName}**`;
    if (symbol.scopePath) {
        content += ` *(in ${symbol.scopePath})*`;
    }
    if (symbol.comment) {
        content += `\n\n\`\`\`text\n${symbol.comment}\n\`\`\``;
    }
    if (symbol.value) {
        const numValue = parseNumericValue(symbol.value);
        if (numValue !== null) {
            content += `\n\n\`= ${formatNumericValue(numValue)}\``;
        } else {
            // Not a simple numeric value, show as-is
            content += `\n\n\`= ${symbol.value}\``;
        }
    }

    return {
        contents: {
            kind: MarkupKind.Markdown,
            value: content
        }
    };
});

connection.onReferences((params: ReferenceParams): Location[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const word = getWordAtPosition(document, params.position);
    if (!word) return [];

    // Find the symbol definition to understand its scope
    const symbol = findSymbolInfo(word, params.textDocument.uri, params.position.line, documentIndex, globalSettings.caseSensitive);
    if (!symbol) return [];

    const references: Location[] = [];

    // Include the definition itself if requested
    if (params.context.includeDeclaration) {
        references.push(Location.create(symbol.uri, symbol.range));
    }

    // Search all indexed documents for references
    for (const [uri, index] of documentIndex) {
        // Get document content
        let docContent: string;
        const openDoc = documents.get(uri);
        if (openDoc) {
            docContent = openDoc.getText();
        } else {
            try {
                const filePath = fileURLToPath(uri);
                docContent = fs.readFileSync(filePath, 'utf-8');
            } catch (e) {
                connection.console.warn(`Failed to read file for references '${uri}': ${e}`);
                continue;
            }
        }

        const lines = docContent.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            const { code } = parseLineStructure(line);

            // Skip empty lines
            if (code.trim() === '') continue;

            // Find all occurrences of the symbol name in this line
            const symbolName = symbol.name;
            const escapedName = escapeRegex(symbolName);

            // Pattern to match the symbol as a whole word
            // For local symbols (_name), match with underscore
            // For regular symbols, match word boundaries
            // Also match macro calls (.name)
            const patterns: RegExp[] = [];

            if (symbol.isLocal) {
                // Safe: symbol name from user file, sanitized via escapeRegex()
                patterns.push(new RegExp(`\\b${escapedName}\\b`, 'g'));
            } else {
                // Safe: symbol name from user file, sanitized via escapeRegex()
                patterns.push(new RegExp(`\\b${escapedName}\\b`, 'g'));
                patterns.push(new RegExp(`\\.${escapedName}\\b`, 'g'));
            }

            for (const pattern of patterns) {
                let match;
                while ((match = pattern.exec(code)) !== null) {
                    const startCol = match.index;
                    const matchText = match[0];

                    // Skip if this is the definition itself
                    if (uri === symbol.uri && lineNum === symbol.range.start.line &&
                        startCol === symbol.range.start.character) {
                        continue;
                    }

                    // Get scope context for this line
                    const lineScope = index.scopeAtLine.get(lineNum);
                    const lineScopePath = lineScope?.scopePath ?? null;
                    const lineLocalScope = lineScope?.localScope ?? null;

                    // For local symbols, must be in same scope and local scope
                    if (symbol.isLocal) {
                        if (lineScopePath !== symbol.scopePath ||
                            lineLocalScope !== symbol.localScope) {
                            continue;
                        }
                    } else {
                        // For regular symbols, check if this reference could resolve to our symbol
                        // The symbol should be visible from the current scope
                        const refSymbol = findSymbolInfo(
                            matchText.startsWith('.') ? matchText : symbolName,
                            uri,
                            lineNum,
                            documentIndex,
                            globalSettings.caseSensitive
                        );
                        if (!refSymbol || refSymbol.uri !== symbol.uri ||
                            refSymbol.range.start.line !== symbol.range.start.line) {
                            continue;
                        }
                    }

                    // Adjust start column for macro call prefix
                    const actualStartCol = matchText.startsWith('.') ? startCol + 1 : startCol;

                    references.push(Location.create(
                        uri,
                        Range.create(
                            Position.create(lineNum, actualStartCol),
                            Position.create(lineNum, actualStartCol + symbolName.length)
                        )
                    ));
                }
            }
        }
    }

    return references;
});

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    // Find the symbol definition
    const symbol = findSymbolInfo(word, params.textDocument.uri, params.position.line, documentIndex, globalSettings.caseSensitive);
    if (!symbol) return null;

    const newName = params.newName;

    // Track edits by URI, separating code and comment edits
    const codeEdits: Map<string, TextEdit[]> = new Map();
    const commentEdits: Map<string, AnnotatedTextEdit[]> = new Map();

    // Track added edits to avoid duplicates
    const addedEdits = new Set<string>();

    // Helper to add a code edit
    function addCodeEdit(uri: string, range: Range) {
        const key = `${uri}:${range.start.line}:${range.start.character}`;
        if (addedEdits.has(key)) return;
        addedEdits.add(key);

        if (!codeEdits.has(uri)) {
            codeEdits.set(uri, []);
        }
        codeEdits.get(uri)!.push(TextEdit.replace(range, newName));
    }

    // Helper to add a comment edit (with annotation)
    function addCommentEdit(uri: string, range: Range) {
        const key = `${uri}:${range.start.line}:${range.start.character}`;
        if (addedEdits.has(key)) return;
        addedEdits.add(key);

        if (!commentEdits.has(uri)) {
            commentEdits.set(uri, []);
        }
        commentEdits.get(uri)!.push(
            AnnotatedTextEdit.replace(range, newName, 'commentRename')
        );
    }

    // Add the definition
    addCodeEdit(symbol.uri, symbol.range);

    // Search all indexed documents for references
    for (const [uri, index] of documentIndex) {
        let docContent: string;
        const openDoc = documents.get(uri);
        if (openDoc) {
            docContent = openDoc.getText();
        } else {
            try {
                const filePath = fileURLToPath(uri);
                docContent = fs.readFileSync(filePath, 'utf-8');
            } catch (e) {
                connection.console.warn(`Failed to read file for rename '${uri}': ${e}`);
                continue;
            }
        }

        const lines = docContent.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            const { code, commentStart } = parseLineStructure(line);

            const symbolName = symbol.name;
            const escapedName = escapeRegex(symbolName);

            const patterns: RegExp[] = [];
            if (symbol.isLocal) {
                // Safe: symbol name from user file, sanitized via escapeRegex()
                patterns.push(new RegExp(`\\b${escapedName}\\b`, 'g'));
            } else {
                // Safe: symbol name from user file, sanitized via escapeRegex()
                patterns.push(new RegExp(`\\b${escapedName}\\b`, 'g'));
                patterns.push(new RegExp(`\\.${escapedName}\\b`, 'g'));
            }

            // Search in code portion
            if (code.trim() !== '') {
                for (const pattern of patterns) {
                    let match;
                    while ((match = pattern.exec(code)) !== null) {
                        const startCol = match.index;
                        const matchText = match[0];

                        // Skip if this is the definition itself (already added)
                        if (uri === symbol.uri && lineNum === symbol.range.start.line &&
                            startCol === symbol.range.start.character) {
                            continue;
                        }

                        const lineScope = index.scopeAtLine.get(lineNum);
                        const lineScopePath = lineScope?.scopePath ?? null;
                        const lineLocalScope = lineScope?.localScope ?? null;

                        if (symbol.isLocal) {
                            if (lineScopePath !== symbol.scopePath ||
                                lineLocalScope !== symbol.localScope) {
                                continue;
                            }
                        } else {
                            const refSymbol = findSymbolInfo(
                                matchText.startsWith('.') ? matchText : symbolName,
                                uri,
                                lineNum,
                                documentIndex,
                                globalSettings.caseSensitive
                            );
                            if (!refSymbol || refSymbol.uri !== symbol.uri ||
                                refSymbol.range.start.line !== symbol.range.start.line) {
                                continue;
                            }
                        }

                        const actualStartCol = matchText.startsWith('.') ? startCol + 1 : startCol;

                        addCodeEdit(uri, Range.create(
                            Position.create(lineNum, actualStartCol),
                            Position.create(lineNum, actualStartCol + symbolName.length)
                        ));
                    }
                }
            }

            // Search in comment portion (for all symbols, not just scoped ones)
            if (commentStart >= 0) {
                const comment = line.substring(commentStart);
                // Safe: symbol name from user file, sanitized via escapeRegex()
                const commentPattern = new RegExp(`\\b${escapedName}\\b`, 'g');
                let match;
                while ((match = commentPattern.exec(comment)) !== null) {
                    const startCol = commentStart + match.index;

                    addCommentEdit(uri, Range.create(
                        Position.create(lineNum, startCol),
                        Position.create(lineNum, startCol + symbolName.length)
                    ));
                }
            }
        }
    }

    // Build the workspace edit
    const hasCommentEdits = commentEdits.size > 0;

    if (hasCommentEdits) {
        // Use documentChanges with annotations to force preview
        const documentChanges: TextDocumentEdit[] = [];
        const changeAnnotations: { [id: string]: ChangeAnnotation } = {
            'commentRename': {
                label: 'Rename in comments',
                needsConfirmation: true,
                description: 'Also rename occurrences in comments'
            }
        };

        // Collect all URIs
        const allUris = new Set([...codeEdits.keys(), ...commentEdits.keys()]);

        for (const uri of allUris) {
            const edits: (TextEdit | AnnotatedTextEdit)[] = [];

            // Add code edits
            const uriCodeEdits = codeEdits.get(uri);
            if (uriCodeEdits) {
                edits.push(...uriCodeEdits);
            }

            // Add comment edits (annotated)
            const uriCommentEdits = commentEdits.get(uri);
            if (uriCommentEdits) {
                edits.push(...uriCommentEdits);
            }

            if (edits.length > 0) {
                documentChanges.push({
                    textDocument: OptionalVersionedTextDocumentIdentifier.create(uri, null),
                    edits
                });
            }
        }

        return { documentChanges, changeAnnotations };
    } else {
        // No comment edits, use simple changes format
        const changes: { [uri: string]: TextEdit[] } = {};
        for (const [uri, edits] of codeEdits) {
            changes[uri] = edits;
        }
        return { changes };
    }
});

documents.onDidChangeContent(change => {
    // Clear old include references before re-indexing (includes may have changed)
    clearIncludeRefs(change.document.uri);
    indexDocument(change.document);

    const diagnostics = validateDocument(change.document, documentIndex, globalSettings.caseSensitive);
    connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

documents.onDidClose(event => {
    // Clean up this document and any orphaned includes
    clearIncludeRefs(event.document.uri);
    documentIndex.delete(event.document.uri);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
