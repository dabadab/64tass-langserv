import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    CompletionItem,
    CompletionItemKind,
    Position,
    Range,
    TextEdit
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { DocumentIndex, LabelKind } from './types';
import { OPCODES, ALL_DIRECTIVES, NON_SYMBOL_ARG_DIRECTIVES, DEFAULT_CPU, opcodesForCpu } from './constants';
import { addressingModesFor } from './addressing';
import { collectVisibleLabels, collectVisibleParameters, collectScopeMembers } from './symbols';
import { parseLineStructure } from './utils';

// Label kinds that represent something addressable, i.e. valid as a bare opcode
// operand (branch/jump target, or the address a data label points at).
// Macros are invoked as ".name" and functions as "name(...)" - never referenced
// this way - and struct/union/namespace names aren't addresses either.
const OPERAND_KINDS = new Set<LabelKind>(['code', 'data', 'const', 'var', 'proc', 'block']);

// File extensions considered "source" for .include/.binclude completion.
// .binary can pull in any file (raw data), so it isn't filtered.
const SOURCE_EXTENSIONS = new Set(['.asm', '.s', '.inc', '.src']);

// Directives that take a quoted file path as their argument
const FILE_PATH_DIRECTIVES = /\.(include|binclude|binary)\s+"([^"]*)$/i;

/**
 * Suggest filenames/directories for the partial path inside a
 * `.include "..."` / `.binclude "..."` / `.binary "..."` string at the cursor.
 */
function getFilePathCompletions(
    document: TextDocument,
    position: Position,
    searchPaths: readonly string[]
): CompletionItem[] | null {
    const line = document.getText(Range.create(Position.create(position.line, 0), position));
    const match = line.match(FILE_PATH_DIRECTIVES);
    if (!match) return null;

    const directive = match[1].toLowerCase();
    const partialPath = match[2];
    const quoteStart = position.character - partialPath.length;

    const lastSlash = partialPath.lastIndexOf('/');
    const dirPart = lastSlash >= 0 ? partialPath.substring(0, lastSlash) : '';
    const filePrefix = lastSlash >= 0 ? partialPath.substring(lastSlash + 1) : partialPath;
    // Range covering just the filename segment being typed (after the last '/', if any)
    const editRange = Range.create(
        Position.create(position.line, quoteStart + (lastSlash >= 0 ? lastSlash + 1 : 0)),
        position
    );

    let currentDir: string;
    try {
        currentDir = path.dirname(fileURLToPath(document.uri));
    } catch {
        return [];
    }

    // Offer what an .include would actually find: the including file's own
    // directory first, then each -I search path, in resolveIncludePath's order.
    // Listing only the current directory hid every file reachable through the
    // `64tass.includePaths` setting, so a project keeping its headers in one
    // shared directory completed nothing.
    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    for (const dir of [currentDir, ...searchPaths]) {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(path.resolve(dir, dirPart), { withFileTypes: true });
        } catch {
            continue;   // A search path that does not exist just contributes nothing.
        }
        collectPathEntries(entries, filePrefix, directive, editRange, seen, items);
    }
    return items;
}

// The earlier directory wins on a name collision, since that is the one the
// assembler would resolve to.
function collectPathEntries(
    entries: fs.Dirent[],
    filePrefix: string,
    directive: string,
    editRange: Range,
    seen: Set<string>,
    items: CompletionItem[]
): void {
    for (const entry of entries) {
        if (!entry.name.toLowerCase().startsWith(filePrefix.toLowerCase())) continue;
        if (seen.has(entry.name.toLowerCase())) continue;
        seen.add(entry.name.toLowerCase());
        if (entry.isDirectory()) {
            items.push({
                label: entry.name + '/',
                kind: CompletionItemKind.Folder,
                textEdit: TextEdit.replace(editRange, entry.name + '/'),
                // Re-trigger completion immediately after inserting, to list the subfolder's contents
                command: { title: 'Trigger Suggest', command: 'editor.action.triggerSuggest' }
            });
        } else if (entry.isFile()) {
            if (directive !== 'binary' && !SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                continue;
            }
            items.push({
                label: entry.name,
                kind: CompletionItemKind.File,
                textEdit: TextEdit.replace(editRange, entry.name)
            });
        }
    }
}

/** Suggest directive names (`.proc`, `.include`, ...) when typing a `.`-prefixed word. */
function getDirectiveCompletions(prefixWithDot: string): CompletionItem[] {
    const prefix = prefixWithDot.slice(1).toLowerCase();
    return ALL_DIRECTIVES
        .filter(d => d.startsWith(prefix))
        .map(d => ({
            label: '.' + d,
            kind: CompletionItemKind.Keyword,
            insertText: d
        }));
}

/**
 * Suggest mnemonics for the CPU this file targets - NOT the union of every
 * target, which would offer a 65816 or 4510 instruction that will not assemble.
 */
function getOpcodeCompletions(prefix: string, cpu: string): CompletionItem[] {
    const lowerPrefix = prefix.toLowerCase();
    const items: CompletionItem[] = [];
    for (const op of opcodesForCpu(cpu)) {
        if (op.startsWith(lowerPrefix)) {
            items.push({ label: op, kind: CompletionItemKind.Keyword });
        }
    }
    return items;
}

/**
 * Where a comma sits in an operand. The three positions take different
 * registers, so they must not be lumped together:
 *   plain        `lda $1234,x`    - no brackets involved
 *   inside       `lda ($10,x)`    - within an unclosed bracket
 *   after-close  `lda ($10),y`    - after the bracket has closed
 */
export type CommaContext = 'plain' | 'inside' | 'after-close';

/**
 * The registers valid immediately after a comma in this mnemonic's operand.
 *
 * Read out of the addressing table rather than from a blanket list, so it is
 * exact per opcode, per CPU and per position: `ldx $10,` takes only Y, `inc $10,`
 * only X, `lda $10,` takes X or Y - plus S on the 65816 and Z on the
 * 4510/45GS02 - while `lda ($10),` takes only Y.
 *
 * Empty when the mnemonic has no such form at all: `jmp $1234,` and
 * `bbr 3,$10,` take an address there, and the caller falls back to symbols.
 */
export function indexRegistersFor(cpu: string, mnemonic: string, context: CommaContext): string[] {
    const registers = new Set<string>();
    for (const [pattern] of addressingModesFor(cpu, mnemonic)) {
        let depth = 0;
        let closed = false;
        for (let i = 0; i < pattern.length; i++) {
            const char = pattern[i];
            if (char === '(' || char === '[') {
                depth++;
            } else if (char === ')' || char === ']') {
                depth--;
                closed = true;
            } else if (char === ',') {
                const at: CommaContext = depth > 0 ? 'inside' : closed ? 'after-close' : 'plain';
                const register = pattern.slice(i + 1).match(/^\s*([a-z]+)/);
                if (register && at === context) registers.add(register[1]);
            }
        }
    }
    return [...registers].sort();
}

/**
 * Classify the comma the cursor sits after, ignoring brackets inside strings.
 */
function commaContextAt(text: string): CommaContext {
    let depth = 0;
    let closed = false;
    let quote: string | null = null;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quote) {
            if (char === quote) {
                if (text[i + 1] === quote) i++;
                else quote = null;
            }
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '(' || char === '[') {
            depth++;
        } else if (char === ')' || char === ']') {
            depth = Math.max(0, depth - 1);
            closed = true;
        }
    }
    return depth > 0 ? 'inside' : closed ? 'after-close' : 'plain';
}

/**
 * Suggest labels/symbols visible from this point in the document.
 * @param onlyOperandKinds - restrict to kinds valid as a bare opcode operand
 *   (excludes macro/function/struct/union/namespace names, which are never
 *   referenced as a plain address).
 */
function getSymbolCompletions(
    document: TextDocument,
    position: Position,
    documentIndex: Map<string, DocumentIndex>,
    onlyOperandKinds = false,
    visibleUris?: ReadonlySet<string>,
    prefix = ''
): CompletionItem[] {
    // "keyboard." asks for what is inside `keyboard`, not for what is in scope
    // here - offering the enclosing scope's symbols there is never useful, since
    // none of them can follow the dot.
    const lastDot = prefix.lastIndexOf('.');
    if (lastDot > 0) {
        const caseSensitive = documentIndex.get(document.uri)?.caseSensitive ?? false;
        const written = prefix.slice(0, lastDot);
        const scopePath = caseSensitive ? written : written.toLowerCase();
        return collectScopeMembers(scopePath, documentIndex, visibleUris)
            .filter(label => !onlyOperandKinds || OPERAND_KINDS.has(label.kind))
            .map(label => ({
                label: label.originalName,
                kind: label.kind === 'macro' || label.kind === 'function'
                    ? CompletionItemKind.Function
                    : CompletionItemKind.Field,
                detail: label.scopePath ?? undefined,
                documentation: label.comment
            }));
    }

    const labels = collectVisibleLabels(document.uri, position.line, documentIndex, visibleUris)
        .filter(label => !onlyOperandKinds || OPERAND_KINDS.has(label.kind));
    const items: CompletionItem[] = labels.map(label => ({
        label: label.originalName,
        kind: label.isLocal ? CompletionItemKind.Variable : CompletionItemKind.Field,
        detail: label.scopePath ?? undefined,
        documentation: label.comment
    }));

    // .function/.macro parameters - always valid as an operand (they stand in
    // for whatever value the caller passes), so no OPERAND_KINDS filtering.
    for (const param of collectVisibleParameters(document.uri, position.line, documentIndex)) {
        items.push({ label: param, kind: CompletionItemKind.Variable, detail: 'parameter' });
    }

    return items;
}

/**
 * Figure out what's typed immediately before the cursor: the identifier-like
 * prefix being completed, and the text on the line before that prefix started.
 */
function splitAtCursor(document: TextDocument, position: Position): { before: string; prefix: string } {
    const line = document.getText(Range.create(Position.create(position.line, 0), position));
    const prefixMatch = line.match(/[.\w]*$/);
    const prefix = prefixMatch ? prefixMatch[0] : '';
    return { before: line.slice(0, line.length - prefix.length), prefix };
}

export interface CompletionOptions {
    /**
     * Documents assembled together with this one. Symbols from anywhere else are
     * a different compilation unit and are not offered. Omitted means the whole
     * index, which is only right when the include graph is unknown.
     */
    visibleUris?: ReadonlySet<string>;

    /**
     * Absolute `-I` directories (`64tass.includePaths`), used only by path
     * completion so it offers the same files an `.include` could resolve.
     */
    searchPaths?: readonly string[];
}

export function getCompletions(
    document: TextDocument,
    position: Position,
    documentIndex: Map<string, DocumentIndex>,
    options: CompletionOptions = {}
): CompletionItem[] {
    const { visibleUris, searchPaths = [] } = options;
    // File-path completion takes priority: it fires from inside a quoted string,
    // a context none of the other modes should also try to complete in.
    const fileCompletions = getFilePathCompletions(document, position, searchPaths);
    if (fileCompletions !== null) return fileCompletions;

    const fullLine = document.getText(Range.create(
        Position.create(position.line, 0),
        Position.create(position.line + 1, 0)
    ));
    // Don't offer keyword/opcode/symbol completions inside comments or strings.
    // parseLineStructure, not indexOf: a ';' inside a string literal is not a
    // comment, and treating it as one killed completion for the rest of a line
    // like `msg .text "a;b"`. Same bug class as extractComment in utils.ts.
    const commentIdx = parseLineStructure(fullLine).commentStart;
    if (commentIdx >= 0 && commentIdx < position.character) return [];

    const { before, prefix } = splitAtCursor(document, position);
    const cpu = documentIndex.get(document.uri)?.cpu ?? DEFAULT_CPU;

    if (prefix.startsWith('.')) {
        return getDirectiveCompletions(prefix);
    }

    // Determine token position: nothing before -> first token (label or opcode).
    // One prior identifier token -> second token, which is an opcode unless the
    // first token was itself a recognized opcode (then this is operand position).
    const tokens = before.trim().length > 0 ? before.trim().split(/\s+/) : [];

    // First token on the line (nothing before it): could be a new label or an
    // opcode. Only opcodes are worth suggesting here - existing labels aren't
    // valid at the start of a fresh statement.
    if (tokens.length === 0) {
        return getOpcodeCompletions(prefix, cpu);
    }

    const firstToken = tokens[0].toLowerCase();

    // A directive's argument: never an opcode. Directives with a fixed,
    // non-symbol vocabulary (.enc, .cpu, ...) get no completions at all;
    // everything else (.byte, .assert, .dstruct, ...) may reference a symbol.
    if (firstToken.startsWith('.')) {
        if (NON_SYMBOL_ARG_DIRECTIVES.has(firstToken.slice(1))) {
            return [];
        }
        return getSymbolCompletions(document, position, documentIndex, false, visibleUris, prefix);
    }

    // Second token, with the first not a recognized opcode: that first token is
    // a code label ("label INX"), so this position is the opcode.
    if (tokens.length === 1 && !OPCODES.has(firstToken)) {
        return getOpcodeCompletions(prefix, cpu);
    }

    // Operand position after a real opcode: only addressable kinds make sense
    // (macro/function names are never referenced as a bare operand).
    const afterOpcode = OPCODES.has(firstToken) || (tokens.length > 1 && OPCODES.has(tokens[1].toLowerCase()));

    // Directly after a comma in an operand, the only thing that can follow is an
    // index register - a label there would never assemble. Which registers is
    // fixed by the mnemonic and the CPU, so the addressing table decides.
    //
    // ',' is not a trigger character, so this list only reaches the screen once a
    // letter has been typed - i.e. once the answer is already there. That is
    // tolerable only because the extension ships
    // `editor.acceptSuggestionOnEnter: "smart"` (contributes.configurationDefaults
    // in package.json): with it, a suggestion identical to what was typed makes no
    // textual change, so Enter still opens the next line instead of being eaten by
    // the popup. Without that default this branch actively costs a keypress on
    // every indexed line.
    if (afterOpcode && /,\s*$/.test(before)) {
        const mnemonic = OPCODES.has(firstToken) ? firstToken : tokens[1]?.toLowerCase();
        const registers = mnemonic ? indexRegistersFor(cpu, mnemonic, commaContextAt(before)) : [];
        if (registers.length > 0) {
            return registers
                .filter(register => register.startsWith(prefix.toLowerCase()))
                .map(register => ({
                    label: register,
                    kind: CompletionItemKind.Keyword,
                    detail: 'index register'
                }));
        }
    }

    return getSymbolCompletions(document, position, documentIndex, afterOpcode, visibleUris, prefix);
}
