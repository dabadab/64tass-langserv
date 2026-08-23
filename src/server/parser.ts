import { Range, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { LabelDefinition, DocumentIndex, LabelKind } from './types';
import { SCOPE_OPENERS, CLOSING_DIRECTIVES, opcodesForCpu, DEFAULT_CPU } from './constants';
import { blockDirectivesOn } from './blocks';
import { resolveIncludePath } from './paths';
import { stripComment, getBlockComment, detectDefinePragmas, detectCpu, splitTopLevel, parameterName, findCommentBlockLines, findDictKeys } from './utils';

export type LogFunction = (message: string) => void;

/** Index of the last element satisfying `predicate`, or -1. */
function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
    for (let i = items.length - 1; i >= 0; i--) {
        if (predicate(items[i])) return i;
    }
    return -1;
}

// Compound assignments modify an existing variable rather than defining one.
const COMPOUND_ASSIGNMENT = /^(?:\.\.|\*\*|<<|>>|[-+*/&|^%])=$/;


export interface ParseOptions {
    /** Effective case sensitivity for this document (pragma may have overridden the setting). */
    caseSensitive?: boolean;
    log?: LogFunction;
    /** Effective CPU target; a `.cpu` directive in the text still wins over it. */
    cpu?: string;
    /**
     * Scope this whole file sits inside, set when it was reached through a
     * `.binclude`. Prefixed onto every scope path the file produces.
     */
    baseScope?: string | null;
    /** Extra directories to search for includes, mirroring 64tass's `-I` flag. */
    includePaths?: readonly string[];
}

export function parseDocument(
    document: TextDocument,
    options: ParseOptions = {}
): DocumentIndex {
    const { caseSensitive = false, log, cpu = DEFAULT_CPU, baseScope = null, includePaths = [] } = options;

    const text = document.getText();
    // A `.cpu` directive or cpu pragma in the file always wins over the value
    // inherited from the parent, mirroring the case-sensitivity cascade.
    const effectiveCpu = detectCpu(text) ?? cpu;
    // Which mnemonics count as opcodes depends on the target: label detection gates
    // on this, so a mnemonic the CPU does not have leaves the line unindexed.
    const opcodes = opcodesForCpu(effectiveCpu);

    const labels: LabelDefinition[] = [];
    const scopeAtLine: Map<number, { scopePath: string | null; localScope: string | null; withScopes: string[] }> = new Map();
    const parametersAtScope: Map<string, string[]> = new Map();
    const macroSubLabels: Map<string, string[]> = new Map();
    const labelDefinedByMacro: Map<string, string> = new Map();
    const functionReturnScope: Map<string, string> = new Map();
    const structInstances: Map<string, string> = new Map();
    const includes: string[] = [];
    const includeScopes: Map<string, string> = new Map();
    const lines = text.split('\n');
    const commentBlockLines = findCommentBlockLines(lines);

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
        const parts = baseScope ? [baseScope, ...named] : named;
        return parts.length > 0 ? parts.join('.') : null;
    }

    // No documentation comment on these three: a pragma's own line IS the comment,
    // so it would document itself with its own syntax.
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

        // Everything between `.comment` and `.endc`/`.endcomment` is ignored by the
        // assembler, so nothing in there is indexed.
        if (commentBlockLines.has(lineNum)) {
            continue;
        }

        // `.include` splices a file in textually; `label .binclude "f"` wraps it in
        // a block scope, so f's `sym` is reachable only as `label.sym` (verified).
        // Both are followed when indexing, but a .binclude records the full scope
        // path its contents land in, so the file can be parsed with that as its base.
        const includeMatch = line.match(/^\s*(?:([a-zA-Z_][a-zA-Z0-9_]*)\s*:?)?\s*\.(include|binclude)\s+["']([^"']+)["']/i);
        if (includeMatch) {
            const [, includeLabel, directive, includePath] = includeMatch;
            const isBinclude = directive.toLowerCase() === 'binclude';
            const enclosing = getCurrentScopePath();

            // 64tass looks next to the includer first, then along the search
            // paths, so resolveIncludePath does both.
            const includeUri = resolveIncludePath(document.uri, includePath, includePaths);
            if (includeUri) {
                includes.push(includeUri);
                if (isBinclude) {
                    // An unlabelled .binclude still opens a scope, just an
                    // unnameable one - its symbols are unreachable from outside
                    // (verified). A synthetic name reproduces that: it keeps them
                    // out of the global namespace while still indexing the file.
                    const scopeName = includeLabel ? normalizeName(includeLabel) : `.binclude@${lineNum}`;
                    includeScopes.set(includeUri, enclosing ? `${enclosing}.${scopeName}` : scopeName);
                }
            } else {
                log?.(`Could not resolve .${directive} path '${includePath}'`);
            }

            if (isBinclude) {
                // The label names a scope, so it is indexed as one rather than
                // falling through to the data-directive branch below. Recorded even
                // when the path did not resolve, so it is still a known symbol.
                if (includeLabel) {
                    const labelStart = line.indexOf(includeLabel);
                    labels.push({
                        name: normalizeName(includeLabel),
                        originalName: includeLabel,
                        uri: document.uri,
                        range: Range.create(
                            Position.create(lineNum, labelStart),
                            Position.create(lineNum, labelStart + includeLabel.length)
                        ),
                        scopePath: enclosing,
                        localScope: null,
                        isLocal: false,
                        kind: 'block',
                        comment: getBlockComment(lines, lineNum)
                    });
                }
                continue;
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

        // Check for scope-closing directives first. blockDirectivesOn strips the
        // comment and any string contents, so a `.pend` that is only being talked
        // about does not close anything - the parser used to test the raw line and
        // file every following label under the wrong scope.
        const { opened: openersOnLine, closed: closersOnLine } = blockDirectivesOn(line);
        let closedScope = false;
        for (const closer of closersOnLine) {
            // Which of the open scopes this closer ends, innermost first.
            const openers = CLOSING_DIRECTIVES[closer].filter(o => o in SCOPE_OPENERS);
            const index = findLastIndex(scopeStack, entry => openers.includes(entry.directive));
            if (index < 0) continue;
            const open = scopeStack[index].directive;

            // Closing a macro: collect the sub-labels its body defines (normalized)
            if (open === '.macro' && currentMacroCapture) {
                const subLabels: string[] = [];
                for (let i = currentMacroCapture.startLine; i < lineNum; i++) {
                    // Look for label definitions at start of line: "name" or "name =" or "name .byte", etc.
                    const labelMatch = lines[i].match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:$|:|=|\.)/);
                    if (labelMatch) subLabels.push(normalizeName(labelMatch[1]));
                }
                if (subLabels.length > 0) {
                    macroSubLabels.set(currentMacroCapture.name, subLabels);
                }
                currentMacroCapture = null;
            }

            // "`.endf mapdata`" returns a scope defined inside the function, so the
            // members of a call's result are that scope's, not the function's own.
            // "`.endf namespace(*)`" returns the function scope itself and needs no
            // entry - that is the default.
            if (open === '.function') {
                const returned = line.match(/(?:^|\s)\.endf(?:unction)?\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:;.*)?$/i);
                const functionPath = getCurrentScopePath();
                if (returned && functionPath) {
                    functionReturnScope.set(functionPath, `${functionPath}.${normalizeName(returned[1])}`);
                }
            }

            scopeStack.splice(index, 1);
            closedScope = true;
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
        // Only the openers actually on the line, so one named in a comment or a
        // string literal cannot open a scope. The label itself is still read from
        // the raw line, since its range has to point at real columns.
        for (const open of openersOnLine.filter(directive => directive in SCOPE_OPENERS)) {
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
                    // A .function parameter may carry a `: type` and an `= default`,
                    // and a default may itself contain commas.
                    const params = splitTopLevel(paramsStr)
                        .map(parameterName)
                        .filter((name): name is string => name !== null)
                        .map(name => normalizeName(name));
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
                // A line opens at most one scope, and this was it.
                break;
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
                kind: 'code',
                comment: getBlockComment(lines, lineNum)
            });
            continue;
        }

        // Code label followed by opcode (also a local scope boundary)
        // Separated by whitespace or a colon: "LOOP: INX", "LOOP:INX", "LOOP INX".
        // Deliberately still anchored at column 0 with no indent group: an indented
        // "<opcode> <opcode>" line (e.g. "  jsr rts") would otherwise be read as a
        // label followed by an opcode.
        const codeLabelOpcodeMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)(?:\s*:\s*|\s+)([a-zA-Z]{3})\b/);
        if (codeLabelOpcodeMatch && opcodes.has(codeLabelOpcodeMatch[2].toLowerCase())) {
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
                kind: 'code',
                comment: getBlockComment(lines, lineNum)
            });
            continue;
        }

        // Loop variables of a `.for` / `.bfor`. Two forms, both verified:
        //   .for i = 0, i < 13, i = i + 1   - exactly one variable
        //   .for a, b in [1,2], [3,4]       - a comma-separated list
        // Recorded as re-assignable 'var's: the assembler keeps them defined after
        // .next and lets a later loop reuse the name, so they must not trip the
        // duplicate check. .while/.rept take no variable and are not matched here.
        // The loop may itself be labelled ("squarelo .for i = 0, ..."), in which case
        // that label is a data label for the emitted bytes and is recorded too. The
        // label may also be anonymous ("-  .for i in ..."), which is left for the
        // anonymous-label branch further down to record.
        const forVarMatch = line.match(
            /^(\s*)((?:[+-]+|[a-zA-Z_][a-zA-Z0-9_]*)(?:\s*:\s*|\s+))?(\.b?for\s+)(.*)$/i
        );
        if (forVarMatch) {
            const indent = forVarMatch[1].length;
            const loopLabel = forVarMatch[2];
            const rest = forVarMatch[4];
            const restStart = indent + (loopLabel?.length ?? 0) + forVarMatch[3].length;

            // Variable names, with their offsets within `rest` so each gets its own
            // range. The `in` list must stop at ` in `, not run past it.
            const loopVars: { name: string; offset: number }[] = [];
            const assignForm = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
            const inForm = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)\s+in\s/i);
            if (assignForm) {
                loopVars.push({ name: assignForm[1], offset: 0 });
            } else if (inForm) {
                let cursor = 0;
                for (const part of inForm[1].split(',')) {
                    const name = part.trim();
                    const offset = inForm[1].indexOf(name, cursor);
                    loopVars.push({ name, offset });
                    cursor = offset + name.length;
                }
            }

            const anonymousPrefix = !!loopLabel && /^[+-]/.test(loopLabel);

            if (loopVars.length > 0) {
                // Optional named label in front of the loop, e.g. "squarelo .for ..."
                if (loopLabel && !anonymousPrefix) {
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
                        kind: 'data',
                        comment: getBlockComment(lines, lineNum)
                    });
                }

                for (const { name, offset } of loopVars) {
                    const startChar = restStart + offset;
                    const isLocal = name.startsWith('_');
                    labels.push({
                        name: normalizeName(name),
                        originalName: name,
                        uri: document.uri,
                        range: Range.create(
                            Position.create(lineNum, startChar),
                            Position.create(lineNum, startChar + name.length)
                        ),
                        scopePath: getCurrentScopePath(),
                        localScope: isLocal ? currentLocalScope : null,
                        isLocal,
                        kind: 'var',
                        comment: getBlockComment(lines, lineNum)
                    });
                }
                // An anonymous label on this line still has to be registered, so
                // fall through to that branch rather than ending the line here.
                if (!anonymousPrefix) continue;
            }
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
                value: value || undefined,
                comment: getBlockComment(lines, lineNum)
            });
            continue;
        }

        // Local symbol: starts with underscore. The operator decides what it is:
        //   _v = 1     a constant
        //   _v := 1    a re-assignable variable, so exempt from the duplicate check
        //   _v ..= [1] a compound assignment - a modification of an existing
        //              variable, not a definition, so it is left as a reference
        // 64tass has ..= += -= *= /= &= |= ^= <<= >>= %= **= (all verified).
        const localMatch = line.match(/^(\s*)(_[a-zA-Z0-9_]*)\s*(\.\.=|\*\*=|<<=|>>=|[-+*/&|^%]=|:=|=|:|\s|;|$)/);
        if (localMatch) {
            const labelName = localMatch[2];
            const startChar = localMatch[1].length;
            const operator = localMatch[3];

            if (COMPOUND_ASSIGNMENT.test(operator)) {
                continue;   // modifies the variable defined elsewhere
            }

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
                kind: operator === ':=' ? 'var' : 'const',
                comment: getBlockComment(lines, lineNum)
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
                // Create a separate label for each + or - symbol. No documentation
                // comment: these are never hovered or completed by name.
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
                kind: 'data',
                comment: getBlockComment(lines, lineNum)
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
                kind: 'data',
                comment: getBlockComment(lines, lineNum)
            });
            structInstances.set(normalizeName(labelName), structName);
            continue;
        }

        // Labels defined via macro calls: "label .macro_name args" and the
        // equally valid "label #macro_name args" (verified). Such a label opens a
        // scope holding the macro's own labels, so `virt #drv` makes the macro's
        // `patchme` reachable as `virt.patchme` and not as bare `patchme` - which
        // is why the macro used is recorded here and resolved at query time.
        // Separated by whitespace or a colon: "label: .macro_name args", even "label:.macro_name"
        // Allow leading indentation, since sub-labels are conventionally indented inside a .proc/.block
        const macroLabelMatch = line.match(/^(\s*)([a-zA-Z][a-zA-Z0-9_]*)(?:\s*:\s*|\s+)([.#])([a-zA-Z_][a-zA-Z0-9_]*)\b/i);
        // "lda #COLORS" is an opcode with an immediate operand, not a label calling
        // a macro, so the '#' form has to rule the mnemonics out.
        const isImmediateOperand = macroLabelMatch?.[3] === '#'
            && opcodes.has(macroLabelMatch[2].toLowerCase());
        if (macroLabelMatch && !isImmediateOperand) {
            const labelName = macroLabelMatch[2];
            const startChar = macroLabelMatch[1].length;
            const macroCalled = normalizeName(macroLabelMatch[4]);
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
                    kind: 'data',
                    comment: getBlockComment(lines, lineNum)
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
                value: value || undefined,
                comment: getBlockComment(lines, lineNum)
            });

            // "PIC = mk(5)" where mk is a .function returning namespace(*) makes
            // the function's own labels reachable as PIC.BITMAP, and not as a bare
            // BITMAP (verified). Same shape as a label on a macro call, so the
            // callee is recorded the same way and resolved at query time - a call
            // to something that is not a scope simply resolves to nothing.
            const callMatch = value?.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
            if (callMatch) {
                labelDefinedByMacro.set(normalizeName(labelName), normalizeName(callMatch[1]));
            }

            // "COLORING = {.MAP: a, .CHAR: c}" makes the keys reachable as
            // COLORING.CHAR, and not as a bare CHAR (verified), so each key is
            // indexed as a member of the label being assigned. The line's comment
            // documents that assignment as a whole, so it is not copied onto every
            // key as well.
            const rawValue = constMatch[4] ?? '';
            const valueStart = constMatch[0].length - rawValue.length;
            const ownPath = getCurrentScopePath();
            const memberScope = ownPath ? `${ownPath}.${normalizeName(labelName)}` : normalizeName(labelName);
            for (const key of findDictKeys(rawValue)) {
                // +1 to point at the name rather than the leading dot
                const keyStart = valueStart + key.start + 1;
                labels.push({
                    name: normalizeName(key.name),
                    originalName: key.name,
                    uri: document.uri,
                    range: Range.create(
                        Position.create(lineNum, keyStart),
                        Position.create(lineNum, keyStart + key.name.length)
                    ),
                    scopePath: memberScope,
                    localScope: null,
                    isLocal: false,
                    kind: 'const'
                });
            }
            continue;
        }
    }

    const labelsByName = new Map<string, LabelDefinition[]>();
    for (const label of labels) {
        const existing = labelsByName.get(label.name);
        if (existing) existing.push(label);
        else labelsByName.set(label.name, [label]);
    }

    return { labels, labelsByName, scopeAtLine, parametersAtScope, macroSubLabels, labelDefinedByMacro, functionReturnScope, structInstances, includes, includeScopes, caseSensitive, cpu: effectiveCpu };
}
