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
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

interface LabelDefinition {
    name: string;
    uri: string;
    range: Range;
    scope: string | null;  // null for global labels, parent scope name for local labels
    value?: string;        // value for constant assignments (e.g., "$D414")
}

interface DocumentIndex {
    labels: LabelDefinition[];
    // Maps line number to the scope (code label) that contains it
    scopeAtLine: Map<number, string | null>;
}

// Cache of label definitions per document
const documentIndex: Map<string, DocumentIndex> = new Map();

// 6502 opcodes for detecting code labels
const OPCODES = new Set([
    'adc', 'and', 'asl', 'bcc', 'bcs', 'beq', 'bit', 'bmi', 'bne', 'bpl',
    'brk', 'bvc', 'bvs', 'clc', 'cld', 'cli', 'clv', 'cmp', 'cpx', 'cpy',
    'dec', 'dex', 'dey', 'eor', 'inc', 'inx', 'iny', 'jmp', 'jsr', 'lda',
    'ldx', 'ldy', 'lsr', 'nop', 'ora', 'pha', 'php', 'pla', 'plp', 'rol',
    'ror', 'rti', 'rts', 'sbc', 'sec', 'sed', 'sei', 'sta', 'stx', 'sty',
    'tax', 'tay', 'tsx', 'txa', 'txs', 'tya'
]);

function parseDocument(document: TextDocument): DocumentIndex {
    const labels: LabelDefinition[] = [];
    const scopeAtLine: Map<number, string | null> = new Map();
    const text = document.getText();
    const lines = text.split('\n');

    let currentScope: string | null = null;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];

        // Track which scope this line belongs to
        scopeAtLine.set(lineNum, currentScope);

        // Skip empty lines and comment-only lines
        if (/^\s*;/.test(line) || /^\s*$/.test(line)) {
            continue;
        }

        // Check for code label (scope boundary):
        // - Regular name at line start (not starting with _)
        // - Followed by nothing, comment, colon, or opcode
        // - NOT followed by directive like .macro, .function, etc.
        const codeLabelMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*(:)?\s*(;.*)?$/);
        if (codeLabelMatch) {
            // Label alone or with colon - this is a scope boundary
            const labelName = codeLabelMatch[1];
            currentScope = labelName;
            scopeAtLine.set(lineNum, currentScope);

            labels.push({
                name: labelName,
                uri: document.uri,
                range: Range.create(
                    Position.create(lineNum, 0),
                    Position.create(lineNum, labelName.length)
                ),
                scope: null  // global
            });
            continue;
        }

        // Code label followed by opcode
        const codeLabelOpcodeMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s+([a-zA-Z]{3})\b/);
        if (codeLabelOpcodeMatch && OPCODES.has(codeLabelOpcodeMatch[2].toLowerCase())) {
            const labelName = codeLabelOpcodeMatch[1];
            currentScope = labelName;
            scopeAtLine.set(lineNum, currentScope);

            labels.push({
                name: labelName,
                uri: document.uri,
                range: Range.create(
                    Position.create(lineNum, 0),
                    Position.create(lineNum, labelName.length)
                ),
                scope: null  // global
            });
            continue;
        }

        // Local symbol: starts with underscore, at any indentation
        const localMatch = line.match(/^(\s*)(_[a-zA-Z0-9_]*)\s*(?::|=|:=|\s|;|$)/);
        if (localMatch) {
            const labelName = localMatch[2];
            const startChar = localMatch[1].length;

            labels.push({
                name: labelName,
                uri: document.uri,
                range: Range.create(
                    Position.create(lineNum, startChar),
                    Position.create(lineNum, startChar + labelName.length)
                ),
                scope: currentScope  // belongs to current code label scope
            });
            continue;
        }

        // Other global labels: with directives like .macro, .function, .proc, etc.
        const directiveLabelMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s+\.(macro|function|proc|block|struct|union|segment)\b/i);
        if (directiveLabelMatch) {
            const labelName = directiveLabelMatch[1];
            // These don't create scope boundaries for local symbols
            labels.push({
                name: labelName,
                uri: document.uri,
                range: Range.create(
                    Position.create(lineNum, 0),
                    Position.create(lineNum, labelName.length)
                ),
                scope: null
            });
            continue;
        }

        // Labels with data directives
        const dataLabelMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s+\.(byte|word|addr|fill|text|ptext|null|lohi_tbl|hilo_tbl|lo_tbl)\b/i);
        if (dataLabelMatch) {
            const labelName = dataLabelMatch[1];
            labels.push({
                name: labelName,
                uri: document.uri,
                range: Range.create(
                    Position.create(lineNum, 0),
                    Position.create(lineNum, labelName.length)
                ),
                scope: null
            });
            continue;
        }

        // Constant assignment (can be indented, can start with _)
        // Capture the value after = (up to comment or end of line)
        const constMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:?=\s*([^;]+)/);
        if (constMatch) {
            const labelName = constMatch[2];
            const startChar = constMatch[1].length;
            const isLocal = labelName.startsWith('_');
            const value = constMatch[3]?.trim();

            labels.push({
                name: labelName,
                uri: document.uri,
                range: Range.create(
                    Position.create(lineNum, startChar),
                    Position.create(lineNum, startChar + labelName.length)
                ),
                scope: isLocal ? currentScope : null,
                value: value || undefined
            });
            continue;
        }
    }

    return { labels, scopeAtLine };
}

function indexDocument(document: TextDocument): void {
    const index = parseDocument(document);
    documentIndex.set(document.uri, index);
}

function getWordAtPosition(document: TextDocument, position: Position): string | null {
    const text = document.getText();
    const lines = text.split('\n');
    const line = lines[position.line];

    if (!line) return null;

    let start = position.character;
    let end = position.character;

    // Expand left (include _ for local symbols, . for scoped access)
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

function findDefinition(word: string, fromUri: string, fromLine: number): Location | null {
    const label = findSymbolInfo(word, fromUri, fromLine);
    if (label) {
        return Location.create(label.uri, label.range);
    }
    return null;
}

// Folding pairs: opening directive -> closing directive
const FOLDING_PAIRS: Record<string, string> = {
    '.proc': '.pend',
    '.block': '.bend',
    '.macro': '.endm',
    '.function': '.endf',
    '.if': '.endif',
    '.for': '.next',
    '.rept': '.endr',
    '.struct': '.ends',
    '.union': '.endu',
    '.switch': '.endswitch',
    '.comment': '.endc'
};

function computeFoldingRanges(document: TextDocument): FoldingRange[] {
    const ranges: FoldingRange[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    // Stack of open folding regions: { directive, line }
    const stack: { directive: string; line: number }[] = [];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum].toLowerCase();

        // Check for opening directives
        for (const [open, close] of Object.entries(FOLDING_PAIRS)) {
            // Match opening directive (with optional label before it)
            const openPattern = new RegExp(`(?:^|\\s)\\${open}\\b`);
            if (openPattern.test(line)) {
                stack.push({ directive: open, line: lineNum });
            }

            // Match closing directive
            const closePattern = new RegExp(`(?:^|\\s)\\${close}\\b`);
            if (closePattern.test(line)) {
                // Find matching opening directive
                for (let i = stack.length - 1; i >= 0; i--) {
                    if (stack[i].directive === open) {
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

function validateDocument(document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split('\n');
    const index = documentIndex.get(document.uri);

    if (!index) return diagnostics;

    // Check for duplicate labels
    const seenLabels = new Map<string, LabelDefinition>(); // key: "scope:name"
    for (const label of index.labels) {
        const key = `${label.scope ?? 'global'}:${label.name}`;
        const existing = seenLabels.get(key);
        if (existing) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: label.range,
                message: `Duplicate label '${label.name}'`,
                source: 'tass64'
            });
        } else {
            seenLabels.set(key, label);
        }
    }

    // Check for unclosed blocks
    const blockStack: { directive: string; line: number; name?: string }[] = [];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const lineLower = line.toLowerCase();

        for (const [open, close] of Object.entries(FOLDING_PAIRS)) {
            const openPattern = new RegExp(`(?:^|\\s)\\${open}\\b`, 'i');
            const closePattern = new RegExp(`(?:^|\\s)\\${close}\\b`, 'i');

            if (openPattern.test(lineLower)) {
                // Extract label name if present
                const labelMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/);
                blockStack.push({
                    directive: open,
                    line: lineNum,
                    name: labelMatch?.[1]
                });
            }

            if (closePattern.test(lineLower)) {
                // Find matching opening directive
                let found = false;
                for (let i = blockStack.length - 1; i >= 0; i--) {
                    if (blockStack[i].directive === open) {
                        blockStack.splice(i, 1);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    // Closing without opening
                    const match = lineLower.match(closePattern);
                    const startCol = match ? lineLower.indexOf(close) : 0;
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(
                            Position.create(lineNum, startCol),
                            Position.create(lineNum, startCol + close.length)
                        ),
                        message: `'${close}' without matching '${open}'`,
                        source: 'tass64'
                    });
                }
            }
        }
    }

    // Report unclosed blocks
    for (const unclosed of blockStack) {
        const closeDirective = FOLDING_PAIRS[unclosed.directive];
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(
                Position.create(unclosed.line, 0),
                Position.create(unclosed.line, lines[unclosed.line].length)
            ),
            message: `Unclosed '${unclosed.directive}' - missing '${closeDirective}'`,
            source: 'tass64'
        });
    }

    return diagnostics;
}

function findSymbolInfo(word: string, fromUri: string, fromLine: number): LabelDefinition | null {
    const isLocalSymbol = word.startsWith('_');
    const baseName = word.split('.')[0];

    let referenceScope: string | null = null;
    const fromIndex = documentIndex.get(fromUri);
    if (fromIndex && isLocalSymbol) {
        referenceScope = fromIndex.scopeAtLine.get(fromLine) ?? null;
    }

    for (const [uri, index] of documentIndex) {
        for (const label of index.labels) {
            if (label.name === word || label.name === baseName) {
                if (isLocalSymbol) {
                    if (uri === fromUri && label.scope === referenceScope) {
                        return label;
                    }
                } else {
                    if (label.scope === null) {
                        return label;
                    }
                }
            }
        }
    }

    return null;
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            definitionProvider: true,
            foldingRangeProvider: true,
            hoverProvider: true
        }
    };
});

connection.onInitialized(() => {
    connection.console.log('tass64 language server initialized');
    documents.all().forEach(indexDocument);
});

connection.onDefinition((params: DefinitionParams): Location | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    return findDefinition(word, params.textDocument.uri, params.position.line);
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

    const symbol = findSymbolInfo(word, params.textDocument.uri, params.position.line);
    if (!symbol) return null;

    // Build hover content
    let content = `**${symbol.name}**`;
    if (symbol.value) {
        content += `\n\n\`= ${symbol.value}\``;
    }

    return {
        contents: {
            kind: MarkupKind.Markdown,
            value: content
        }
    };
});

documents.onDidChangeContent(change => {
    indexDocument(change.document);

    // Validate and send diagnostics
    const diagnostics = validateDocument(change.document);
    connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

documents.onDidClose(event => {
    documentIndex.delete(event.document.uri);
    // Clear diagnostics for closed document
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
