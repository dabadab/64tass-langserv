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
    HoverParams,
    DocumentLink,
    DocumentLinkParams,
    SelectionRange,
    SelectionRangeParams,
    Hover,
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
    DocumentHighlight,
    SemanticTokensParams,
    SemanticTokens,
    SemanticTokensBuilder
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

import { DocumentIndex } from './types';
import { absoluteSearchPaths } from './paths';
import { buildHover } from './hover';
import { buildDocumentLinks } from './documentLinks';
import { computeSelectionRanges } from './selectionRanges';
import { detectCaseSensitivityPragma, detectCpu } from './utils';
import { parseDocument } from './parser';
import {
    getWordAtPosition, findSymbolInfo, findDefinition, computeRenameEdits,
    isRenameable, isValidSymbolName, findReferences, findDocumentHighlights
} from './symbols';
import { validateDocument } from './diagnostics';
import { getCompletions } from './completions';
import { IncludeGraph } from './includes';
import { collectSourceFiles, findFilePathAt } from './workspace';
import { DEFAULT_CPU, isCpuName } from './constants';
import { computeFoldingRanges } from './folding';
import { indexDocument as indexDocumentWith, clearIncludeRefs as clearIncludeRefsWith, IndexContext } from './indexing';

import { buildDocumentSymbols } from './documentSymbols';
import { findWorkspaceSymbols } from './workspaceSymbols';
import { getSignatureHelp } from './signatureHelp';
import { buildSemanticTokens, encodeModifiers, TOKEN_TYPES, TOKEN_MODIFIERS } from './semanticTokens';
import { Debouncer } from './debounce';

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
    cpu: string;
    /** As configured: relative entries are taken against the first workspace root. */
    includePaths: string[];
}

// Default settings
let globalSettings: Settings = { caseSensitive: false, cpu: DEFAULT_CPU, includePaths: [] };

/** Read the `64tass` configuration section, falling back to defaults per field. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readSettings(config: any): Settings {
    return {
        caseSensitive: config?.caseSensitive ?? false,
        cpu: isCpuName(String(config?.cpu ?? '')) ? String(config.cpu).toLowerCase() : DEFAULT_CPU,
        includePaths: Array.isArray(config?.includePaths) ? config.includePaths.map(String) : [],
    };
}

/** Configured include search paths, made absolute against the workspace root. */
function searchPaths(): string[] {
    return absoluteSearchPaths(globalSettings.includePaths, workspaceRoots[0] ?? null);
}
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

// Validation is ~3/4 of the per-keystroke cost, so it is debounced; indexing is
// NOT, so on-demand requests (definition, completion, hover) always see fresh data.
const DIAGNOSTIC_DEBOUNCE_MS = 250;
const diagnosticDebouncer = new Debouncer(DIAGNOSTIC_DEBOUNCE_MS);

// Dependencies the indexing logic needs, bound to this server's state
const indexContext: IndexContext = {
    documentIndex,
    includeGraph,
    getDocumentText: (uri) => getDocumentText(uri),
    getOpenDocument: (uri) => documents.get(uri),
    get defaultCaseSensitive() { return globalSettings.caseSensitive; },
    get defaultCpu() { return globalSettings.cpu; },
    get includePaths() { return searchPaths(); },
    log: (message) => connection.console.warn(message)
};

/** Index a document and its include tree. */
function indexDocument(document: TextDocument): void {
    indexDocumentWith(document, indexContext);
}

/** Drop a root's include references, cleaning up any orphaned index entries. */
function clearIncludeRefs(rootUri: string): void {
    clearIncludeRefsWith(rootUri, indexContext);
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
            documentLinkProvider: { resolveProvider: false },
            selectionRangeProvider: true,
            hoverProvider: true,
            documentSymbolProvider: true,
            documentHighlightProvider: true,
            semanticTokensProvider: {
                legend: { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [...TOKEN_MODIFIERS] },
                full: true
            },
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
        const cpu = detectCpu(content) ?? globalSettings.cpu;
        documentIndex.set(
            uri,
            parseDocument(TextDocument.create(uri, '64tass', 1, content), {
                caseSensitive, cpu,
                log: msg => connection.console.warn(msg),
                includePaths: searchPaths(),
            })
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
                globalSettings = readSettings(config);
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
            globalSettings = readSettings(config);
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
            const reference = findFilePathAt(line, params.position.character, fileURLToPath(document.uri), searchPaths());
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

    return computeFoldingRanges(document.getText());
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

connection.languages.semanticTokens.on((params: SemanticTokensParams): SemanticTokens => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return { data: [] };

    const tokens = buildSemanticTokens(
        document.getText(), params.textDocument.uri, documentIndex,
        effectiveCaseSensitive(params.textDocument.uri)
    );

    // SemanticTokensBuilder handles the delta encoding the protocol requires
    const builder = new SemanticTokensBuilder();
    for (const token of tokens) {
        builder.push(
            token.line, token.startCharacter, token.length,
            TOKEN_TYPES.indexOf(token.tokenType), encodeModifiers(token.tokenModifiers)
        );
    }
    return builder.build();
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

    const uri = params.textDocument.uri;
    return buildHover(word, uri, params.position.line, documentIndex,
        effectiveCaseSensitive(uri), documentIndex.get(uri)?.cpu ?? globalSettings.cpu);
});

connection.onDocumentLinks((params: DocumentLinkParams): DocumentLink[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return buildDocumentLinks(document, searchPaths());
});

connection.onSelectionRanges((params: SelectionRangeParams): SelectionRange[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return computeSelectionRanges(document.getText(), params.positions);
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
        // Index immediately so requests answered between keystrokes are accurate
        clearIncludeRefs(change.document.uri);
        indexDocument(change.document);

        // ...but collapse bursts of typing into a single validation pass
        diagnosticDebouncer.run(change.document.uri, () => publishDiagnosticsFor(change.document.uri));
    });
});

documents.onDidClose(event => {
    const uri = event.document.uri;

    // Nothing to publish for a document that is gone
    diagnosticDebouncer.cancel(uri);

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
