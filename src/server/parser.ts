import { Range, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { LabelDefinition, DocumentIndex, LabelKind } from './types';
import { OPCODES, SCOPE_OPENERS } from './constants';
import { stripComment, getBlockComment, detectDefinePragmas } from './utils';

export type LogFunction = (message: string) => void;

export function parseDocument(document: TextDocument, caseSensitive = false, log?: LogFunction): DocumentIndex {
    const labels: LabelDefinition[] = [];
    const scopeAtLine: Map<number, { scopePath: string | null; localScope: string | null; withScopes: string[] }> = new Map();
    const parametersAtScope: Map<string, string[]> = new Map();
    const macroSubLabels: Map<string, string[]> = new Map();
    const labelDefinedByMacro: Map<string, string> = new Map();
    const structInstances: Map<string, string> = new Map();
    const includes: string[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    // Stack for directive-based scopes: { name, directive }
    const scopeStack: { name: string | null; directive: string }[] = [];
    // Current code label for local symbol scoping
    let currentLocalScope: string | null = null;
    // Scopes imported by enclosing `.with` directives, innermost last. Recorded as
    // written and resolved at query time, since the target may live in another file.
    const withScopes: string[] = [];
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

    // Symbols supplied by "; 64tass-langserv: define NAME = VALUE" pragmas, which
    // stand in for the -D flags a real build passes on the command line. Indexed as
    // ordinary re-assignable variables so they resolve like any other symbol.
    for (const def of detectDefinePragmas(text)) {
        labels.push({
            name: normalizeName(def.name),
            originalName: def.name,
            uri: document.uri,
            range: Range.create(
                Position.create(def.line, def.nameStart),
                Position.create(def.line, def.nameStart + def.name.length)
            ),
            scopePath: null,
            localScope: null,
            isLocal: false,
            kind: 'var',
            value: def.value
        });
    }

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const lineLower = line.toLowerCase();

        // Record scope info for this line
        scopeAtLine.set(lineNum, {
            scopePath: getCurrentScopePath(),
            localScope: currentLocalScope,
            withScopes: [...withScopes]
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

        // `.with scope` imports a scope for unqualified lookups until `.endwith`.
        // Deliberately not pushed onto scopeStack: a label DEFINED inside a .with
        // block belongs to the enclosing scope, not the imported one (verified).
        const withMatch = line.match(/(?:^|\s)\.with\s+([a-zA-Z_][a-zA-Z0-9_.]*)/i);
        if (withMatch) {
            scopeAtLine.set(lineNum, {
                scopePath: getCurrentScopePath(),
                localScope: currentLocalScope,
                withScopes: [...withScopes]
            });
            withScopes.push(normalizeName(withMatch[1]));
            continue;
        }
        if (/(?:^|\s)\.endwith\b/i.test(lineLower)) {
            withScopes.pop();
            scopeAtLine.set(lineNum, {
                scopePath: getCurrentScopePath(),
                localScope: currentLocalScope,
                withScopes: [...withScopes]
            });
            continue;
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
                localScope: currentLocalScope,
                withScopes: [...withScopes]
            });
            continue;
        }

        // Check for scope-opening directives with labels: "name .proc", "name .block", etc.
        // Allow leading indentation - 64tass accepts an indented named scope opener
        // (e.g. a nested "    inner .proc"), same as the data/macro-call label branches below.
        // The label may also be followed by a colon ("outer: .proc", even "outer:.proc").
        // The separator is deliberately "whitespace OR colon" rather than an optional
        // colon plus optional whitespace: allowing neither would make a plain dotted
        // reference like "outer.proc" parse as label "outer" opening a .proc scope.
        for (const [open] of Object.entries(SCOPE_OPENERS)) {
            // Safe: directive name from static constant (SCOPE_OPENERS)
            const openPattern = new RegExp(`^(\\s*)([a-zA-Z][a-zA-Z0-9_]*)(?:\\s*:\\s*|\\s+)\\${open}\\b\\s*(.*)`, 'i');
            const match = line.match(openPattern);
            if (match) {
                const startChar = match[1].length;
                const labelName = match[2];
                const currentPath = getCurrentScopePath();
                const paramsStr = match[3] ? stripComment(match[3]).trim() : '';
                const comment = getBlockComment(lines, lineNum);

                labels.push({
                    name: normalizeName(labelName),
                    originalName: labelName,
                    uri: document.uri,
                    range: Range.create(
                        Position.create(lineNum, startChar),
                        Position.create(lineNum, startChar + labelName.length)
                    ),
                    scopePath: currentPath,
                    localScope: null,
                    isLocal: false,
                    kind: open.slice(1) as LabelKind,
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
                    localScope: currentLocalScope,
                    withScopes: [...withScopes]
                });
                continue;
            }

            // Safe: directive name from static constant (SCOPE_OPENERS)
            const anonPattern = new RegExp(`^\\s*\\${open}\\b`, 'i');
            if (anonPattern.test(lineLower)) {
                scopeStack.push({ name: null, directive: open });
                scopeAtLine.set(lineNum, {
                    scopePath: getCurrentScopePath(),
                    localScope: currentLocalScope,
                    withScopes: [...withScopes]
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
                localScope: currentLocalScope,
                withScopes: [...withScopes]
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
                isLocal: false,
                kind: 'code'
            });
            continue;
        }

        // Code label followed by opcode (also a local scope boundary)
        // Separated by whitespace or a colon: "LOOP: INX", "LOOP:INX", "LOOP INX".
        // Deliberately still anchored at column 0 with no indent group: an indented
        // "<opcode> <opcode>" line (e.g. "  jsr rts") would otherwise be read as a
        // label followed by an opcode.
        const codeLabelOpcodeMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)(?:\s*:\s*|\s+)([a-zA-Z]{3})\b/);
        if (codeLabelOpcodeMatch && OPCODES.has(codeLabelOpcodeMatch[2].toLowerCase())) {
            const labelName = codeLabelOpcodeMatch[1];
            currentLocalScope = normalizeName(labelName);
            scopeAtLine.set(lineNum, {
                scopePath: getCurrentScopePath(),
                localScope: currentLocalScope,
                withScopes: [...withScopes]
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
                isLocal: false,
                kind: 'code'
            });
            continue;
        }

        // Loop variable of ".for i = 0, i < 13, i = i + 1" (and .bfor). Recorded as
        // a re-assignable 'var': the assembler keeps it defined after .next and lets
        // a later loop reuse the same name, so it must not trip the duplicate check.
        // .while/.rept take no variable, so they are deliberately not matched here.
        // The loop may itself be labelled ("squarelo .for i = 0, ..."), in which case
        // that label is a data label for the emitted bytes and is recorded too.
        const forVarMatch = line.match(
            /^(\s*)((?:[a-zA-Z_][a-zA-Z0-9_]*)(?:\s*:\s*|\s+))?(\.b?for\s+)([a-zA-Z_][a-zA-Z0-9_]*)\s*=/i
        );
        if (forVarMatch) {
            const indent = forVarMatch[1].length;
            const loopLabel = forVarMatch[2];

            // Optional label in front of the loop, e.g. "squarelo .for ..."
            if (loopLabel) {
                const loopLabelName = loopLabel.replace(/[\s:]+$/, '');
                labels.push({
                    name: normalizeName(loopLabelName),
                    originalName: loopLabelName,
                    uri: document.uri,
                    range: Range.create(
                        Position.create(lineNum, indent),
                        Position.create(lineNum, indent + loopLabelName.length)
                    ),
                    scopePath: getCurrentScopePath(),
                    localScope: null,
                    isLocal: false,
                    kind: 'data'
                });
            }

            const startChar = indent + (loopLabel?.length ?? 0) + forVarMatch[3].length;
            const labelName = forVarMatch[4];
            const isLocal = labelName.startsWith('_');

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
                kind: 'var'
            });
            continue;
        }

        // Re-assignable variable: "v .var 1". Unlike "=" constants these may be
        // redefined (the normal way to use them, e.g. an accumulator in a .for
        // loop), so they are tagged 'var' and exempted from the duplicate check.
        // Must be tested before the macro-call branch below, which would otherwise
        // claim ".var" as an ordinary macro invocation and file it as 'data'.
        const varLabelMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*:\s*|\s+)\.var\b\s*([^;]*)/i);
        if (varLabelMatch) {
            const labelName = varLabelMatch[2];
            const startChar = varLabelMatch[1].length;
            const isLocal = labelName.startsWith('_');
            const value = varLabelMatch[3]?.trim();

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
                kind: 'var',
                value: value || undefined
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
                isLocal: true,
                kind: 'const'
            });
            continue;
        }

        // Anonymous labels: + or - at start of line (can have multiples)
        // Can be on their own line or followed by an instruction: "-  INX"
        // Each symbol creates a separate label entry for precise distance calculation
        const anonMatch = line.match(/^(\s*)([+-]+)\s*(:)?(?:\s|;|$)/);
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
                        // Scoped by the enclosing .proc/.block only - unlike _local
                        // symbols, anonymous labels are not bound to the nearest code
                        // label, so localScope is not recorded for them.
                        localScope: null,
                        isLocal: false,
                        kind: 'code',
                        isAnonymous: true,
                        anonymousCount: i + 1 // 1 for first +, 2 for second +, etc.
                    });
                }
                continue;
            }
        }

        // Labels with data directives (not scope-creating)
        // Separated by whitespace or a colon: "HI: .byte $00", even "HI:.byte $00"
        // Allow leading indentation, since sub-labels are conventionally indented inside a .proc/.block
        const dataLabelMatch = line.match(/^(\s*)([a-zA-Z][a-zA-Z0-9_]*)(?:\s*:\s*|\s+)\.(byte|word|addr|fill|text|ptext|null)\b/i);
        if (dataLabelMatch) {
            const labelName = dataLabelMatch[2];
            const startChar = dataLabelMatch[1].length;
            labels.push({
                name: normalizeName(labelName),
                originalName: labelName,
                uri: document.uri,
                range: Range.create(
                    Position.create(lineNum, startChar),
                    Position.create(lineNum, startChar + labelName.length)
                ),
                scopePath: getCurrentScopePath(),
                localScope: null,
                isLocal: false,
                kind: 'data'
            });
            continue;
        }


        // Struct/union instance: "p1 .dstruct pt, 1, 2" defines p1 whose members
        // mirror pt's, so "p1.posx" must resolve to pt's posx (verified against the
        // assembler, which also rejects a member the struct does not declare).
        const structInstanceMatch = line.match(
            /^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*:\s*|\s+)\.(dstruct|dunion)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/i);
        if (structInstanceMatch) {
            const startChar = structInstanceMatch[1].length;
            const labelName = structInstanceMatch[2];
            const structName = normalizeName(structInstanceMatch[4]);

            labels.push({
                name: normalizeName(labelName),
                originalName: labelName,
                uri: document.uri,
                range: Range.create(
                    Position.create(lineNum, startChar),
                    Position.create(lineNum, startChar + labelName.length)
                ),
                scopePath: getCurrentScopePath(),
                localScope: null,
                isLocal: false,
                kind: 'data'
            });
            structInstances.set(normalizeName(labelName), structName);
            continue;
        }

        // Labels defined via macro calls (e.g., "label .macro_name args")
        // Track which macro was used so we can validate sub-label references
        // Separated by whitespace or a colon: "label: .macro_name args", even "label:.macro_name"
        // Allow leading indentation, since sub-labels are conventionally indented inside a .proc/.block
        const macroLabelMatch = line.match(/^(\s*)([a-zA-Z][a-zA-Z0-9_]*)(?:\s*:\s*|\s+)\.([a-zA-Z_][a-zA-Z0-9_]*)\b/i);
        if (macroLabelMatch) {
            const labelName = macroLabelMatch[2];
            const startChar = macroLabelMatch[1].length;
            const macroCalled = normalizeName(macroLabelMatch[3]);
            // Skip if this is a scope-creating directive (already handled above)
            if (!Object.keys(SCOPE_OPENERS).includes('.' + macroCalled)) {
                labels.push({
                    name: normalizeName(labelName),
                    originalName: labelName,
                    uri: document.uri,
                    range: Range.create(
                        Position.create(lineNum, startChar),
                        Position.create(lineNum, startChar + labelName.length)
                    ),
                    scopePath: getCurrentScopePath(),
                    localScope: null,
                    isLocal: false,
                    kind: 'data'
                });
                // Track the macro used to define this label (for sub-label validation)
                labelDefinedByMacro.set(normalizeName(labelName), macroCalled);
            }
            continue;
        }

        // Constant assignment ("v = 1") or re-assignable variable ("v := 1").
        // The assembler rejects redefining "=" but allows redefining ":=", so the
        // two are tagged differently for the duplicate check.
        const constMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*(:?)=\s*([^;]+)/);
        if (constMatch) {
            const labelName = constMatch[2];
            const startChar = constMatch[1].length;
            const isLocal = labelName.startsWith('_');
            const isReassignable = constMatch[3] === ':';
            const value = constMatch[4]?.trim();

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
                kind: isReassignable ? 'var' : 'const',
                value: value || undefined
            });
            continue;
        }
    }

    return { labels, scopeAtLine, parametersAtScope, macroSubLabels, labelDefinedByMacro, structInstances, includes, caseSensitive };
}
