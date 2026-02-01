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
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

interface LabelDefinition {
    name: string;
    uri: string;
    range: Range;
    // Full scope path for directive-based scopes (e.g., "outer.inner" or null for global)
    scopePath: string | null;
    // For local symbols (_name): the code label they belong to
    localScope: string | null;
    // Whether this is a local symbol (starts with _)
    isLocal: boolean;
    value?: string;
}

interface DocumentIndex {
    labels: LabelDefinition[];
    // Maps line number to { scopePath, localScope }
    scopeAtLine: Map<number, { scopePath: string | null; localScope: string | null }>;
    // Maps scope path to list of parameter names (for .function and .macro)
    parametersAtScope: Map<string, string[]>;
    // Maps macro name to list of sub-labels it defines in its body
    macroSubLabels: Map<string, string[]>;
    // Maps label name to the macro used to define it (for labels defined via macro calls)
    labelDefinedByMacro: Map<string, string>;
    // URIs of files included via .include directive
    includes: string[];
}

const documentIndex: Map<string, DocumentIndex> = new Map();

// 6502 opcodes for detecting code labels (scope boundaries for local symbols)
const OPCODES = new Set([
    // Standard 6502 opcodes
    'adc', 'and', 'asl', 'bcc', 'bcs', 'beq', 'bit', 'bmi', 'bne', 'bpl',
    'brk', 'bvc', 'bvs', 'clc', 'cld', 'cli', 'clv', 'cmp', 'cpx', 'cpy',
    'dec', 'dex', 'dey', 'eor', 'inc', 'inx', 'iny', 'jmp', 'jsr', 'lda',
    'ldx', 'ldy', 'lsr', 'nop', 'ora', 'pha', 'php', 'pla', 'plp', 'rol',
    'ror', 'rti', 'rts', 'sbc', 'sec', 'sed', 'sei', 'sta', 'stx', 'sty',
    'tax', 'tay', 'tsx', 'txa', 'txs', 'tya',
    // Undocumented 6502 opcodes (as used by 64tass)
    'ane', 'arr', 'asr', 'dcp', 'isb', 'jam', 'lax', 'lds', 'rla', 'rra',
    'sax', 'sbx', 'sha', 'shs', 'shx', 'shy', 'slo', 'sre', 'ahx', 'alr',
    'axs', 'dcm', 'ins', 'isc', 'lae', 'las', 'lxa', 'tas', 'xaa'
]);

// Directives that create new scopes (opener -> primary closer)
const SCOPE_OPENERS: Record<string, string> = {
    '.proc': '.pend',
    '.block': '.bend',
    '.macro': '.endm',
    '.function': '.endf',
    '.struct': '.ends',
    '.union': '.endu',
    '.namespace': '.endn'
};

// All valid closers for each opener
// Loops can be closed by .next OR their specific .end* directive
const OPENER_TO_CLOSERS: Record<string, string[]> = {
    '.proc': ['.pend', '.endproc'],
    '.block': ['.bend', '.endblock'],
    '.macro': ['.endm', '.endmacro'],
    '.function': ['.endf', '.endfunction'],
    '.struct': ['.ends', '.endstruct'],
    '.union': ['.endu', '.endunion'],
    '.if': ['.endif', '.fi'],
    '.ifeq': ['.endif', '.fi'],
    '.ifne': ['.endif', '.fi'],
    '.ifmi': ['.endif', '.fi'],
    '.ifpl': ['.endif', '.fi'],
    '.for': ['.next', '.endfor'],
    '.bfor': ['.next', '.endfor'],
    '.rept': ['.next', '.endrept'],
    '.brept': ['.next', '.endrept'],
    '.while': ['.next', '.endwhile'],
    '.bwhile': ['.next', '.endwhile'],
    '.switch': ['.endswitch'],
    '.comment': ['.endc', '.endcomment'],
    '.weak': ['.endweak'],
    '.with': ['.endwith'],
    '.encode': ['.endencode'],
    '.alignblk': ['.endalignblk'],
    '.page': ['.endp', '.endpage'],
    '.logical': ['.endlogical'],
    '.virtual': ['.endv', '.endvirtual'],
    '.namespace': ['.endn', '.endnamespace'],
    '.section': ['.send', '.endsection'],
    '.segment': ['.endsegment']
};

// Reverse mapping: closer -> list of openers it can close
const CLOSING_DIRECTIVES: Record<string, string[]> = {};
for (const [open, closers] of Object.entries(OPENER_TO_CLOSERS)) {
    for (const close of closers) {
        if (!CLOSING_DIRECTIVES[close]) {
            CLOSING_DIRECTIVES[close] = [];
        }
        if (!CLOSING_DIRECTIVES[close].includes(open)) {
            CLOSING_DIRECTIVES[close].push(open);
        }
    }
}

// For compatibility: FOLDING_PAIRS maps opener to primary closer
const FOLDING_PAIRS: Record<string, string> = {};
for (const [open, closers] of Object.entries(OPENER_TO_CLOSERS)) {
    FOLDING_PAIRS[open] = closers[0];
}

function parseDocument(document: TextDocument): DocumentIndex {
    const labels: LabelDefinition[] = [];
    const scopeAtLine: Map<number, { scopePath: string | null; localScope: string | null }> = new Map();
    const parametersAtScope: Map<string, string[]> = new Map();
    const macroSubLabels: Map<string, string[]> = new Map();
    const labelDefinedByMacro: Map<string, string> = new Map();
    const includes: string[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    // Stack for directive-based scopes: { name, directive }
    const scopeStack: { name: string | null; directive: string }[] = [];
    // Current code label for local symbol scoping
    let currentLocalScope: string | null = null;
    // Track macro bodies for extracting sub-labels: { name, startLine }
    let currentMacroCapture: { name: string; startLine: number } | null = null;

    function getCurrentScopePath(): string | null {
        const named = scopeStack.filter(s => s.name !== null).map(s => s.name);
        return named.length > 0 ? named.join('.') : null;
    }

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const lineLower = line.toLowerCase();

        // Record scope info for this line
        scopeAtLine.set(lineNum, {
            scopePath: getCurrentScopePath(),
            localScope: currentLocalScope
        });

        // Skip empty lines and comment-only lines
        if (/^\s*;/.test(line) || /^\s*$/.test(line)) {
            continue;
        }

        // Check for .include directives
        const includeMatch = line.match(/^\s*\.include\s+["']([^"']+)["']/i);
        if (includeMatch) {
            const includePath = includeMatch[1];
            // Resolve relative to current document
            try {
                const currentPath = fileURLToPath(document.uri);
                const currentDir = path.dirname(currentPath);
                const resolvedPath = path.resolve(currentDir, includePath);
                if (fs.existsSync(resolvedPath)) {
                    includes.push(pathToFileURL(resolvedPath).toString());
                }
            } catch {
                // Ignore invalid URIs
            }
        }

        // Check for scope-closing directives first
        let closedScope = false;
        for (const [open, close] of Object.entries(SCOPE_OPENERS)) {
            const closePattern = new RegExp(`(?:^|\\s)\\${close}\\b`, 'i');
            if (closePattern.test(lineLower)) {
                // If closing a macro, extract sub-labels from its body
                if (open === '.macro' && currentMacroCapture) {
                    const subLabels: string[] = [];
                    for (let i = currentMacroCapture.startLine; i < lineNum; i++) {
                        const macroLine = lines[i];
                        // Look for label definitions at start of line: "name" or "name =" or "name .byte", etc.
                        const labelMatch = macroLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:$|:|=|\.)/);
                        if (labelMatch) {
                            subLabels.push(labelMatch[1]);
                        }
                    }
                    if (subLabels.length > 0) {
                        macroSubLabels.set(currentMacroCapture.name.toLowerCase(), subLabels);
                    }
                    currentMacroCapture = null;
                }

                // Pop matching scope from stack
                for (let i = scopeStack.length - 1; i >= 0; i--) {
                    if (scopeStack[i].directive === open) {
                        scopeStack.splice(i, 1);
                        closedScope = true;
                        break;
                    }
                }
            }
        }
        if (closedScope) {
            // Update scope after closing
            scopeAtLine.set(lineNum, {
                scopePath: getCurrentScopePath(),
                localScope: currentLocalScope
            });
            continue;
        }

        // Check for scope-opening directives with labels: "name .proc", "name .block", etc.
        for (const [open] of Object.entries(SCOPE_OPENERS)) {
            // Pattern captures: name, optional parameters after the directive
            const openPattern = new RegExp(`^([a-zA-Z][a-zA-Z0-9_]*)\\s+\\${open}\\b\\s*(.*)`, 'i');
            const match = line.match(openPattern);
            if (match) {
                const labelName = match[1];
                const currentPath = getCurrentScopePath();
                const paramsStr = match[2] ? stripComment(match[2]).trim() : '';

                labels.push({
                    name: labelName,
                    uri: document.uri,
                    range: Range.create(
                        Position.create(lineNum, 0),
                        Position.create(lineNum, labelName.length)
                    ),
                    scopePath: currentPath,
                    localScope: null,
                    isLocal: false
                });

                // Push named scope
                scopeStack.push({ name: labelName, directive: open });

                // Extract parameters for .function and .macro
                if ((open === '.function' || open === '.macro') && paramsStr) {
                    const newScopePath = getCurrentScopePath() || labelName;
                    const params = paramsStr.split(',').map(p => p.trim()).filter(p => p.length > 0);
                    if (params.length > 0) {
                        parametersAtScope.set(newScopePath, params);
                    }
                }

                // Start capturing macro body to extract sub-labels
                if (open === '.macro') {
                    currentMacroCapture = { name: labelName, startLine: lineNum + 1 };
                }

                // Update scope for this line after opening
                scopeAtLine.set(lineNum, {
                    scopePath: getCurrentScopePath(),
                    localScope: currentLocalScope
                });
                continue;
            }

            // Anonymous scope opener: just ".proc" without a name
            const anonPattern = new RegExp(`^\\s*\\${open}\\b`, 'i');
            if (anonPattern.test(lineLower)) {
                scopeStack.push({ name: null, directive: open });
                scopeAtLine.set(lineNum, {
                    scopePath: getCurrentScopePath(),
                    localScope: currentLocalScope
                });
            }
        }

        // Check for code label (local symbol scope boundary):
        // Regular name at line start, followed by nothing/comment/colon/opcode
        // NOT followed by a scope-creating directive
        const codeLabelMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*(:)?\s*(;.*)?$/);
        if (codeLabelMatch) {
            const labelName = codeLabelMatch[1];
            currentLocalScope = labelName;
            scopeAtLine.set(lineNum, {
                scopePath: getCurrentScopePath(),
                localScope: currentLocalScope
            });

            labels.push({
                name: labelName,
                uri: document.uri,
                range: Range.create(
                    Position.create(lineNum, 0),
                    Position.create(lineNum, labelName.length)
                ),
                scopePath: getCurrentScopePath(),
                localScope: null,
                isLocal: false
            });
            continue;
        }

        // Code label followed by opcode (also a local scope boundary)
        const codeLabelOpcodeMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s+([a-zA-Z]{3})\b/);
        if (codeLabelOpcodeMatch && OPCODES.has(codeLabelOpcodeMatch[2].toLowerCase())) {
            const labelName = codeLabelOpcodeMatch[1];
            currentLocalScope = labelName;
            scopeAtLine.set(lineNum, {
                scopePath: getCurrentScopePath(),
                localScope: currentLocalScope
            });

            labels.push({
                name: labelName,
                uri: document.uri,
                range: Range.create(
                    Position.create(lineNum, 0),
                    Position.create(lineNum, labelName.length)
                ),
                scopePath: getCurrentScopePath(),
                localScope: null,
                isLocal: false
            });
            continue;
        }

        // Local symbol: starts with underscore
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
                scopePath: getCurrentScopePath(),
                localScope: currentLocalScope,
                isLocal: true
            });
            continue;
        }

        // Labels with data directives (not scope-creating)
        const dataLabelMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s+\.(byte|word|addr|fill|text|ptext|null)\b/i);
        if (dataLabelMatch) {
            const labelName = dataLabelMatch[1];
            labels.push({
                name: labelName,
                uri: document.uri,
                range: Range.create(
                    Position.create(lineNum, 0),
                    Position.create(lineNum, labelName.length)
                ),
                scopePath: getCurrentScopePath(),
                localScope: null,
                isLocal: false
            });
            continue;
        }

        // Labels defined via macro calls (e.g., "label .macro_name args")
        // Track which macro was used so we can validate sub-label references
        const macroLabelMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s+\.([a-zA-Z_][a-zA-Z0-9_]*)\b/i);
        if (macroLabelMatch) {
            const labelName = macroLabelMatch[1];
            const macroCalled = macroLabelMatch[2].toLowerCase();
            // Skip if this is a scope-creating directive (already handled above)
            if (!Object.keys(SCOPE_OPENERS).includes('.' + macroCalled)) {
                labels.push({
                    name: labelName,
                    uri: document.uri,
                    range: Range.create(
                        Position.create(lineNum, 0),
                        Position.create(lineNum, labelName.length)
                    ),
                    scopePath: getCurrentScopePath(),
                    localScope: null,
                    isLocal: false
                });
                // Track the macro used to define this label (for sub-label validation)
                labelDefinedByMacro.set(labelName, macroCalled);
            }
            continue;
        }

        // Constant assignment
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
                scopePath: getCurrentScopePath(),
                localScope: isLocal ? currentLocalScope : null,
                isLocal,
                value: value || undefined
            });
            continue;
        }
    }

    return { labels, scopeAtLine, parametersAtScope, macroSubLabels, labelDefinedByMacro, includes };
}

function indexDocument(document: TextDocument, indexedUris: Set<string> = new Set()): void {
    // Prevent circular includes
    if (indexedUris.has(document.uri)) {
        return;
    }
    indexedUris.add(document.uri);

    const index = parseDocument(document);
    documentIndex.set(document.uri, index);

    // Recursively index included files
    for (const includeUri of index.includes) {
        if (!indexedUris.has(includeUri)) {
            try {
                const includePath = fileURLToPath(includeUri);
                const content = fs.readFileSync(includePath, 'utf-8');
                const includeDoc = TextDocument.create(includeUri, '64tass', 1, content);
                indexDocument(includeDoc, indexedUris);
            } catch {
                // File not found or unreadable
            }
        }
    }
}

function getWordAtPosition(document: TextDocument, position: Position): string | null {
    const text = document.getText();
    const lines = text.split('\n');
    const line = lines[position.line];

    if (!line) return null;

    let start = position.character;
    let end = position.character;

    while (start > 0 && /[a-zA-Z0-9_.]/.test(line[start - 1])) {
        start--;
    }

    while (end < line.length && /[a-zA-Z0-9_.]/.test(line[end])) {
        end++;
    }

    const word = line.substring(start, end);
    return word.length > 0 ? word : null;
}

function findSymbolInfo(word: string, fromUri: string, fromLine: number): LabelDefinition | null {
    const fromIndex = documentIndex.get(fromUri);
    if (!fromIndex) return null;

    const lineScope = fromIndex.scopeAtLine.get(fromLine);
    const currentScopePath = lineScope?.scopePath ?? null;
    const currentLocalScope = lineScope?.localScope ?? null;

    // Handle macro calls like ".macroname" - strip leading dot
    // (macros are defined as "name .macro" but called as ".name")
    let lookupWord = word;
    if (word.startsWith('.') && !word.includes('.', 1)) {
        lookupWord = word.substring(1);
    }

    const isLocalSymbol = lookupWord.startsWith('_');

    // Handle dotted references like "scope.symbol"
    if (lookupWord.includes('.')) {
        const parts = lookupWord.split('.');
        const targetName = parts[parts.length - 1];
        const targetPath = parts.slice(0, -1).join('.');

        for (const [, index] of documentIndex) {
            for (const label of index.labels) {
                if (label.name === targetName) {
                    // Check if scope path matches or ends with the target path
                    if (label.scopePath === targetPath ||
                        label.scopePath?.endsWith('.' + targetPath)) {
                        return label;
                    }
                }
            }
        }
        return null;
    }

    // Local symbol lookup: must match same document, same scopePath, same localScope
    if (isLocalSymbol) {
        for (const label of fromIndex.labels) {
            if (label.name === lookupWord && label.isLocal &&
                label.scopePath === currentScopePath &&
                label.localScope === currentLocalScope) {
                return label;
            }
        }
        return null;
    }

    // Regular symbol lookup: search current scope, then parent scopes
    // First, try exact scope match
    for (const [, index] of documentIndex) {
        for (const label of index.labels) {
            if (label.name === lookupWord && !label.isLocal && label.scopePath === currentScopePath) {
                return label;
            }
        }
    }

    // Then try parent scopes up to global
    let scopeToTry = currentScopePath;
    while (scopeToTry !== null) {
        const lastDot = scopeToTry.lastIndexOf('.');
        scopeToTry = lastDot >= 0 ? scopeToTry.substring(0, lastDot) : null;

        for (const [, index] of documentIndex) {
            for (const label of index.labels) {
                if (label.name === lookupWord && !label.isLocal && label.scopePath === scopeToTry) {
                    return label;
                }
            }
        }
    }

    // Finally try global scope
    for (const [, index] of documentIndex) {
        for (const label of index.labels) {
            if (label.name === lookupWord && !label.isLocal && label.scopePath === null) {
                return label;
            }
        }
    }

    return null;
}

function findDefinition(word: string, fromUri: string, fromLine: number): Location | null {
    const label = findSymbolInfo(word, fromUri, fromLine);
    if (label) {
        return Location.create(label.uri, label.range);
    }
    return null;
}

// Strip comments from a line (handle strings to avoid stripping ; inside strings)
function stripComment(line: string): string {
    let inString = false;
    let stringChar = '';
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inString) {
            if (char === stringChar && line[i - 1] !== '\\') {
                inString = false;
            }
        } else {
            if (char === '"' || char === "'") {
                inString = true;
                stringChar = char;
            } else if (char === ';') {
                return line.substring(0, i);
            }
        }
    }
    return line;
}

function computeFoldingRanges(document: TextDocument): FoldingRange[] {
    const ranges: FoldingRange[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    const stack: { directive: string; line: number }[] = [];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = stripComment(lines[lineNum]).toLowerCase();

        // Check for opening directives
        for (const open of Object.keys(FOLDING_PAIRS)) {
            const openPattern = new RegExp(`(?:^|\\s)\\${open}\\b`);
            if (openPattern.test(line)) {
                stack.push({ directive: open, line: lineNum });
            }
        }

        // Check for closing directives
        for (const [close, openers] of Object.entries(CLOSING_DIRECTIVES)) {
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

// Check if a symbol is a parameter in the current scope or any parent scope
function isParameter(symName: string, scopePath: string | null, index: DocumentIndex): boolean {
    // Check exact scope
    if (scopePath) {
        const params = index.parametersAtScope.get(scopePath);
        if (params && params.includes(symName)) {
            return true;
        }
        // Check parent scopes
        let parent = scopePath;
        while (parent.includes('.')) {
            parent = parent.substring(0, parent.lastIndexOf('.'));
            const parentParams = index.parametersAtScope.get(parent);
            if (parentParams && parentParams.includes(symName)) {
                return true;
            }
        }
    }
    return false;
}

function validateDocument(document: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split('\n');
    const index = documentIndex.get(document.uri);

    if (!index) return diagnostics;

    // Check for duplicate labels (same name, same scopePath, same localScope)
    const seenLabels = new Map<string, LabelDefinition>();
    for (const label of index.labels) {
        const key = `${label.scopePath ?? 'global'}:${label.localScope ?? 'none'}:${label.name}`;
        const existing = seenLabels.get(key);
        if (existing) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: label.range,
                message: `Duplicate label '${label.name}'`,
                source: '64tass'
            });
        } else {
            seenLabels.set(key, label);
        }
    }

    // Check for unclosed blocks
    const blockStack: { directive: string; line: number }[] = [];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const lineLower = stripComment(lines[lineNum]).toLowerCase();

        // Check for opening directives
        for (const open of Object.keys(FOLDING_PAIRS)) {
            const openPattern = new RegExp(`(?:^|\\s)\\${open}\\b`, 'i');
            if (openPattern.test(lineLower)) {
                blockStack.push({ directive: open, line: lineNum });
            }
        }

        // Check for closing directives
        for (const [close, openers] of Object.entries(CLOSING_DIRECTIVES)) {
            const closePattern = new RegExp(`(?:^|\\s)\\${close}\\b`, 'i');
            if (closePattern.test(lineLower)) {
                // Find the most recent matching opener
                let found = false;
                for (let i = blockStack.length - 1; i >= 0; i--) {
                    if (openers.includes(blockStack[i].directive)) {
                        blockStack.splice(i, 1);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    const startCol = lineLower.indexOf(close);
                    const expectedOpeners = openers.join(', ');
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(
                            Position.create(lineNum, startCol >= 0 ? startCol : 0),
                            Position.create(lineNum, (startCol >= 0 ? startCol : 0) + close.length)
                        ),
                        message: `'${close}' without matching ${expectedOpeners}`,
                        source: '64tass'
                    });
                }
            }
        }
    }

    for (const unclosed of blockStack) {
        const closeDirective = FOLDING_PAIRS[unclosed.directive];
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(
                Position.create(unclosed.line, 0),
                Position.create(unclosed.line, lines[unclosed.line].length)
            ),
            message: `Unclosed '${unclosed.directive}' - missing '${closeDirective}'`,
            source: '64tass'
        });
    }

    // Check for undefined symbols
    // Pattern to match potential symbol references (including dotted scope references like scope.label)
    const symbolPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\b/g;
    const macroCallPattern = /\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

    // Built-in names to ignore
    const builtins = new Set([
        // Registers
        'a', 'x', 'y',
        // Boolean/null literals
        'true', 'false',
        // Built-in functions (can be shadowed by user definitions)
        'abs', 'acos', 'addr', 'all', 'any', 'asin', 'atan', 'atan2', 'binary',
        'byte', 'cbrt', 'ceil', 'char', 'cos', 'cosh', 'deg', 'dint', 'dword',
        'exp', 'floor', 'format', 'frac', 'hypot', 'len', 'lint', 'log', 'log10',
        'long', 'pow', 'rad', 'random', 'range', 'repr', 'round', 'rta', 'sign',
        'sin', 'sinh', 'sint', 'size', 'sort', 'sqrt', 'tan', 'tanh', 'trunc', 'word',
    ]);

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const code = stripComment(line);

        // Skip empty lines and comment-only lines
        if (code.trim() === '') continue;

        // Skip lines that are label definitions (they define, not reference)
        if (/^[a-zA-Z_][a-zA-Z0-9_]*\s*[:=]/.test(code)) continue;
        if (/^[a-zA-Z_][a-zA-Z0-9_]*\s+\.(macro|function|proc|block|struct|union)\b/i.test(code)) continue;

        // Check macro calls like .macroname
        let match;
        macroCallPattern.lastIndex = 0;
        while ((match = macroCallPattern.exec(code)) !== null) {
            const macroName = match[1];
            const fullMatch = match[0];
            const startCol = match.index;

            // Skip if this is part of a dotted reference (e.g., tbl.lo - the .lo is not a macro call)
            if (startCol > 0 && /[a-zA-Z0-9_]/.test(code[startCol - 1])) {
                continue;
            }

            // Skip built-in directives
            const directive = '.' + macroName.toLowerCase();
            const isBuiltinDirective = Object.keys(OPENER_TO_CLOSERS).includes(directive) ||
                Object.keys(CLOSING_DIRECTIVES).includes(directive) ||
                /^\.(byte|word|long|dword|addr|rta|text|ptext|null|fill|align|binary|include|binclude|org|cpu|enc|cdef|edef|assert|error|warn|cerror|cwarn|var|let|const|here|as|option|eor|seed|else|elsif|elif|case|default|shift|shiftl|proff|pron|hidemac|showmac|continue|break|breakif|continueif|sfunction|lbl|goto|databank|dpage|autsiz|mansiz|char|dint|lint|sint|dsection|dstruct|dunion|offs|tdef|al|alignind|alignpageind|check|from|xl|xs|end)$/i.test(directive);

            if (!isBuiltinDirective) {
                // Try to find the macro definition
                const symbol = findSymbolInfo(fullMatch, document.uri, lineNum);
                if (!symbol) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: Range.create(
                            Position.create(lineNum, startCol),
                            Position.create(lineNum, startCol + fullMatch.length)
                        ),
                        message: `Undefined macro '${macroName}'`,
                        source: '64tass'
                    });
                }
            }
        }

        // Check regular symbol references (after opcodes, in expressions, etc.)
        // Look for symbols after opcodes
        const opcodeMatch = code.match(/^\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\s+)?([a-zA-Z]{3})\s+(.+)$/i);
        if (opcodeMatch && OPCODES.has(opcodeMatch[1].toLowerCase())) {
            const operand = opcodeMatch[2];
            const operandStart = code.indexOf(operand);
            const lineScope = index.scopeAtLine.get(lineNum);
            const currentScopePath = lineScope?.scopePath ?? null;

            symbolPattern.lastIndex = 0;
            while ((match = symbolPattern.exec(operand)) !== null) {
                const symName = match[1];
                const symLower = symName.toLowerCase();

                // Skip if it's a register, opcode, or builtin
                if (builtins.has(symLower) || OPCODES.has(symLower)) continue;
                // Skip numbers (might be caught as identifiers if they have letters like in hex)
                if (/^[0-9]/.test(symName)) continue;
                // Skip hex numbers like $FE - if preceded by $ and only contains hex digits
                if (match.index > 0 && operand[match.index - 1] === '$' && /^[0-9A-Fa-f]+$/.test(symName)) continue;
                // Skip if it's a parameter in the current scope
                if (isParameter(symName, currentScopePath, index)) continue;

                // For dotted references like param.lo or label.hi
                if (symName.includes('.')) {
                    const parts = symName.split('.');
                    const parentName = parts[0];
                    const subLabelName = parts[parts.length - 1];

                    // If parent is a parameter, skip (we can't validate runtime values)
                    if (isParameter(parentName, currentScopePath, index)) continue;

                    // Check if parent label was defined via a macro that creates this sub-label
                    const macroUsed = index.labelDefinedByMacro.get(parentName);
                    if (macroUsed) {
                        const macroLabels = index.macroSubLabels.get(macroUsed);
                        const subLabelLower = subLabelName.toLowerCase();
                        if (macroLabels && macroLabels.some(l => l.toLowerCase() === subLabelLower)) {
                            continue; // Valid sub-label from macro
                        }
                    }
                }

                const symbol = findSymbolInfo(symName, document.uri, lineNum);
                if (!symbol) {
                    const startCol = operandStart + match.index;
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: Range.create(
                            Position.create(lineNum, startCol),
                            Position.create(lineNum, startCol + symName.length)
                        ),
                        message: `Undefined symbol '${symName}'`,
                        source: '64tass'
                    });
                }
            }
        }
    }

    return diagnostics;
}

connection.onInitialize((_params: InitializeParams): InitializeResult => {
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
    connection.console.log('64tass language server initialized');
    documents.all().forEach(doc => indexDocument(doc));
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
                } catch {
                    // Ignore invalid paths
                }
            }
        }
    }

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

    let content = `**${symbol.name}**`;
    if (symbol.scopePath) {
        content += ` *(in ${symbol.scopePath})*`;
    }
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

    const diagnostics = validateDocument(change.document);
    connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

documents.onDidClose(event => {
    documentIndex.delete(event.document.uri);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
