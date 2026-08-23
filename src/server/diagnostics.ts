import {
    Range,
    Position,
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { LabelDefinition, DocumentIndex } from './types';
import {
    OPCODES,
    opcodesForCpu,
    registerModesForCpu,
    INDEX_REGISTERS,
    FOLDING_PAIRS,
    CLOSING_DIRECTIVES,
    OPENER_TO_CLOSERS,
    BUILTINS,
    BUILTIN_DIRECTIVES_PATTERN
} from './constants';
import { parseLineStructure, stripStrings, tokenizeExpression, findCommentBlockLines, stripDictKeys } from './utils';
import { findSymbolInfo, isParameter, findAnonymousLabel } from './symbols';
import { blockDirectivesOn } from './blocks';
import { findAddressingProblem } from './operands';
import { LABEL_REQUIRED_OPENERS } from './constants';
import { evaluateCondition, computeBranchPaths, areMutuallyExclusive } from './conditions';

/**
 * Lines that sit inside a conditional branch which provably cannot be taken.
 *
 * Only branches whose condition evaluates to a definite true/false are decided;
 * anything undecidable leaves every branch live, so this can suppress but never
 * invent. Used to skip undefined-symbol reporting in dead code, matching the
 * assembler, which never evaluates those branches at all.
 */
function findDeadLines(
    lines: string[],
    uri: string,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive: boolean
): Set<number> {
    const dead = new Set<number>();
    // taken: has some branch of this chain already been taken?
    // live: is the branch we are currently in possibly executable?
    const stack: { live: boolean; taken: boolean | null }[] = [];
    const isDead = () => stack.some(s => s.live === false);

    for (let i = 0; i < lines.length; i++) {
        const code = stripStrings(parseLineStructure(lines[i]).code);
        const open = code.match(/(?:^|\s)\.(if|ifeq|ifne|ifmi|ifpl)\b(.*)$/i);
        const elsif = code.match(/(?:^|\s)\.(elsif|elif)\b(.*)$/i);
        const isElse = /(?:^|\s)\.else\b/i.test(code);
        const isEnd = /(?:^|\s)\.(endif|fi)\b/i.test(code);

        if (isEnd) {
            stack.pop();
            continue;
        }

        if (open) {
            // Only plain .if conditions are evaluated; .ifeq/.ifne/... compare against
            // the program counter era and are left undecided.
            const cond = open[1].toLowerCase() === 'if'
                ? evaluateCondition(open[2].trim(), uri, i, documentIndex, caseSensitive)
                : null;
            stack.push({ live: cond === null ? true : cond, taken: cond });
            continue;
        }

        if (elsif && stack.length > 0) {
            const frame = stack[stack.length - 1];
            if (frame.taken === true) {
                frame.live = false; // an earlier branch already ran
            } else if (frame.taken === false) {
                const cond = evaluateCondition(elsif[2].trim(), uri, i, documentIndex, caseSensitive);
                frame.live = cond === null ? true : cond;
                if (cond === true) frame.taken = true;
                else if (cond !== null) frame.taken = false;
            } else {
                frame.live = true; // previous branch undecided, so this one is too
            }
            continue;
        }

        if (isElse && stack.length > 0) {
            const frame = stack[stack.length - 1];
            frame.live = frame.taken === null ? true : !frame.taken;
            continue;
        }

        if (isDead()) dead.add(i);
    }

    return dead;
}

/**
 * Where an assignment's value should be, when there is none the assembler can
 * use - it is missing entirely, or another `=` follows.
 *
 * `CODE_= = $35` is the shape that matters: the author wanted a symbol called
 * `CODE_=`, but the name ends at `CODE_` and what is left reads as an assignment
 * with no expression. Verified: `foo =`, `foo = = 5` and `a == 1` are all
 * rejected with "an expression is expected".
 *
 * @returns the column the value should start at, or null if the line is fine
 */
function findMissingValue(code: string): number | null {
    const assignment = code.match(/^(\s*)([^\s;=]+)\s*:?=/);
    if (!assignment) return null;

    const valueStart = assignment[0].length;
    const value = code.slice(valueStart).trim();
    if (value !== '' && !value.startsWith('=')) return null;
    return valueStart + (code.slice(valueStart).length - code.slice(valueStart).trimStart().length);
}

/**
 * The first character of a definition's name that 64tass will not accept.
 *
 * The manual is explicit: "Regular symbol names are starting with a letter and
 * containing letters, numbers and underscores", and local names differ only in
 * beginning with an underscore. Anything else ends the name, so `CODE_£ = $30`
 * defines `CODE_` and then fails on the rest with "general syntax" - and ten such
 * lines in a row all redefine `CODE_`, which is how this surfaces in practice.
 *
 * Non-ASCII LETTERS are deliberately accepted: the manual allows them under the
 * `-a` flag, which this extension cannot see. Being lenient there costs a missed
 * error on a build without `-a`; being strict would report perfectly good code on
 * a build with it. `£` and `↑` are not letters, so they are still caught.
 *
 * @returns the offending character and its column, or null if the line is fine
 */
function findInvalidSymbolChar(code: string): { character: string; column: number } | null {
    // Only assignment lines: "name = value" / "name := value". The name is
    // everything before the '=', which is where an illegal character shows up.
    const definition = code.match(/^(\s*)([^\s;=]+)\s*:?=(?!=)/);
    if (!definition) return null;

    const [, indent, name] = definition;
    // A line that does not begin like a symbol is not a definition at all - `*`
    // is the program counter, and an operator here means an expression.
    if (!/^[\p{L}_]/u.test(name)) return null;
    if (/^[\p{L}_][\p{L}0-9_]*(\.[\p{L}_][\p{L}0-9_]*)*$/u.test(name)) return null;

    // Report the first character that cannot be part of the name.
    const offending = [...name].find(char => !/^[\p{L}0-9_.]$/u.test(char));
    if (offending === undefined) return null;
    return { character: offending, column: indent.length + name.indexOf(offending) };
}

/** Where a colliding definition is, named relative to the file being checked. */
function describeLocation(label: LabelDefinition, fromUri: string): string {
    const line = label.range.start.line + 1;
    if (label.uri === fromUri) return `also defined on line ${line}`;
    let name = label.uri;
    try { name = path.basename(fileURLToPath(label.uri)); } catch { /* not a file URI */ }
    return `also defined in ${name} on line ${line}`;
}

/**
 * A mnemonic the assembler knows on SOME target but not on this one - the case
 * 64tass reports as a bare "general syntax" error, because it reads the word as
 * a label and then chokes on what follows.
 *
 * Which is also why the operand decides: on a 6502 a lone `phx` is a perfectly
 * good label definition (verified), `bra nop` is a label plus an instruction, and
 * `bra = 5` is an assignment. Only `bra lbl` - a word that cannot be a label
 * because something follows it that is not an instruction, a directive or an
 * assignment - is an error. After a leading label the slot must be an instruction,
 * so `loop bra` errors with nothing following at all.
 *
 * Returns the offending token and its column, or null.
 */
function findUnsupportedMnemonic(
    code: string,
    cpuOpcodes: ReadonlySet<string>
): { name: string; column: number } | null {
    const tokens = code.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)(:?)(\s+(\S+))?/);
    if (!tokens) return null;
    const [, indent, first, colon, , second] = tokens;
    const unsupported = (word: string) =>
        OPCODES.has(word.toLowerCase()) && !cpuOpcodes.has(word.toLowerCase());

    // First token reads as an instruction only when nothing before it could be the
    // label. A colon settles it the other way: "bra:" is a label, whatever follows.
    if (!colon && unsupported(first)) {
        if (second === undefined) return null;                       // a lone label
        if (/^[.=]|^:=/.test(second)) return null;                   // directive or assignment
        if (cpuOpcodes.has(second.toLowerCase())) return null;        // label + instruction
        return { name: first, column: indent.length };
    }
    // A label came first, so the next token has to be the instruction.
    if (second !== undefined && !cpuOpcodes.has(first.toLowerCase()) && unsupported(second)) {
        return { name: second, column: code.indexOf(second, indent.length + first.length) };
    }
    return null;
}

export function validateDocument(
    document: TextDocument,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive = false
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split('\n');
    // The assembler ignores everything inside a `.comment` block, so nothing in
    // there is checked. The delimiting lines still are, so an unclosed one reports.
    const commentBlockLines = findCommentBlockLines(lines);
    const index = documentIndex.get(document.uri);

    if (!index) return diagnostics;

    // Opcodes and register modes depend on the CPU this document targets
    const opcodes = opcodesForCpu(index.cpu);
    const registerModes = registerModesForCpu(index.cpu);

    // Lines in .if branches the assembler provably never evaluates. Undefined-symbol
    // reporting is skipped for these, since the assembler does not resolve them either.
    const deadLines = findDeadLines(lines, document.uri, documentIndex, caseSensitive);

    // Check for duplicate labels (same name, same scopePath, same localScope)
    // All names are stored lowercase, so simple comparison works
    // Skip anonymous labels - they're allowed to have multiple instances
    //
    // Definitions in different branches of the same conditional chain are NOT
    // duplicates: the assembler assembles at most one branch, so they can never
    // both exist. That holds even when the condition cannot be decided statically,
    // which is why this uses branch paths rather than findDeadLines.
    const branchPaths = computeBranchPaths(lines);
    const seenLabels = new Map<string, LabelDefinition[]>();
    for (const label of index.labels) {
        // Anonymous labels can have multiple instances in the same scope
        if (label.isAnonymous) continue;
        // Re-assignable variables (.var / :=) are meant to be redefined
        if (label.kind === 'var') continue;

        // A definition the assembler never reaches cannot collide with anything,
        // nor be collided with - `.if 0` around one of two same-named labels is
        // the common case, and it is not a duplicate.
        if (deadLines.has(label.range.start.line)) continue;

        const key = `${label.scopePath ?? 'global'}:${label.localScope ?? 'none'}:${label.name}`;
        const priorDefinitions = seenLabels.get(key);

        if (priorDefinitions) {
            const path = branchPaths.get(label.range.start.line);
            const collided = priorDefinitions.find(prior =>
                !areMutuallyExclusive(path, branchPaths.get(prior.range.start.line)));

            if (collided) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: label.range,
                    message: `Duplicate label '${label.originalName}', ${describeLocation(collided, document.uri)}`,
                    source: '64tass',
                    // Rendered by the client as a link to the other definition.
                    relatedInformation: [{
                        location: { uri: collided.uri, range: collided.range },
                        message: 'first defined here'
                    }]
                });
            }
            priorDefinitions.push(label);
        } else {
            seenLabels.set(key, [label]);
        }
    }

    // Check for unclosed blocks and undefined symbols in a single pass
    const blockStack: { directive: string; line: number }[] = [];
    const symbolPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\b/g;
    const macroCallPattern = /\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        if (commentBlockLines.has(lineNum)) continue;
        const line = lines[lineNum];
        const { code } = parseLineStructure(line);
        // Blank out string contents before looking for block directives, so a
        // directive name inside a literal (.text "a .proc b") isn't counted as a
        // real one. stripStrings preserves offsets, so positions stay correct.
        const codeLower = stripStrings(code).toLowerCase();

        const missingValue = findMissingValue(code);
        if (missingValue !== null) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: Range.create(
                    Position.create(lineNum, missingValue),
                    Position.create(lineNum, Math.max(missingValue + 1, code.trimEnd().length))
                ),
                message: 'An expression is expected',
                source: '64tass',
                code: 'expression-expected'
            });
        }

        const badChar = findInvalidSymbolChar(code);
        if (badChar) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: Range.create(
                    Position.create(lineNum, badChar.column),
                    Position.create(lineNum, badChar.column + badChar.character.length)
                ),
                message: `'${badChar.character}' is not allowed in a symbol name`,
                source: '64tass',
                code: 'invalid-symbol-character'
            });
        }

        const { opened, closed } = blockDirectivesOn(line);
        for (const directive of opened) {
            blockStack.push({ directive, line: lineNum });

            // Some openers are rejected outright without a label: the assembler
            // answers "label required" (verified). `.block` and friends are fine.
            if (!LABEL_REQUIRED_OPENERS.includes(directive)) continue;
            // Safe: directive name from the static LABEL_REQUIRED_OPENERS list.
            const unnamed = code.match(new RegExp(`^(\\s*)\\${directive}\\b`, 'i'));
            if (unnamed) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(
                        Position.create(lineNum, unnamed[1].length),
                        Position.create(lineNum, unnamed[1].length + directive.length)
                    ),
                    message: `'${directive}' requires a label`,
                    source: '64tass',
                    code: 'label-required'
                });
            }
        }

        // A mnemonic this CPU does not have. Reported only when the target was
        // actually declared: on the default guess the real target may have come
        // from a command-line flag, and flagging `bra` in a 65c02 project that
        // never said so would be an error on correct code.
        if (index.cpuExplicit) {
            const unsupported = findUnsupportedMnemonic(code, opcodes);
            // A macro of that name makes the line a macro call, and legal (verified).
            if (unsupported && !findSymbolInfo(unsupported.name, document.uri, lineNum, documentIndex, caseSensitive)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(
                        Position.create(lineNum, unsupported.column),
                        Position.create(lineNum, unsupported.column + unsupported.name.length)
                    ),
                    message: `'${unsupported.name}' is not a ${index.cpu} instruction`,
                    source: '64tass',
                    code: 'unsupported-mnemonic'
                });
            }
        }

        // Check for closing directives
        for (const close of closed) {
            const openers = CLOSING_DIRECTIVES[close];
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

        // Symbol validation - skip empty lines and label definitions
        if (code.trim() === '') continue;

        // Scope openers only introduce a name (and parameter names), nothing to check
        if (/^[a-zA-Z_][a-zA-Z0-9_]*\s*:?\s*\.(macro|function|proc|block|struct|union)\b/i.test(code)) continue;

        // A leading label definition names a symbol rather than referencing one, but
        // the REST of the line still references symbols: both "loop: lda undef" and
        // "foo = undef + 1" need checking. Blank out just the defined name and its
        // ":" / "=" / ":=", keeping the line length so reported columns stay right.
        const defPrefix = code.match(/^(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*(?::=|=|:))/);
        const assignmentRhs = defPrefix && /[:=]=?$/.test(defPrefix[1]) && defPrefix[1].trimEnd().endsWith('=');
        // Dict-literal keys are blanked too: "{.MAP: 1}" names a key, not a macro.
        const codeForRefs = stripDictKeys(defPrefix
            ? ' '.repeat(defPrefix[1].length) + code.slice(defPrefix[1].length)
            : code);

        // Nothing after the definition (e.g. a bare "loop:") - nothing to validate
        if (codeForRefs.trim() === '') continue;

        // Check macro calls like .macroname
        // Scan with string contents blanked out (positions preserved) so tag-like
        // text inside a string literal - e.g. .ptext "{grn} .kOd. .gfx."- isn't
        // mistaken for a macro call.
        const codeNoStrings = stripStrings(codeForRefs);
        let match;
        macroCallPattern.lastIndex = 0;
        while ((match = macroCallPattern.exec(codeNoStrings)) !== null) {
            const macroName = match[1];
            const fullMatch = match[0];
            const startCol = match.index;

            // Skip if this is part of a dotted reference (e.g., tbl.lo - the .lo is not a macro call)
            if (startCol > 0 && /[a-zA-Z0-9_]/.test(codeNoStrings[startCol - 1])) {
                continue;
            }

            // Skip built-in directives
            const directive = '.' + macroName.toLowerCase();
            const isBuiltinDirective = Object.keys(OPENER_TO_CLOSERS).includes(directive) ||
                Object.keys(CLOSING_DIRECTIVES).includes(directive) ||
                BUILTIN_DIRECTIVES_PATTERN.test(directive);

            if (!isBuiltinDirective) {
                // Try to find the macro definition
                const symbol = findSymbolInfo(fullMatch, document.uri, lineNum, documentIndex, caseSensitive);
                if (!symbol) {
                    // Point at the name, not the leading dot, so the range matches
                    // the name the message quotes - and matches where 64tass points.
                    const nameCol = startCol + (fullMatch.startsWith('.') ? 1 : 0);
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: Range.create(
                            Position.create(lineNum, nameCol),
                            Position.create(lineNum, nameCol + macroName.length)
                        ),
                        message: `Undefined macro '${macroName}'`,
                        source: '64tass',
                        code: 'undefined-macro'
                    });
                }
            }
        }

        // Check regular symbol references (after opcodes or data directives).
        // Uses codeForRefs so a "label:" prefix no longer hides the rest of the line.
        // Look for symbols after opcodes
        const opcodeMatch = codeForRefs.match(/^\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\s+)?([a-zA-Z]{3})\s+(.+)$/i);
        // Look for symbols after data directives like .text, .byte, .word, etc.
        const dataDirectiveMatch = codeForRefs.match(/^\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\s+)?\.(byte|word|long|dword|addr|rta|text|ptext|null|fill|char|dint|lint|sint)\s+(.+)$/i);

        let operand: string | null = null;
        let operandStart = 0;

        // Both patterns are anchored and end with (.+)$, so the operand is the tail
        // of the match - deriving its offset that way is exact, where indexOf(operand)
        // could in principle find an earlier occurrence of the same text.
        // OPCODES, not this CPU's set: a mnemonic the target does not have still
        // takes an operand whose symbols are worth checking. Gating on the narrow
        // set meant one missing mnemonic silently disabled symbol validation for
        // its whole line - and the target is only a guess unless it was declared.
        if (opcodeMatch && OPCODES.has(opcodeMatch[1].toLowerCase())) {
            operand = opcodeMatch[2];
            operandStart = opcodeMatch[0].length - operand.length;

            // Does that operand have an addressing mode at all? `lda ($10),x` and
            // `ldx $10,x` are errors the probed table already knows about.
            const problem = findAddressingProblem(index.cpu, opcodeMatch[1], operand);
            // A form no target accepts is wrong whatever the real CPU is; one that
            // exists elsewhere is only reportable once the target was declared.
            if (problem && (problem.universal || index.cpuExplicit)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(
                        Position.create(lineNum, operandStart),
                        Position.create(lineNum, operandStart + operand.trimEnd().length)
                    ),
                    message: problem.message,
                    source: '64tass',
                    code: 'no-addressing-mode'
                });
            }
        } else if (dataDirectiveMatch) {
            operand = dataDirectiveMatch[2];
            operandStart = dataDirectiveMatch[0].length - operand.length;
        } else if (assignmentRhs) {
            // "foo = undef + 1": the right-hand side is an expression whose symbols
            // should be checked, but there is no opcode or directive to anchor on.
            const rhs = codeForRefs.replace(/\s+$/, '');
            const from = rhs.length - rhs.trimStart().length;
            if (rhs.trim() !== '') {
                operand = rhs.slice(from);
                operandStart = from;
            }
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
                const anonRefPattern = /([+-]+)/g;
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
                if (BUILTINS.has(symLower) || opcodes.has(symLower)) continue;
                // Skip numbers (might be caught as identifiers if they have letters like in hex)
                if (/^[0-9]/.test(symName)) continue;
                // Skip hex numbers like $FE - if preceded by $ and only contains hex digits
                if (match.index > 0 && operandNoStrings[match.index - 1] === '$' && /^[0-9A-Fa-f]+$/.test(symName)) continue;

                // Register operands are instructions, not symbol references: "ldx s"
                // is TSX and "asl a" is accumulator-mode ASL. Two forms:
                //   - the whole operand is a register this opcode accepts ("lda x")
                //   - an index register or addressing suffix after a comma ("tbl,x", "$01,s")
                if (opcodeMatch) {
                    const mnemonic = opcodeMatch[1].toLowerCase();
                    const register = symName.toLowerCase();
                    const isWholeOperand = operand.trim().toLowerCase() === register;
                    if (isWholeOperand && registerModes[mnemonic]?.includes(register)) continue;

                    const before = operandNoStrings.slice(0, match.index).trimEnd();
                    if (before.endsWith(',') && INDEX_REGISTERS.has(register)) continue;
                }
                // Skip if it's a parameter in the current scope
                if (isParameter(symName, currentScopePath, index, caseSensitive)) continue;

                // For dotted references like param.lo or label.hi
                if (symName.includes('.')) {
                    const parts = symName.split('.');
                    const parentName = parts[0];
                    const parentNameNormalized = caseSensitive ? parentName : parentName.toLowerCase();
                    const subLabelName = parts[parts.length - 1];
                    const subLabelNormalized = caseSensitive ? subLabelName : subLabelName.toLowerCase();

                    // If parent is a parameter, skip (we can't validate runtime values)
                    if (isParameter(parentName, currentScopePath, index, caseSensitive)) continue;

                    // Check if parent label was defined via a macro that creates this
                    // sub-label. The map is keyed by full path, so the enclosing
                    // scope is tried before the bare name.
                    const macroUsed = (currentScopePath
                        ? index.labelDefinedByMacro.get(`${currentScopePath}.${parentNameNormalized}`)
                        : undefined) ?? index.labelDefinedByMacro.get(parentNameNormalized);
                    if (macroUsed) {
                        const macroLabels = index.macroSubLabels.get(macroUsed);
                        if (macroLabels && macroLabels.includes(subLabelNormalized)) {
                            continue; // Valid sub-label from macro
                        }
                    }
                }

                const symbol = findSymbolInfo(symName, document.uri, lineNum, documentIndex, caseSensitive);
                if (!symbol && !deadLines.has(lineNum)) {
                    const startCol = operandStart + match.index;
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: Range.create(
                            Position.create(lineNum, startCol),
                            Position.create(lineNum, startCol + symName.length)
                        ),
                        message: `Undefined symbol '${symName}'`,
                        source: '64tass',
                        code: 'undefined-symbol'
                    });
                }
            }
        }
    }

    // Check for unclosed blocks after processing all lines.
    // .logical used to be exempted here, which silenced a real error: the assembler
    // rejects an unclosed .logical with "closing directive '.endlogical' not found".
    // The actual cause was that .here was not registered as one of its closers.
    for (const unclosed of blockStack) {
        const closeDirective = FOLDING_PAIRS[unclosed.directive];
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(
                Position.create(unclosed.line, 0),
                Position.create(unclosed.line, lines[unclosed.line].length)
            ),
            message: `Unclosed '${unclosed.directive}' - missing '${closeDirective}'`,
            source: '64tass',
            code: 'unclosed-block',
            // The closer to insert, so the quick fix does not have to re-derive it
            // from the message text.
            data: { closeDirective, openLine: unclosed.line }
        });
    }

    return diagnostics;
}
