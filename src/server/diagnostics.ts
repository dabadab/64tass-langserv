import {
    Range,
    Position,
    Diagnostic,
    DiagnosticSeverity,
    DiagnosticTag
} from 'vscode-languageserver/node';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { LabelDefinition, DocumentIndex } from './types';
import {
    OPCODES,
    ALL_DIRECTIVE_SET,
    DATA_DIRECTIVES,
    EXPRESSION_DIRECTIVES,
    opcodesForCpu,
    registerModesForCpu,
    INDEX_REGISTERS,
    FOLDING_PAIRS,
    CLOSING_DIRECTIVES,
    OPENER_TO_CLOSERS,
    BUILTINS,
    BUILTIN_DIRECTIVES_PATTERN
} from './constants';
import { parseLineStructure, stripStrings, tokenizeExpression, findCommentBlockLines, stripDictKeys, splitTopLevel, splitLines } from './utils';
import { findSymbolInfo, isParameter, findAnonymousLabel } from './symbols';
import { blockDirectivesOn } from './blocks';
import { addressExpressionOf, findAddressingProblem, immediateBytesFor } from './operands';
import { calleeScopePath } from './signatureHelp';
import { LABEL_REQUIRED_OPENERS } from './constants';
import { evaluateCondition, evaluateExpression, computeBranchPaths, areMutuallyExclusive, conditionalOn } from './conditions';

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
    caseSensitive: boolean,
    unit?: ReadonlySet<string>
): Set<number> {
    const dead = new Set<number>();
    // Prose inside a `.comment` block is not code: "disabled with .if 0" written
    // in one opened a chain that never closed, so the whole rest of the file was
    // marked dead and every diagnostic after it suppressed. The conservatism that
    // makes this scanner safe - it can suppress but never invent - only holds
    // while the lines it reads are code.
    const commentBlockLines = findCommentBlockLines(lines);
    // taken: has some branch of this chain already been taken?
    // live: is the branch we are currently in possibly executable?
    const stack: { live: boolean; taken: boolean | null }[] = [];
    const isDead = () => stack.some(s => s.live === false);

    for (let i = 0; i < lines.length; i++) {
        if (commentBlockLines.has(i)) continue;
        const code = stripStrings(parseLineStructure(lines[i]).code);
        // One classifier, shared with computeBranchPaths - see conditionalOn.
        const conditional = conditionalOn(code);
        const open = conditional?.kind === 'open' ? conditional : null;
        const elsif = conditional?.kind === 'elsif' ? conditional : null;
        const isElse = conditional?.kind === 'else';
        const isEnd = conditional?.kind === 'end';

        if (isEnd) {
            stack.pop();
            continue;
        }

        if (open) {
            // Only plain .if conditions are evaluated; .ifeq/.ifne/... compare against
            // the program counter era and are left undecided.
            const cond = open.directive === 'if'
                ? evaluateCondition(open.condition.trim(), uri, i, documentIndex, caseSensitive, unit)
                : null;
            stack.push({ live: cond === null ? true : cond, taken: cond });
            continue;
        }

        if (elsif && stack.length > 0) {
            const frame = stack[stack.length - 1];
            if (frame.taken === true) {
                frame.live = false; // an earlier branch already ran
            } else if (frame.taken === false) {
                const cond = evaluateCondition(elsif.condition.trim(), uri, i, documentIndex, caseSensitive, unit);
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
 * An assignment line split into its parts.
 *
 * The name is matched as symbol characters, and any junk between it and the
 * operator separately - `CODE_£ = $30` is name `CODE_` plus `£`. Taking the name
 * as "everything before the `=`" swallowed the operator whenever nothing
 * separated the two, so `v+=1`, `v*=2` and `v:=5` were all reported as symbol
 * names containing an illegal character, while the assembler takes every one of
 * them (verified).
 */
function splitAssignment(code: string): { indent: string; name: string; valueStart: number } | null {
    // No `(?!=)` here: `a == 1` has to reach findMissingValue, which reports it
    // the way the assembler does ("an expression is expected").
    const match = code.match(/^(\s*)([\p{L}0-9_.]*)([^\s;=]*?)\s*((?:\.\.|\*\*|<<|>>|[-+*/&|^%])?:?=)/u);
    if (!match) return null;
    return { indent: match[1], name: match[2] + match[3], valueStart: match[0].length };
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
    const assignment = splitAssignment(code);
    if (!assignment) return null;

    const valueStart = assignment.valueStart;
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
    // Only assignment lines: "name = value" / "name := value".
    const definition = splitAssignment(code);
    if (!definition) return null;

    const { indent, name } = definition;
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

/**
 * A built-in name in the statement slot written in anything but lowercase, while
 * case sensitivity is on.
 *
 * `-C` makes the assembler match instruction and directive names exactly, and
 * nothing else is spelled with capitals: `LDA #1` is "wrong type", `.BYTE 1` is
 * "not defined symbol 'BYTE'", and so are `asl A` and `lda $10,X` (all verified).
 * 64tass reads the name as a symbol instead, which is why no other check here
 * has anything to say about such a line.
 *
 * The statement slot only. A capitalised name elsewhere is an ordinary symbol -
 * `LDA = 5` and `LDA:` both assemble under `-C`, and a project may well have a
 * label of that name.
 *
 * Returns the offending token and its column, or null.
 */
function findMiscasedBuiltin(code: string): { name: string; column: number } | null {
    const tokens = code.match(/^(\s*)(\.?[a-zA-Z_][a-zA-Z0-9_]*)(:?)(\s*(\S+))?/);
    if (!tokens) return null;
    const [, indent, first, colon, , second] = tokens;
    const miscased = (word: string) => word !== word.toLowerCase() && (word.startsWith('.')
        ? ALL_DIRECTIVE_SET.has(word.slice(1).toLowerCase())
        : OPCODES.has(word.toLowerCase()));
    const spelledOut = (word: string) => word === word.toLowerCase() && (word.startsWith('.')
        ? ALL_DIRECTIVE_SET.has(word.slice(1))
        : OPCODES.has(word));

    if (!colon && miscased(first)) {
        // A dotted name is never a label, so `.BYTE` alone is already an error.
        // A mnemonic spelled with capitals is one: a lone `RTS` defines RTS and
        // assembles, and so do `LDA = 5` and `LDA .byte 1` (all verified). It is
        // the line that goes on as an instruction which cannot work.
        if (first.startsWith('.')) return { name: first, column: indent.length };
        if (second === undefined) return null;
        if (/^[.=]|^:=/.test(second)) return null;
        return { name: first, column: indent.length };
    }
    // A label came first, so the next token is the statement.
    if (second !== undefined && !spelledOut(first) && miscased(second)) {
        return { name: second, column: code.indexOf(second, indent.length + first.length) };
    }
    return null;
}

/**
 * An immediate whose value cannot fit the operand byte: `lda #$1234`.
 *
 * Only literal-valued expressions get here - a code label has no address the
 * index knows, so `lda #target` stays undecided rather than guessed at. The
 * accepted range is what the assembler accepts (verified): `lda #-1` is fine and
 * `lda #-129` is not, so it spans the signed and unsigned readings of the byte.
 */
export function findOversizedImmediate(
    cpu: string,
    mnemonic: string,
    operand: string,
    uri: string,
    line: number,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive: boolean,
    unit?: ReadonlySet<string>
): string | null {
    const text = operand.trim();
    if (!text.startsWith('#')) return null;
    const bytes = immediateBytesFor(cpu, mnemonic);
    if (bytes === null || bytes < 1) return null;

    const expression = text.slice(1).trim();
    // `<` `>` `^` take a byte OUT of a wider value, so those never overflow.
    if (/^[<>^`]/.test(expression)) return null;

    const value = evaluateExpression(expression, uri, line, documentIndex, caseSensitive, unit);
    if (value === null || !Number.isInteger(value)) return null;

    const bits = bytes * 8;
    if (value <= (2 ** bits) - 1 && value >= -(2 ** (bits - 1))) return null;
    return `${value} does not fit in ${bits} bits`;
}

/** Every file this one pulls in, directly or through another include. */
function includeTree(index: DocumentIndex, documentIndex: Map<string, DocumentIndex>): DocumentIndex[] {
    const seen = new Set<string>();
    const found: DocumentIndex[] = [];
    const queue = [...index.includes];
    while (queue.length > 0) {
        const uri = queue.shift()!;
        if (seen.has(uri)) continue;
        seen.add(uri);
        const included = documentIndex.get(uri);
        if (!included) continue;
        found.push(included);
        queue.push(...included.includes);
    }
    return found;
}

/**
 * Labels defined both in this document and in something it includes.
 *
 * Reported against the including file, which is where the collision becomes real -
 * the include on its own is fine. Two labels in two SIBLING includes also collide
 * for the assembler, but neither definition is in the file being validated, so
 * they are deliberately not reported here.
 */
function crossFileDuplicates(
    index: DocumentIndex,
    documentIndex: Map<string, DocumentIndex>,
    deadLines: ReadonlySet<number>,
    getText?: (uri: string) => string | null
): [LabelDefinition, LabelDefinition][] {
    const found: [LabelDefinition, LabelDefinition][] = [];
    const included = includeTree(index, documentIndex);
    if (included.length === 0) return found;

    // Dead branches on the other side too, computed once per file and only when a
    // candidate collision actually turns up in it.
    const deadElsewhere = new Map<string, ReadonlySet<number>>();
    const deadIn = (other: DocumentIndex, uri: string): ReadonlySet<number> => {
        let lines = deadElsewhere.get(uri);
        if (lines === undefined) {
            const text = getText?.(uri) ?? null;
            lines = text === null
                ? new Set<number>()
                : findDeadLines(splitLines(text), uri, documentIndex, other.caseSensitive);
            deadElsewhere.set(uri, lines);
        }
        return lines;
    };

    for (const label of index.labels) {
        if (label.isAnonymous || label.kind === 'var') continue;
        if (deadLines.has(label.range.start.line)) continue;

        for (const other of included) {
            for (const candidate of other.labelsByName.get(label.name) ?? []) {
                if (candidate.kind === 'var' || candidate.isAnonymous) continue;
                if ((candidate.scopePath ?? null) !== (label.scopePath ?? null)) continue;
                if ((candidate.localScope ?? null) !== (label.localScope ?? null)) continue;
                if (deadIn(other, candidate.uri).has(candidate.range.start.line)) continue;
                found.push([label, candidate]);
                break;
            }
        }
    }
    return found;
}

/**
 * A directive whose operand carries symbol references (`OPERAND_DIRECTIVES`),
 * with an optional label in front. Only 15 data directives used to be listed
 * here, so a typo in `.if`, `.for`, `.align` or `.check` went unreported while
 * the assembler resolves - and fails on - every one of them.
 */
const withOperand = (names: readonly string[]) => new RegExp(
    `^\\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\\s+)?\\.(${names.join('|')})\\s+(.+)$`, 'i');

const DATA_OPERAND = withOperand(DATA_DIRECTIVES);
const EXPRESSION_OPERAND = withOperand(EXPRESSION_DIRECTIVES);

/** Line numbers grouped into [first, last] runs of consecutive lines. */
function contiguousRuns(lines: ReadonlySet<number>): [number, number][] {
    const sorted = [...lines].sort((a, b) => a - b);
    const runs: [number, number][] = [];
    for (const line of sorted) {
        const last = runs[runs.length - 1];
        if (last && line === last[1] + 1) last[1] = line;
        else runs.push([line, line]);
    }
    return runs;
}

export interface ValidateOptions {
    /**
     * Reads another document's text. Lets the cross-file duplicate check see
     * whether the OTHER definition sits in a branch that is never assembled;
     * without it that check still runs, just without that filter.
     */
    getText?: (uri: string) => string | null;
    /**
     * Documents assembled together with this one. Symbol resolution is restricted
     * to them, so a name that only exists in an unrelated program is reported
     * undefined - which it is. Omitted means the include graph is not known to be
     * complete, and every document is searched instead.
     */
    unit?: ReadonlySet<string>;
}

/**
 * The arguments of a call, with the ones the callee never reads blanked out.
 *
 * 64tass works an argument out only where the body asks for it: passing an
 * undefined name to a parameter nothing reads is no error (verified, for a
 * `.macro` and a `.function` alike), and neither is passing one to a macro that
 * takes its arguments positionally as `\1`. Blanking keeps every column right,
 * the same trick stripStrings uses, so what survives can go through the ordinary
 * symbol scan.
 *
 * Null when the line is not a call this can account for.
 */
function callArguments(
    code: string,
    uri: string,
    lineNum: number,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive: boolean,
    unit?: ReadonlySet<string>
): { text: string; start: number } | null {
    // `#name args` / `.name args`, or a bare `name args` - all four call forms
    // assemble for either kind (verified). A leading label is allowed on the
    // prefixed forms only; bare, the first word IS the callee.
    const call = code.match(/^(\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\s*:?\s+)?[#.]([a-zA-Z_][a-zA-Z0-9_]*)\s+)(\S[\s\S]*)$/)
        ?? code.match(/^(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+)(\S[\s\S]*)$/);
    if (!call) return null;

    const callee = findSymbolInfo(call[2], uri, lineNum, documentIndex, caseSensitive, true, unit);
    if (!callee || (callee.kind !== 'macro' && callee.kind !== 'function')) return null;

    const path = calleeScopePath(callee);
    const definition = documentIndex.get(callee.uri);
    const parameters = definition?.parametersAtScope.get(path) ?? [];
    const used = new Set(definition?.usedParametersAtScope.get(path) ?? []);

    const kept: string[] = [];
    splitTopLevel(call[3]).forEach((argument, i) => {
        const evaluated = i < parameters.length && used.has(parameters[i]);
        kept.push(evaluated ? argument : ' '.repeat(argument.length));
    });
    // splitTopLevel drops the commas; they are separators, never symbols.
    return { text: kept.join(' '), start: call[1].length };
}

/**
 * Names defined twice where both definitions can exist.
 *
 * Definitions in different branches of the same conditional chain are NOT
 * duplicates: the assembler assembles at most one branch, so they can never both
 * exist - which is why this uses BRANCH PATHS and not just `findDeadLines`, whose
 * answer for an undecidable condition is "both live". A definition inside a
 * branch that provably cannot be taken is not there at all, so it neither
 * collides nor is collided with, and that is what `deadLines` is for.
 */
function findDuplicateLabels(
    index: DocumentIndex,
    lines: string[],
    deadLines: ReadonlySet<number>,
    uri: string,
    documentIndex: Map<string, DocumentIndex>,
    getText?: (uri: string) => string | null
): Diagnostic[] {
    const found: Diagnostic[] = [];
    const report = (label: LabelDefinition, other: LabelDefinition) => found.push({
        severity: DiagnosticSeverity.Error,
        range: label.range,
        message: `Duplicate label '${label.originalName}', ${describeLocation(other, uri)}`,
        source: '64tass',
        // Rendered by the client as a link to the other definition.
        relatedInformation: [{
            location: { uri: other.uri, range: other.range },
            message: 'first defined here'
        }]
    });

    const branchPaths = computeBranchPaths(lines);
    const seen = new Map<string, LabelDefinition[]>();
    for (const label of index.labels) {
        // Anonymous labels can have several instances in one scope, and
        // re-assignable variables (`.var` / `:=`) are meant to be redefined.
        if (label.isAnonymous || label.kind === 'var') continue;
        if (deadLines.has(label.range.start.line)) continue;

        const key = `${label.scopePath ?? 'global'}:${label.localScope ?? 'none'}:${label.name}`;
        const prior = seen.get(key);
        if (!prior) {
            seen.set(key, [label]);
            continue;
        }

        const path = branchPaths.get(label.range.start.line);
        const collided = prior.find(other =>
            !areMutuallyExclusive(path, branchPaths.get(other.range.start.line)));
        if (collided) report(label, collided);
        prior.push(label);
    }

    // The same name defined here AND in a file this one includes: the assembler
    // rejects that, and the loop above cannot see it.
    for (const [label, other] of crossFileDuplicates(index, documentIndex, deadLines, getText)) {
        report(label, other);
    }
    return found;
}


/**
 * An anonymous reference (`+`, `--`, ...) the file has no label for.
 *
 * Anchored: such a reference IS the start of the operand. `#-1` and `table+1` are
 * arithmetic, which a letter or digit straight after settles, and a mixed run
 * (`+-`) is not a reference at all.
 */
function findAnonymousProblem(
    operand: string,
    operandStart: number,
    uri: string,
    lineNum: number,
    documentIndex: Map<string, DocumentIndex>
): Diagnostic[] {
    const match = operand.match(/^(\s*)([+-]+)/);
    if (!match) return [];

    const ref = match[2];
    const after = operand[match[0].length] ?? ' ';
    if (!ref.split('').every(c => c === ref[0]) || /[a-zA-Z0-9_]/.test(after)) return [];

    const direction = ref[0] as '+' | '-';
    if (findAnonymousLabel(direction, ref.length, uri, lineNum, documentIndex)) return [];

    const startCol = operandStart + match[1].length;
    return [{
        severity: DiagnosticSeverity.Warning,
        range: Range.create(
            Position.create(lineNum, startCol),
            Position.create(lineNum, startCol + ref.length)
        ),
        message: `No ${direction === '+' ? 'forward' : 'backward'} anonymous label found`,
        source: '64tass'
    }];
}


export function validateDocument(
    document: TextDocument,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive = false,
    options: ValidateOptions = {}
): Diagnostic[] {
    const { getText, unit } = options;
    const diagnostics: Diagnostic[] = [];
    const text = document.getText();
    const lines = splitLines(text);
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
    const deadLines = findDeadLines(lines, document.uri, documentIndex, caseSensitive, unit);

    // Grey out the branches the assembler provably never reaches. findDeadLines
    // only marks what it can decide - `.if 0`, a condition of resolved constants -
    // so this can never fade code that does assemble. Reported as contiguous
    // regions rather than per line, or a fifty-line branch would be fifty
    // diagnostics saying the same thing.
    for (const [first, last] of contiguousRuns(deadLines)) {
        diagnostics.push({
            severity: DiagnosticSeverity.Hint,
            range: Range.create(
                Position.create(first, 0),
                Position.create(last, lines[last]?.length ?? 0)
            ),
            message: 'Not assembled - this branch is never taken',
            source: '64tass',
            code: 'inactive-code',
            tags: [DiagnosticTag.Unnecessary],
        });
    }

    diagnostics.push(...findDuplicateLabels(index, lines, deadLines, document.uri, documentIndex, getText));

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

        // A built-in written with capitals while `-C` is in force: the assembler
        // reads it as a symbol and the line does not assemble (verified). Before
        // the mnemonic check below, which would otherwise call `BRA` unsupported
        // when the spelling is what is wrong.
        if (caseSensitive && !deadLines.has(lineNum)) {
            const miscased = findMiscasedBuiltin(code);
            if (miscased) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(
                        Position.create(lineNum, miscased.column),
                        Position.create(lineNum, miscased.column + miscased.name.length)
                    ),
                    message: `'${miscased.name}' is read as a symbol while case sensitivity is on; `
                        + `64tass only knows '${miscased.name.toLowerCase()}'`,
                    source: '64tass',
                    code: 'miscased-builtin'
                });
            }
        }

        // A mnemonic this CPU does not have, judged against the target in force -
        // declared, or the default when nothing said. A 65c02 project that never
        // declares itself is reported against the 6502i default and should say so
        // with a `.cpu` directive, a pragma or the setting.
        //
        // Nothing in a branch that cannot be taken is assembled, so the assembler
        // says nothing about it (verified: another CPU's mnemonic, an oversized
        // immediate and a shape with no addressing mode are all silent inside
        // `.if 0`) - and neither do the three checks that judge the machine code.
        if (!deadLines.has(lineNum)) {
            const unsupported = findUnsupportedMnemonic(code, opcodes);
            // A macro of that name makes the line a macro call, and legal (verified).
            if (unsupported && !findSymbolInfo(unsupported.name, document.uri, lineNum, documentIndex, caseSensitive, true, unit)) {
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
        // Dotted targets too (`outer.extra = ...`): the parser indexes those, and
        // without them here the whole line - definition and right-hand side alike -
        // was invisible to the reference scan.
        const defPrefix = code.match(/^(\s*[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*\s*(?::=|=|:))/);
        const assignmentRhs = defPrefix && /[:=]=?$/.test(defPrefix[1]) && defPrefix[1].trimEnd().endsWith('=');
        // Dict-literal keys are blanked too: "{.MAP: 1}" names a key, not a macro.
        // Trailing whitespace is dropped (columns are counted from the left, so
        // nothing moves): the opcode pattern below carries an optional label in
        // front of the mnemonic, and on `jsr foo  ` that alternative matched -
        // `foo` read as the mnemonic and a space as its operand - so the line's
        // symbols, its immediate and its addressing mode all went unchecked.
        const codeForRefs = stripDictKeys(defPrefix
            ? ' '.repeat(defPrefix[1].length) + code.slice(defPrefix[1].length)
            : code).trimEnd();

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
                const symbol = findSymbolInfo(fullMatch, document.uri, lineNum, documentIndex, caseSensitive, true, unit);
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

        // `#name` in the statement slot is a macro call as much as `.name` is, and
        // an undefined one is "not defined symbol 'name'" to the assembler
        // (verified). Only there: a `#` after a mnemonic marks an immediate
        // operand, whose symbols the reference scan below already checks - which
        // is why a leading word that is an opcode disqualifies the line, by the
        // same first-token rule the parser goes by.
        const hashCall = codeNoStrings.match(/^(\s*(?:([a-zA-Z_][a-zA-Z0-9_]*)\s*:?\s+)?)#([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (hashCall && !deadLines.has(lineNum) && !OPCODES.has((hashCall[2] ?? '').toLowerCase())) {
            const nameCol = hashCall[1].length + 1;
            if (!findSymbolInfo(hashCall[3], document.uri, lineNum, documentIndex, caseSensitive, true, unit)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: Range.create(
                        Position.create(lineNum, nameCol),
                        Position.create(lineNum, nameCol + hashCall[3].length)
                    ),
                    message: `Undefined macro '${hashCall[3]}'`,
                    source: '64tass',
                    code: 'undefined-macro'
                });
            }
        }

        // Check regular symbol references (after opcodes or data directives).
        // Uses codeForRefs so a "label:" prefix no longer hides the rest of the line.
        // Look for symbols after opcodes
        const opcodeMatch = codeForRefs.match(/^\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\s+)?([a-zA-Z]{3})\s+(.+)$/i);
        // Look for symbols after data directives like .text, .byte, .word, etc.
        const dataDirectiveMatch = codeForRefs.match(DATA_OPERAND);
        const expressionDirectiveMatch = codeForRefs.match(EXPRESSION_OPERAND);
        // `*= start+2` is an expression too, and the assembler resolves it.
        const programCounterMatch = codeForRefs.match(/^(\s*\*\s*=\s*)(\S.*)$/);

        const callArgs = callArguments(codeForRefs, document.uri, lineNum, documentIndex, caseSensitive, unit);

        let operand: string | null = null;
        let operandStart = 0;

        // Both patterns are anchored and end with (.+)$, so the operand is the tail
        // of the match - deriving its offset that way is exact, where indexOf(operand)
        // could in principle find an earlier occurrence of the same text.
        // OPCODES, not this CPU's set: a mnemonic the target does not have still
        // takes an operand whose symbols are worth checking. Gating on the narrow
        // set meant one missing mnemonic silently disabled symbol validation for
        // its whole line - and the target is only a guess unless it was declared.
        // The mnemonic has to be spelled as the assembler spells it. With `-C` in
        // force `LDA .byte 1` is a LABEL and a directive (verified), and reading
        // LDA as the instruction made `.byte 1` its operand - reported as two
        // values in a row on a line that assembles.
        const writtenAsOpcode = opcodeMatch
            && OPCODES.has(opcodeMatch[1].toLowerCase())
            && (!caseSensitive || opcodeMatch[1] === opcodeMatch[1].toLowerCase());
        if (opcodeMatch && writtenAsOpcode) {
            operand = opcodeMatch[2];
            operandStart = opcodeMatch[0].length - operand.length;

            // Does the immediate value fit the byte it is assembled into?
            const tooLarge = deadLines.has(lineNum) ? null : findOversizedImmediate(
                index.cpu, opcodeMatch[1], operand, document.uri, lineNum, documentIndex, caseSensitive, unit);
            if (tooLarge) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(
                        Position.create(lineNum, operandStart),
                        Position.create(lineNum, operandStart + operand.trimEnd().length)
                    ),
                    message: tooLarge,
                    source: '64tass',
                    code: 'immediate-too-large'
                });
            }

            // Does that operand have an addressing mode at all? `lda ($10),x` and
            // `ldx $10,x` are errors the probed table already knows about - and
            // where the address resolves, so is `sty $c000,x`, whose shape exists
            // only as a zeropage form.
            const address = addressExpressionOf(operand);
            const addressValue = address === null
                ? null
                : evaluateExpression(address, document.uri, lineNum, documentIndex, caseSensitive, unit);
            const problem = deadLines.has(lineNum)
                ? null
                : findAddressingProblem(index.cpu, opcodeMatch[1], operand, addressValue);
            // Judged against the target in force, declared or defaulted: a file
            // that never says which CPU it is for is taken at its default, since
            // staying silent there means saying nothing about most real sources.
            if (problem) {
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
        } else if (callArgs !== null) {
            // A macro or function call: its arguments are expressions in the
            // CALLER's scope, so they are checked like any other operand.
            operand = callArgs.text;
            operandStart = callArgs.start;
        } else if (expressionDirectiveMatch) {
            operand = expressionDirectiveMatch[2];
            operandStart = expressionDirectiveMatch[0].length - operand.length;
        } else if (programCounterMatch) {
            operand = programCounterMatch[2];
            operandStart = programCounterMatch[1].length;
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

            // Anonymous label references (+ / -), in an opcode operand only:
            // a data directive uses them as arithmetic.
            if (opcodeMatch) {
                diagnostics.push(...findAnonymousProblem(
                    operand, operandStart, document.uri, lineNum, documentIndex));
            }

            // Strip string literals to avoid matching symbols inside strings
            const operandNoStrings = stripStrings(operand);
            symbolPattern.lastIndex = 0;
            while ((match = symbolPattern.exec(operandNoStrings)) !== null) {
                const symName = match[1];
                const symLower = symName.toLowerCase();

                // Skip if it's a register, opcode, or builtin
                if (BUILTINS.has(symLower) || opcodes.has(symLower)) continue;
                // `in` is an operator - `1 in [1,2]`, and every `.for x in list`.
                // It is a legal symbol name too (verified), so skipping it can cost
                // at most a missed report on a symbol actually called `in`.
                if (symLower === 'in') continue;
                // `\name` and `\1` substitute a macro's argument as TEXT; the name
                // after the backslash is the parameter, not a symbol here.
                if (match.index > 0 && operandNoStrings[match.index - 1] === '\\') continue;
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

                const symbol = findSymbolInfo(symName, document.uri, lineNum, documentIndex, caseSensitive, true, unit);
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
