import { Range, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { LabelDefinition, DocumentIndex } from './types';
import { OPCODES, SCOPE_OPENERS } from './constants';
import { stripComment, getBlockComment } from './utils';

export type LogFunction = (message: string) => void;

export function parseDocument(document: TextDocument, caseSensitive = false, log?: LogFunction): DocumentIndex {
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

    // Helper to normalize names based on case sensitivity
    function normalizeName(name: string): string {
        return caseSensitive ? name : name.toLowerCase();
    }

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
            } catch (e) {
                log?.(`Failed to resolve .include path '${includePath}': ${e}`);
            }
        }

        // Check for scope-closing directives first
        let closedScope = false;
        for (const [open, close] of Object.entries(SCOPE_OPENERS)) {
            // Safe: directive name from static constant (SCOPE_OPENERS)
            const closePattern = new RegExp(`(?:^|\\s)\\${close}\\b`, 'i');
            if (closePattern.test(lineLower)) {
                // If closing a macro, extract sub-labels from its body (stored normalized)
                if (open === '.macro' && currentMacroCapture) {
                    const subLabels: string[] = [];
                    for (let i = currentMacroCapture.startLine; i < lineNum; i++) {
                        const macroLine = lines[i];
                        // Look for label definitions at start of line: "name" or "name =" or "name .byte", etc.
                        const labelMatch = macroLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:$|:|=|\.)/);
                        if (labelMatch) {
                            subLabels.push(normalizeName(labelMatch[1]));
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
            // Safe: directive name from static constant (SCOPE_OPENERS)
            const openPattern = new RegExp(`^([a-zA-Z][a-zA-Z0-9_]*)\\s+\\${open}\\b\\s*(.*)`, 'i');
            const match = line.match(openPattern);
            if (match) {
                const labelName = match[1];
                const currentPath = getCurrentScopePath();
                const paramsStr = match[2] ? stripComment(match[2]).trim() : '';
                const comment = getBlockComment(lines, lineNum);

                labels.push({
                    name: normalizeName(labelName),
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

                // Push named scope (normalized for matching)
                scopeStack.push({ name: normalizeName(labelName), directive: open });

                // Extract parameters for .function and .macro (stored normalized)
                if ((open === '.function' || open === '.macro') && paramsStr) {
                    const newScopePath = getCurrentScopePath() || normalizeName(labelName);
                    const params = paramsStr.split(',').map(p => normalizeName(p.trim())).filter(p => p.length > 0);
                    if (params.length > 0) {
                        parametersAtScope.set(newScopePath, params);
                    }
                }

                // Start capturing macro body to extract sub-labels
                if (open === '.macro') {
                    currentMacroCapture = { name: normalizeName(labelName), startLine: lineNum + 1 };
                }

                // Update scope for this line after opening
                scopeAtLine.set(lineNum, {
                    scopePath: getCurrentScopePath(),
                    localScope: currentLocalScope
                });
                continue;
            }

            // Safe: directive name from static constant (SCOPE_OPENERS)
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
            currentLocalScope = normalizeName(labelName);
            scopeAtLine.set(lineNum, {
                scopePath: getCurrentScopePath(),
                localScope: currentLocalScope
            });

            labels.push({
                name: normalizeName(labelName),
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
            currentLocalScope = normalizeName(labelName);
            scopeAtLine.set(lineNum, {
                scopePath: getCurrentScopePath(),
                localScope: currentLocalScope
            });

            labels.push({
                name: normalizeName(labelName),
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
            const startChar = localMatch[1].length;

            labels.push({
                name: normalizeName(labelName),
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

        // Anonymous labels: + or - at start of line (can have multiples)
        // Can be on their own line or followed by an instruction: "-  INX"
        // Each symbol creates a separate label entry for precise distance calculation
        const anonMatch = line.match(/^(\s*)([+\-]+)\s*(:)?(?:\s|;|$)/);
        if (anonMatch) {
            const symbols = anonMatch[2]; // The +++ or --- string
            const direction = symbols[0]; // First char: '+' or '-'
            const leadingWhitespace = anonMatch[1].length;

            // Validate that all symbols are the same (no mixing + and -)
            if (symbols.split('').every(c => c === direction)) {
                // Create a separate label for each + or - symbol
                for (let i = 0; i < symbols.length; i++) {
                    labels.push({
                        name: direction, // '+' or '-'
                        originalName: symbols.substring(0, i + 1), // '+', '++', '+++', etc.
                        uri: document.uri,
                        range: Range.create(
                            Position.create(lineNum, leadingWhitespace + i),
                            Position.create(lineNum, leadingWhitespace + i + 1)
                        ),
                        scopePath: getCurrentScopePath(),
                        localScope: currentLocalScope,
                        isLocal: true,  // Scoped like local symbols
                        isAnonymous: true,
                        anonymousCount: i + 1 // 1 for first +, 2 for second +, etc.
                    });
                }
                continue;
            }
        }

        // Labels with data directives (not scope-creating)
        const dataLabelMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s+\.(byte|word|addr|fill|text|ptext|null)\b/i);
        if (dataLabelMatch) {
            const labelName = dataLabelMatch[1];
            labels.push({
                name: normalizeName(labelName),
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
            const macroCalled = normalizeName(macroLabelMatch[2]);
            // Skip if this is a scope-creating directive (already handled above)
            if (!Object.keys(SCOPE_OPENERS).includes('.' + macroCalled)) {
                labels.push({
                    name: normalizeName(labelName),
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
                labelDefinedByMacro.set(normalizeName(labelName), macroCalled);
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
                name: normalizeName(labelName),
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
