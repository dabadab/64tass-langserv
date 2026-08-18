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
    CompletionParams,
    CompletionItem,
    PrepareRenameParams,
    ResponseError,
    ErrorCodes,
    DidChangeConfigurationNotification
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { DocumentIndex } from './types';
import { FOLDING_PAIRS, CLOSING_DIRECTIVES } from './constants';
import { parseLineStructure, stripStrings, parseNumericValue, formatNumericValue, escapeRegex, detectCaseSensitivityPragma } from './utils';
import { parseDocument } from './parser';
import { getWordAtPosition, findSymbolInfo, findDefinition, computeRenameEdits, isRenameable } from './symbols';
import { validateDocument } from './diagnostics';
import { getCompletions } from './completions';

// Get the current text of a document by URI: prefer the open in-memory buffer,
// fall back to reading the file from disk (for indexed-but-unopened .include files).
function getDocumentText(uri: string): string | null {
    const openDoc = documents.get(uri);
    if (openDoc) return openDoc.getText();
    try {
        return fs.readFileSync(fileURLToPath(uri), 'utf-8');
    } catch (e) {
        connection.console.warn(`Failed to read file for rename '${uri}': ${e}`);
        return null;
    }
}

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

const documentIndex: Map<string, DocumentIndex> = new Map();

// The case-sensitivity actually used to index a given document - which may
// differ from the workspace default via a per-file pragma (see
// detectCaseSensitivityPragma / indexDocument) - or the workspace default
// itself if the document hasn't been indexed yet.
function effectiveCaseSensitive(uri: string): boolean {
    return documentIndex.get(uri)?.caseSensitive ?? globalSettings.caseSensitive;
}

// Configuration settings
interface Settings {
    caseSensitive: boolean;
}

// Default settings
let globalSettings: Settings = { caseSensitive: false };
let hasConfigurationCapability = false;
// Whether the client accepts a dynamic registration for didChangeConfiguration.
// Distinct from hasConfigurationCapability (workspace/configuration *requests*):
// without registering for the notification the server is never told about changes.
let hasDidChangeConfigurationCapability = false;

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

function indexDocument(
    document: TextDocument,
    indexedUris: Set<string> = new Set(),
    rootUri?: string,
    inheritedCaseSensitive: boolean = globalSettings.caseSensitive
): void {
    // Prevent circular includes
    if (indexedUris.has(document.uri)) {
        return;
    }
    indexedUris.add(document.uri);

    // The root URI is the top-level document that initiated the indexing
    const effectiveRootUri = rootUri ?? document.uri;

    // A "; 64tass-langserv: case-sensitive"/"case-insensitive" pragma in this
    // file overrides the inherited setting for itself and everything it
    // .include's; otherwise it inherits from its parent (or the workspace
    // 64tass.caseSensitive setting, at the top of the include tree).
    const pragma = detectCaseSensitivityPragma(document.getText());
    const effectiveCaseSensitive = pragma ?? inheritedCaseSensitive;

    const index = parseDocument(document, effectiveCaseSensitive, (msg) => connection.console.warn(msg));
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
                indexDocument(includeDoc, indexedUris, effectiveRootUri, effectiveCaseSensitive);
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
        // Blank out string contents first, so a directive name inside a literal
        // (.text "a .proc b") doesn't push a phantom entry onto the fold stack
        const line = stripStrings(code).toLowerCase();

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
    hasDidChangeConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.didChangeConfiguration?.dynamicRegistration
    );

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            definitionProvider: true,
            referencesProvider: true,
            // prepareProvider lets the client ask whether a rename is valid before
            // prompting for the new name (used to refuse anonymous labels)
            renameProvider: { prepareProvider: true },
            foldingRangeProvider: true,
            hoverProvider: true,
            completionProvider: {
                triggerCharacters: ['.', '"', '/']
            }
        }
    };
});

// Resolves once the initial workspace configuration fetch has completed (or
// immediately if the client doesn't support it). Every place that reads
// globalSettings.caseSensitive to index/validate a document as a *reaction to
// a client notification* (didOpen/didChange, which can arrive before the
// server's own async workspace/configuration request round-trips) awaits this
// first - otherwise that first pass silently uses the default caseSensitive:false
// no matter what the workspace actually has set.
let configReady: Promise<void> = Promise.resolve();

connection.onInitialized(() => {
    connection.console.log('64tass language server initialized');

    // Without this the client never sends workspace/didChangeConfiguration:
    // vscode-languageclient only wires that up if the client sets
    // synchronize.configurationSection (we don't) or the server registers for it
    // here. Missing it meant 64tass.caseSensitive changes did nothing until reload.
    if (hasDidChangeConfigurationCapability) {
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }

    if (hasConfigurationCapability) {
        configReady = connection.workspace.getConfiguration('64tass').then(
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

    configReady.then(() => {
        documents.all().forEach(doc => indexDocument(doc));
    });
});

// Handle configuration changes
connection.onDidChangeConfiguration(() => {
    if (!hasConfigurationCapability) return;

    configReady = connection.workspace.getConfiguration('64tass').then(
        (config: any) => {
            globalSettings = {
                caseSensitive: config.caseSensitive ?? false
            };
        },
        (error) => {
            connection.console.warn(`Failed to get configuration: ${error}`);
        }
    );

    configReady.then(() => {
        // Re-index every open document under the new settings, then re-publish -
        // re-indexing alone would leave the previous diagnostics on screen.
        for (const doc of documents.all()) {
            clearIncludeRefs(doc.uri);
            indexDocument(doc);
        }
        for (const doc of documents.all()) {
            connection.sendDiagnostics({
                uri: doc.uri,
                diagnostics: validateDocument(doc, documentIndex, effectiveCaseSensitive(doc.uri))
            });
        }
    });
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

    return findDefinition(word, params.textDocument.uri, params.position.line, documentIndex, effectiveCaseSensitive(params.textDocument.uri));
});

connection.onFoldingRanges((params: FoldingRangeParams): FoldingRange[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    return computeFoldingRanges(document);
});

connection.onCompletion((params: CompletionParams): CompletionItem[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    return getCompletions(document, params.position, documentIndex);
});

connection.onHover((params: HoverParams): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    const symbol = findSymbolInfo(word, params.textDocument.uri, params.position.line, documentIndex, effectiveCaseSensitive(params.textDocument.uri));
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
    const symbol = findSymbolInfo(word, params.textDocument.uri, params.position.line, documentIndex, effectiveCaseSensitive(params.textDocument.uri));
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
                            effectiveCaseSensitive(uri)
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

// Resolve the symbol under the cursor for a rename request, or null if there
// isn't one. Shared by prepareRename and the rename itself so both agree on
// what is renameable.
function resolveRenameTarget(uri: string, position: Position) {
    const document = documents.get(uri);
    if (!document) return null;

    const word = getWordAtPosition(document, position);
    if (!word) return null;

    const symbol = findSymbolInfo(word, uri, position.line, documentIndex, effectiveCaseSensitive(uri));
    if (!symbol) return null;

    return { document, word, symbol };
}

// Let the editor reject an invalid rename target up front, with a reason,
// instead of failing generically after the user has typed a new name.
connection.onPrepareRename((params: PrepareRenameParams): Range | ResponseError<void> => {
    const target = resolveRenameTarget(params.textDocument.uri, params.position);
    if (!target) {
        return new ResponseError(ErrorCodes.InvalidRequest, 'You cannot rename this element.');
    }
    if (!isRenameable(target.symbol)) {
        return new ResponseError(
            ErrorCodes.InvalidRequest,
            'Anonymous labels (+ / -) cannot be renamed - they are referenced by direction and distance, not by name.'
        );
    }

    // Range of the identifier under the cursor, so the editor pre-fills it
    const line = params.position.line;
    const text = target.document.getText().split('\n')[line] ?? '';
    const start = text.indexOf(target.word, Math.max(0, params.position.character - target.word.length));
    const from = start >= 0 ? start : params.position.character;
    return Range.create(Position.create(line, from), Position.create(line, from + target.word.length));
});

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
    const target = resolveRenameTarget(params.textDocument.uri, params.position);
    if (!target) return null;

    return computeRenameEdits(
        target.symbol,
        params.newName,
        documentIndex,
        getDocumentText,
        effectiveCaseSensitive(target.symbol.uri)
    );
});



documents.onDidChangeContent(change => {
    // didOpen/didChange can arrive before the initial workspace/configuration
    // round-trip finishes (see configReady above) - wait for it so the very
    // first index/validation of a document uses the real caseSensitive setting.
    configReady.then(() => {
        // Clear old include references before re-indexing (includes may have changed)
        clearIncludeRefs(change.document.uri);
        indexDocument(change.document);

        // indexDocument (above) just resolved this document's effective case
        // sensitivity (workspace default, or overridden by a pragma) - use that.
        const diagnostics = validateDocument(change.document, documentIndex, effectiveCaseSensitive(change.document.uri));
        connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
    });
});

documents.onDidClose(event => {
    // Clean up this document and any orphaned includes
    clearIncludeRefs(event.document.uri);
    documentIndex.delete(event.document.uri);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
