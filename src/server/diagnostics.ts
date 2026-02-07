import {
    Range,
    Position,
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { LabelDefinition, DocumentIndex } from './types';
import {
    OPCODES,
    FOLDING_PAIRS,
    CLOSING_DIRECTIVES,
    OPENER_TO_CLOSERS,
    BUILTINS,
    BUILTIN_DIRECTIVES_PATTERN
} from './constants';
import { parseLineStructure, stripStrings, tokenizeExpression } from './utils';
import { findSymbolInfo, isParameter, findAnonymousLabel } from './symbols';

export function validateDocument(
    document: TextDocument,
    documentIndex: Map<string, DocumentIndex>
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split('\n');
    const index = documentIndex.get(document.uri);

    if (!index) return diagnostics;

    // Check for duplicate labels (same name, same scopePath, same localScope)
    // All names are stored lowercase, so simple comparison works
    // Skip anonymous labels - they're allowed to have multiple instances
    const seenLabels = new Map<string, LabelDefinition>();
    for (const label of index.labels) {
        // Anonymous labels can have multiple instances in the same scope
        if (label.isAnonymous) continue;

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

    // Check for unclosed blocks and undefined symbols in a single pass
    const blockStack: { directive: string; line: number }[] = [];
    const symbolPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\b/g;
    const macroCallPattern = /\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const { code } = parseLineStructure(line);
        const codeLower = code.toLowerCase();

        // Check for opening directives
        for (const open of Object.keys(FOLDING_PAIRS)) {
            // Safe: directive name from static constant (FOLDING_PAIRS)
            const openPattern = new RegExp(`(?:^|\\s)\\${open}\\b`, 'i');
            if (openPattern.test(codeLower)) {
                blockStack.push({ directive: open, line: lineNum });
            }
        }

        // Check for closing directives
        for (const [close, openers] of Object.entries(CLOSING_DIRECTIVES)) {
            // Safe: directive name from static constant (CLOSING_DIRECTIVES)
            const closePattern = new RegExp(`(?:^|\\s)\\${close}\\b`, 'i');
            if (closePattern.test(codeLower)) {
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
                    const startCol = codeLower.indexOf(close);
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

        // Symbol validation - skip empty lines and label definitions
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
                BUILTIN_DIRECTIVES_PATTERN.test(directive);

            if (!isBuiltinDirective) {
                // Try to find the macro definition
                const symbol = findSymbolInfo(fullMatch, document.uri, lineNum, documentIndex);
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

            // Check for missing operators between data directive values
            if (dataDirectiveMatch) {
                const tokens = tokenizeExpression(operand);

                // Look for consecutive value tokens without operator between them
                for (let i = 0; i < tokens.length - 1; i++) {
                    const curr = tokens[i];
                    const next = tokens[i + 1];

                    if (curr.type === 'value' && next.type === 'value') {
                        // Found two consecutive values without operator
                        const errorPos = operandStart + next.start;
                        diagnostics.push({
                            severity: DiagnosticSeverity.Error,
                            range: Range.create(
                                Position.create(lineNum, errorPos),
                                Position.create(lineNum, errorPos + next.text.length)
                            ),
                            message: `An operator is expected before '${next.text}'`,
                            source: '64tass'
                        });
                    }
                }
            }

            // Check for anonymous label references (+ or -)
            // ONLY in opcode context (branch/jump instructions), NOT in data directives
            // Data directives use +/- for arithmetic/unary operators
            if (opcodeMatch) {
                const anonRefPattern = /([+\-]+)/g;
                let anonMatch;
                while ((anonMatch = anonRefPattern.exec(operand)) !== null) {
                    const ref = anonMatch[1]; // '+', '--', '+++', etc.
                    const matchIndex = anonMatch.index;

                    // Skip if not a valid anonymous reference (mixed symbols)
                    if (!ref.split('').every(c => c === ref[0])) continue;

                    // Skip if adjacent to alphanumeric or $ (like table+1, value-offset, $1000+5, #-1)
                    const before = matchIndex > 0 ? operand[matchIndex - 1] : ' ';
                    const after = matchIndex + ref.length < operand.length ? operand[matchIndex + ref.length] : ' ';
                    if (/[a-zA-Z0-9_$#]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;

                    // Skip if there's any non-whitespace before the +/- (like "table + offset")
                    // Anonymous labels must be at the start of the operand
                    const beforeText = operand.substring(0, matchIndex).trim();
                    if (beforeText.length > 0) continue;

                    const direction = ref[0] as '+' | '-';
                    const distance = ref.length;

                    // Validate that the reference can be resolved
                    const targetLabel = findAnonymousLabel(
                        direction,
                        distance,
                        document.uri,
                        lineNum,
                        documentIndex
                    );

                    if (!targetLabel) {
                        const startCol = operandStart + matchIndex;
                        diagnostics.push({
                            severity: DiagnosticSeverity.Warning,
                            range: Range.create(
                                Position.create(lineNum, startCol),
                                Position.create(lineNum, startCol + ref.length)
                            ),
                            message: `No ${direction === '+' ? 'forward' : 'backward'} anonymous label found`,
                            source: '64tass'
                        });
                    }
                }
            }

            // Strip string literals to avoid matching symbols inside strings
            const operandNoStrings = stripStrings(operand);
            symbolPattern.lastIndex = 0;
            while ((match = symbolPattern.exec(operandNoStrings)) !== null) {
                const symName = match[1];
                const symLower = symName.toLowerCase();

                // Skip if it's a register, opcode, or builtin
                if (BUILTINS.has(symLower) || OPCODES.has(symLower)) continue;
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

                const symbol = findSymbolInfo(symName, document.uri, lineNum, documentIndex);
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

    // Check for unclosed blocks after processing all lines
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

    return diagnostics;
}
