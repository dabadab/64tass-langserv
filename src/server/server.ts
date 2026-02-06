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
    DiagnosticSeverity,
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

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

interface LabelDefinition {
    // Symbol name in lowercase (64tass is case-insensitive)
    name: string;
    // Original symbol name preserving case (for display)
    originalName: string;
    uri: string;
    range: Range;
    // Full scope path for directive-based scopes (e.g., "outer.inner" or null for global)
    // Stored lowercase for case-insensitive matching
    scopePath: string | null;
    // For local symbols (_name): the code label they belong to (lowercase)
    localScope: string | null;
    // Whether this is a local symbol (starts with _)
    isLocal: boolean;
    value?: string;
    // Documentation comment from same line, line above, or line below
    comment?: string;
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

// Extract comment text from a line (returns the text after ;, preserving indentation)
// Strips one leading space if present (conventional separator after ;)
function extractComment(line: string): string | null {
    const idx = line.indexOf(';');
    if (idx >= 0) {
        let comment = line.substring(idx + 1).trimEnd();
        // Remove single leading space (conventional "; comment" format)
        if (comment.startsWith(' ')) {
            comment = comment.substring(1);
        }
        return comment.length > 0 ? comment : null;
    }
    return null;
}

// Get associated comment for a block label at lineNum
// Checks: same line, lines above, lines below (in that priority order)
// Multiple consecutive comment lines are joined together
function getBlockComment(lines: string[], lineNum: number): string | undefined {
    // Same line comment
    const sameLine = extractComment(lines[lineNum]);
    if (sameLine) return sameLine;

    // Lines above (must be comment-only lines, collect all consecutive)
    if (lineNum > 0 && /^\s*;/.test(lines[lineNum - 1])) {
        const commentLines: string[] = [];
        for (let i = lineNum - 1; i >= 0; i--) {
            if (/^\s*;/.test(lines[i])) {
                const comment = extractComment(lines[i]);
                if (comment) commentLines.unshift(comment);
            } else {
                break;
            }
        }
        if (commentLines.length > 0) {
            return commentLines.join('  \n');
        }
    }

    // Lines below (must be comment-only lines, collect all consecutive)
    if (lineNum < lines.length - 1 && /^\s*;/.test(lines[lineNum + 1])) {
        const commentLines: string[] = [];
        for (let i = lineNum + 1; i < lines.length; i++) {
            if (/^\s*;/.test(lines[i])) {
                const comment = extractComment(lines[i]);
                if (comment) commentLines.push(comment);
            } else {
                break;
            }
        }
        if (commentLines.length > 0) {
            return commentLines.join('  \n');
        }
    }

    return undefined;
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
                // If closing a macro, extract sub-labels from its body (stored lowercase)
                if (open === '.macro' && currentMacroCapture) {
                    const subLabels: string[] = [];
                    for (let i = currentMacroCapture.startLine; i < lineNum; i++) {
                        const macroLine = lines[i];
                        // Look for label definitions at start of line: "name" or "name =" or "name .byte", etc.
                        const labelMatch = macroLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:$|:|=|\.)/);
                        if (labelMatch) {
                            subLabels.push(labelMatch[1].toLowerCase());
                        }
                    }
                    if (subLabels.length > 0) {
                        macroSubLabels.set(currentMacroCapture.name, subLabels);
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
                const comment = getBlockComment(lines, lineNum);

                const labelNameLower = labelName.toLowerCase();
                labels.push({
                    name: labelNameLower,
                    originalName: labelName,
                    uri: document.uri,
                    range: Range.create(
                        Position.create(lineNum, 0),
                        Position.create(lineNum, labelName.length)
                    ),
                    scopePath: currentPath,
                    localScope: null,
                    isLocal: false,
                    comment
                });

                // Push named scope (lowercase for case-insensitive matching)
                scopeStack.push({ name: labelNameLower, directive: open });

                // Extract parameters for .function and .macro (stored lowercase)
                if ((open === '.function' || open === '.macro') && paramsStr) {
                    const newScopePath = getCurrentScopePath() || labelNameLower;
                    const params = paramsStr.split(',').map(p => p.trim().toLowerCase()).filter(p => p.length > 0);
                    if (params.length > 0) {
                        parametersAtScope.set(newScopePath, params);
                    }
                }

                // Start capturing macro body to extract sub-labels
                if (open === '.macro') {
                    currentMacroCapture = { name: labelNameLower, startLine: lineNum + 1 };
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
            const labelNameLower = labelName.toLowerCase();
            currentLocalScope = labelNameLower;
            scopeAtLine.set(lineNum, {
                scopePath: getCurrentScopePath(),
                localScope: currentLocalScope
            });

            labels.push({
                name: labelNameLower,
                originalName: labelName,
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
            const labelNameLower = labelName.toLowerCase();
            currentLocalScope = labelNameLower;
            scopeAtLine.set(lineNum, {
                scopePath: getCurrentScopePath(),
                localScope: currentLocalScope
            });

            labels.push({
                name: labelNameLower,
                originalName: labelName,
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
            const labelNameLower = labelName.toLowerCase();
            const startChar = localMatch[1].length;

            labels.push({
                name: labelNameLower,
                originalName: labelName,
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
            const labelNameLower = labelName.toLowerCase();
            labels.push({
                name: labelNameLower,
                originalName: labelName,
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
            const labelNameLower = labelName.toLowerCase();
            const macroCalled = macroLabelMatch[2].toLowerCase();
            // Skip if this is a scope-creating directive (already handled above)
            if (!Object.keys(SCOPE_OPENERS).includes('.' + macroCalled)) {
                labels.push({
                    name: labelNameLower,
                    originalName: labelName,
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
                labelDefinedByMacro.set(labelNameLower, macroCalled);
            }
            continue;
        }

        // Constant assignment
        const constMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:?=\s*([^;]+)/);
        if (constMatch) {
            const labelName = constMatch[2];
            const labelNameLower = labelName.toLowerCase();
            const startChar = constMatch[1].length;
            const isLocal = labelName.startsWith('_');
            const value = constMatch[3]?.trim();

            labels.push({
                name: labelNameLower,
                originalName: labelName,
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
    // All stored names are lowercase for case-insensitive matching
    const lookupName = lookupWord.toLowerCase();

    const isLocalSymbol = lookupWord.startsWith('_');

    // Handle dotted references like "scope.symbol"
    if (lookupWord.includes('.')) {
        const parts = lookupName.split('.');
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
            if (label.name === lookupName && label.isLocal &&
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
            if (label.name === lookupName && !label.isLocal && label.scopePath === currentScopePath) {
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
                if (label.name === lookupName && !label.isLocal && label.scopePath === scopeToTry) {
                    return label;
                }
            }
        }
    }

    // Finally try global scope
    for (const [, index] of documentIndex) {
        for (const label of index.labels) {
            if (label.name === lookupName && !label.isLocal && label.scopePath === null) {
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
// In 64tass, "" inside a string is an escaped quote, backslashes are literal
function stripComment(line: string): string {
    let inString = false;
    let stringChar = '';
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inString) {
            if (char === stringChar) {
                // Check for escaped quote (doubled quote)
                if (i + 1 < line.length && line[i + 1] === stringChar) {
                    i++; // Skip the escaped quote
                } else {
                    inString = false;
                }
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

// Strip string literals from a line, replacing contents with spaces to preserve positions
// Used to avoid matching symbols inside string literals
function stripStrings(line: string): string {
    let result = '';
    let inString = false;
    let stringChar = '';
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inString) {
            if (char === stringChar) {
                // Check for escaped quote (doubled quote)
                if (i + 1 < line.length && line[i + 1] === stringChar) {
                    result += '  '; // Replace both quotes with spaces
                    i++;
                } else {
                    result += char; // Keep the closing quote
                    inString = false;
                }
            } else {
                result += ' '; // Replace string content with space
            }
        } else {
            result += char;
            if (char === '"' || char === "'") {
                inString = true;
                stringChar = char;
            }
        }
    }
    return result;
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
// All parameter names are stored lowercase
function isParameter(symName: string, scopePath: string | null, index: DocumentIndex): boolean {
    const symNameLower = symName.toLowerCase();
    // Check exact scope
    if (scopePath) {
        const params = index.parametersAtScope.get(scopePath);
        if (params && params.includes(symNameLower)) {
            return true;
        }
        // Check parent scopes
        let parent = scopePath;
        while (parent.includes('.')) {
            parent = parent.substring(0, parent.lastIndexOf('.'));
            const parentParams = index.parametersAtScope.get(parent);
            if (parentParams && parentParams.includes(symNameLower)) {
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
    // All names are stored lowercase, so simple comparison works
    const seenLabels = new Map<string, LabelDefinition>();
    for (const label of index.labels) {
        const key = `${label.scopePath ?? 'global'}:${label.localScope ?? 'none'}:${label.name}`;
        const existing = seenLabels.get(key);
        if (existing) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: label.range,
                message: `Duplicate label '${label.originalName}'`,
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

    // Directives with optional closing tags
    const optionalClose = new Set(['.logical']);

    for (const unclosed of blockStack) {
        // Skip directives that have optional closers
        if (optionalClose.has(unclosed.directive)) continue;

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

        // Check regular symbol references (after opcodes or data directives)
        // Look for symbols after opcodes
        const opcodeMatch = code.match(/^\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\s+)?([a-zA-Z]{3})\s+(.+)$/i);
        // Look for symbols after data directives like .text, .byte, .word, etc.
        const dataDirectiveMatch = code.match(/^\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\s+)?\.(byte|word|long|dword|addr|rta|text|ptext|null|fill|char|dint|lint|sint)\s+(.+)$/i);

        let operand: string | null = null;
        let operandStart = 0;

        if (opcodeMatch && OPCODES.has(opcodeMatch[1].toLowerCase())) {
            operand = opcodeMatch[2];
            operandStart = code.indexOf(operand);
        } else if (dataDirectiveMatch) {
            operand = dataDirectiveMatch[2];
            operandStart = code.indexOf(operand);
        }

        if (operand) {
            const lineScope = index.scopeAtLine.get(lineNum);
            const currentScopePath = lineScope?.scopePath ?? null;

            // Strip string literals to avoid matching symbols inside strings
            const operandNoStrings = stripStrings(operand);
            symbolPattern.lastIndex = 0;
            while ((match = symbolPattern.exec(operandNoStrings)) !== null) {
                const symName = match[1];
                const symLower = symName.toLowerCase();

                // Skip if it's a register, opcode, or builtin
                if (builtins.has(symLower) || OPCODES.has(symLower)) continue;
                // Skip numbers (might be caught as identifiers if they have letters like in hex)
                if (/^[0-9]/.test(symName)) continue;
                // Skip hex numbers like $FE - if preceded by $ and only contains hex digits
                if (match.index > 0 && operandNoStrings[match.index - 1] === '$' && /^[0-9A-Fa-f]+$/.test(symName)) continue;
                // Skip if it's a parameter in the current scope
                if (isParameter(symName, currentScopePath, index)) continue;

                // For dotted references like param.lo or label.hi
                if (symName.includes('.')) {
                    const parts = symName.split('.');
                    const parentName = parts[0];
                    const parentNameLower = parentName.toLowerCase();
                    const subLabelName = parts[parts.length - 1].toLowerCase();

                    // If parent is a parameter, skip (we can't validate runtime values)
                    if (isParameter(parentName, currentScopePath, index)) continue;

                    // Check if parent label was defined via a macro that creates this sub-label
                    const macroUsed = index.labelDefinedByMacro.get(parentNameLower);
                    if (macroUsed) {
                        const macroLabels = index.macroSubLabels.get(macroUsed);
                        if (macroLabels && macroLabels.includes(subLabelName)) {
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
            referencesProvider: true,
            renameProvider: true,
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

// Parse a numeric value from various formats (decimal, hex, binary)
function parseNumericValue(value: string): number | null {
    const trimmed = value.trim();

    // Hexadecimal: $FF or 0xFF or 0xABC
    const hexMatch = trimmed.match(/^\$([0-9a-fA-F]+)$/) || trimmed.match(/^0x([0-9a-fA-F]+)$/i);
    if (hexMatch) {
        return parseInt(hexMatch[1], 16);
    }

    // Binary: %10101010 or 0b10101010
    const binMatch = trimmed.match(/^%([01]+)$/) || trimmed.match(/^0b([01]+)$/i);
    if (binMatch) {
        return parseInt(binMatch[1], 2);
    }

    // Decimal: 123 or -123
    const decMatch = trimmed.match(/^-?\d+$/);
    if (decMatch) {
        return parseInt(trimmed, 10);
    }

    return null;
}

// Format a number in binary, decimal, and hexadecimal
function formatNumericValue(num: number): string {
    const bin = num >= 0 ? '%' + num.toString(2) : '-' + '%' + Math.abs(num).toString(2);
    const dec = num.toString(10);
    const hex = num >= 0 ? '$' + num.toString(16).toUpperCase() : '-$' + Math.abs(num).toString(16).toUpperCase();
    return `${bin}, ${dec}, ${hex}`;
}

connection.onHover((params: HoverParams): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    const symbol = findSymbolInfo(word, params.textDocument.uri, params.position.line);
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
    const symbol = findSymbolInfo(word, params.textDocument.uri, params.position.line);
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
            } catch {
                continue;
            }
        }

        const lines = docContent.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            const code = stripComment(line);

            // Skip empty lines
            if (code.trim() === '') continue;

            // Find all occurrences of the symbol name in this line
            const symbolName = symbol.name;
            const escapedName = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Pattern to match the symbol as a whole word
            // For local symbols (_name), match with underscore
            // For regular symbols, match word boundaries
            // Also match macro calls (.name)
            const patterns: RegExp[] = [];

            if (symbol.isLocal) {
                // Local symbol: match exactly with word boundaries
                patterns.push(new RegExp(`\\b${escapedName}\\b`, 'g'));
            } else {
                // Regular symbol: match as word or as macro call (.name)
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
                            lineNum
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

// Find comment start position in a line (returns -1 if no comment)
// In 64tass, "" inside a string is an escaped quote, backslashes are literal
function getCommentStart(line: string): number {
    let inString = false;
    let stringChar = '';
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inString) {
            if (char === stringChar) {
                // Check for escaped quote (doubled quote)
                if (i + 1 < line.length && line[i + 1] === stringChar) {
                    i++; // Skip the escaped quote
                } else {
                    inString = false;
                }
            }
        } else {
            if (char === '"' || char === "'") {
                inString = true;
                stringChar = char;
            } else if (char === ';') {
                return i;
            }
        }
    }
    return -1;
}

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    // Find the symbol definition
    const symbol = findSymbolInfo(word, params.textDocument.uri, params.position.line);
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
            } catch {
                continue;
            }
        }

        const lines = docContent.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            const code = stripComment(line);
            const commentStart = getCommentStart(line);

            const symbolName = symbol.name;
            const escapedName = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const patterns: RegExp[] = [];
            if (symbol.isLocal) {
                patterns.push(new RegExp(`\\b${escapedName}\\b`, 'g'));
            } else {
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
                                lineNum
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
                // Only match whole words in comments (no macro call syntax)
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
