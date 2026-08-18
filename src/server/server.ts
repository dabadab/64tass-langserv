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
    DidChangeConfigurationNotification,
    DidChangeWatchedFilesNotification,
    FileChangeType,
    DidChangeWatchedFilesParams,
    DocumentSymbolParams,
    DocumentSymbol,
    WorkspaceSymbolParams,
    SymbolInformation,
    SignatureHelpParams,
    SignatureHelp,
    DocumentHighlightParams,
    DocumentHighlight
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

import { DocumentIndex } from './types';
import { FOLDING_PAIRS, CLOSING_DIRECTIVES } from './constants';
import { parseLineStructure, stripStrings, parseNumericValue, formatNumericValue, detectCaseSensitivityPragma } from './utils';
import { parseDocument } from './parser';
import {
    getWordAtPosition, findSymbolInfo, findDefinition, computeRenameEdits,
    isRenameable, isValidSymbolName, findReferences, findDocumentHighlights
} from './symbols';
import { validateDocument } from './diagnostics';
import { getCompletions } from './completions';
import { IncludeGraph } from './includes';
import { collectSourceFiles, findFilePathAt } from './workspace';
import { buildDocumentSymbols } from './documentSymbols';
import { findWorkspaceSymbols } from './workspaceSymbols';
import { getSignatureHelp } from './signatureHelp';

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
// Whether the client can watch files for us (edits made outside the editor:
// a generated table, a git checkout) and notify the server about them.
let hasFileWatchCapability = false;
// Workspace roots reported at initialize, scanned in the background so that
// go-to-definition and find-references work for files the user has not opened.
let workspaceRoots: string[] = [];
// Upper bound on a background scan, so an enormous tree cannot stall it
const WORKSPACE_SCAN_LIMIT = 5000;

// Tracks which root documents reference each included file (for cleanup)
const includeGraph = new IncludeGraph();

// Remove all include references from a root document and clean up orphaned includes
function clearIncludeRefs(rootUri: string): void {
    for (const uri of includeGraph.clearRoot(rootUri)) {
        // Only drop documents that are not open in their own right
        if (!documents.get(uri)) documentIndex.delete(uri);
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
        includeGraph.addRef(includeUri, effectiveRootUri);

        if (!indexedUris.has(includeUri)) {
            // Prefer the open buffer over the file on disk: an include that is open
            // with unsaved edits would otherwise be re-indexed back to its saved
            // state every time the parent is edited.
            const openDoc = documents.get(includeUri);
            if (openDoc) {
                indexDocument(openDoc, indexedUris, effectiveRootUri, effectiveCaseSensitive);
            } else {
                const content = getDocumentText(includeUri);
                if (content === null) continue;
                const includeDoc = TextDocument.create(includeUri, '64tass', 1, content);
                indexDocument(includeDoc, indexedUris, effectiveRootUri, effectiveCaseSensitive);
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

/**
 * Re-publish diagnostics for `uri` and for every open root whose include tree it
 * participates in. Editing an include changes what its parents can resolve, so
 * publishing only for the edited document leaves the parents showing stale results.
 */
function publishDiagnosticsFor(uri: string): void {
    for (const affected of includeGraph.affectedRoots(uri)) {
        const doc = documents.get(affected);
        if (!doc) continue; // only open documents have diagnostics on screen
        connection.sendDiagnostics({
            uri: affected,
            diagnostics: validateDocument(doc, documentIndex, effectiveCaseSensitive(affected))
        });
    }
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
    const capabilities = params.capabilities;

    workspaceRoots = (params.workspaceFolders ?? [])
        .map(folder => { try { return fileURLToPath(folder.uri); } catch { return null; } })
        .filter((p): p is string => p !== null);
    if (workspaceRoots.length === 0 && params.rootUri) {
        try { workspaceRoots = [fileURLToPath(params.rootUri)]; } catch { /* ignore */ }
    }
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasDidChangeConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.didChangeConfiguration?.dynamicRegistration
    );
    hasFileWatchCapability = !!(
        capabilities.workspace && !!capabilities.workspace.didChangeWatchedFiles?.dynamicRegistration
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
            documentSymbolProvider: true,
            documentHighlightProvider: true,
            workspaceSymbolProvider: true,
            signatureHelpProvider: { triggerCharacters: ['(', ','], retriggerCharacters: [','] },
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

/**
 * Index every source file in the workspace that is not already indexed.
 *
 * Runs in the background after startup: without it, go-to-definition and
 * find-references silently return nothing for symbols in unopened files. Yields
 * to the event loop periodically so an in-progress scan does not delay requests.
 *
 * Files are indexed standalone here (their own pragma, else the workspace
 * setting). Opening a root later re-indexes its include tree properly, which
 * also re-applies the case-sensitivity cascade to the files it pulls in.
 */
async function scanWorkspace(): Promise<void> {
    if (workspaceRoots.length === 0) return;

    const files: string[] = [];
    for (const root of workspaceRoots) {
        files.push(...collectSourceFiles(root, {
            limit: WORKSPACE_SCAN_LIMIT - files.length,
            onLimit: limit => connection.console.warn(
                `Workspace scan stopped at ${limit} files; symbols in the rest will only ` +
                `resolve once their file is opened.`
            )
        }));
        if (files.length >= WORKSPACE_SCAN_LIMIT) break;
    }

    const started = Date.now();
    let indexed = 0;

    for (const file of files) {
        const uri = pathToFileURL(file).toString();
        if (documentIndex.has(uri)) continue; // already indexed as open doc or include

        const content = getDocumentText(uri);
        if (content === null) continue;

        const caseSensitive = detectCaseSensitivityPragma(content) ?? globalSettings.caseSensitive;
        documentIndex.set(
            uri,
            parseDocument(TextDocument.create(uri, '64tass', 1, content), caseSensitive,
                msg => connection.console.warn(msg))
        );
        indexed++;

        // Hand the event loop back regularly so requests are not blocked
        if (indexed % 20 === 0) await new Promise(resolve => setImmediate(resolve));
    }

    if (indexed > 0) {
        connection.console.log(`Indexed ${indexed} workspace file(s) in ${Date.now() - started}ms`);
        // Files that were already open may now resolve symbols they could not before
        for (const doc of documents.all()) publishDiagnosticsFor(doc.uri);
    }
}

connection.onInitialized(() => {
    connection.console.log('64tass language server initialized');

    // Without this the client never sends workspace/didChangeConfiguration:
    // vscode-languageclient only wires that up if the client sets
    // synchronize.configurationSection (we don't) or the server registers for it
    // here. Missing it meant 64tass.caseSensitive changes did nothing until reload.
    if (hasDidChangeConfigurationCapability) {
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }

    // Watch the handled extensions so edits made outside the editor still refresh
    // the index - without this a regenerated include is invisible until reopened.
    if (hasFileWatchCapability) {
        connection.client.register(DidChangeWatchedFilesNotification.type, {
            watchers: [{ globPattern: '**/*.{asm,s,inc,src}' }]
        });
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
        // Background: not awaited, so startup is not delayed by a large workspace
        scanWorkspace().catch(e => connection.console.warn(`Workspace scan failed: ${e}`));
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
            publishDiagnosticsFor(doc.uri);
        }
    });
});

connection.onDefinition((params: DefinitionParams): Location | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    // Cursor on a quoted file path (.include / .binclude / .binary) opens that file
    const line = document.getText().split('\n')[params.position.line];
    if (line) {
        try {
            const reference = findFilePathAt(line, params.position.character, fileURLToPath(document.uri));
            if (reference?.resolved) {
                return Location.create(
                    pathToFileURL(reference.resolved).toString(),
                    Range.create(Position.create(0, 0), Position.create(0, 0))
                );
            }
            if (reference) return null; // on a path, but it does not resolve
        } catch (e) {
            connection.console.warn(`Failed to resolve file path for definition: ${e}`);
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

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
    const index = documentIndex.get(params.textDocument.uri);
    if (!index) return [];
    return buildDocumentSymbols(index);
});

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
    return findWorkspaceSymbols(params.query, documentIndex);
});

connection.onSignatureHelp((params: SignatureHelpParams): SignatureHelp | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const linePrefix = document.getText(Range.create(
        Position.create(params.position.line, 0),
        params.position
    ));
    return getSignatureHelp(linePrefix, documentIndex, effectiveCaseSensitive(params.textDocument.uri));
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

    const uri = params.textDocument.uri;
    const symbol = findSymbolInfo(word, uri, params.position.line, documentIndex, effectiveCaseSensitive(uri));
    if (!symbol) return [];

    return findReferences(
        symbol, documentIndex, getDocumentText,
        params.context.includeDeclaration, effectiveCaseSensitive(symbol.uri)
    );
});

connection.onDocumentHighlight((params: DocumentHighlightParams): DocumentHighlight[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const word = getWordAtPosition(document, params.position);
    if (!word) return [];

    const uri = params.textDocument.uri;
    const symbol = findSymbolInfo(word, uri, params.position.line, documentIndex, effectiveCaseSensitive(uri));
    if (!symbol) return [];

    return findDocumentHighlights(symbol, uri, documentIndex, getDocumentText, effectiveCaseSensitive(symbol.uri));
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

    if (!isValidSymbolName(params.newName)) {
        throw new ResponseError(
            ErrorCodes.InvalidRequest,
            `'${params.newName}' is not a valid symbol name: use a letter or underscore ` +
            `followed by letters, digits or underscores.`
        );
    }

    return computeRenameEdits(
        target.symbol,
        params.newName,
        documentIndex,
        getDocumentText,
        effectiveCaseSensitive(target.symbol.uri)
    );
});



connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
    configReady.then(() => {
        const touched: string[] = [];

        for (const change of params.changes) {
            const uri = change.uri;
            // An open document is the editor's to report; its buffer is authoritative
            // and onDidChangeContent already handles it.
            if (documents.get(uri)) continue;
            if (!documentIndex.has(uri)) continue;

            if (change.type === FileChangeType.Deleted) {
                clearIncludeRefs(uri);
                if (!includeGraph.isReferenced(uri)) documentIndex.delete(uri);
                touched.push(uri);
                continue;
            }

            const content = getDocumentText(uri);
            if (content === null) continue;
            clearIncludeRefs(uri);
            indexDocument(TextDocument.create(uri, '64tass', 1, content));
            touched.push(uri);
        }

        // Refresh whatever open documents those files feed into
        for (const uri of new Set(touched)) publishDiagnosticsFor(uri);
    });
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
        publishDiagnosticsFor(change.document.uri);
    });
});

documents.onDidClose(event => {
    const uri = event.document.uri;

    // Clean up the include tree this document was the root of
    clearIncludeRefs(uri);

    // Keep the index entry if another still-open document .includes this file -
    // dropping it would strip every symbol it provides from that parent.
    if (!includeGraph.isReferenced(uri)) {
        documentIndex.delete(uri);
    }

    connection.sendDiagnostics({ uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
