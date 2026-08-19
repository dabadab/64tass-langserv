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
import { OPCODES, ALL_DIRECTIVES, NON_SYMBOL_ARG_DIRECTIVES } from './constants';
import { collectVisibleLabels, collectVisibleParameters } from './symbols';

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
function getFilePathCompletions(document: TextDocument, position: Position): CompletionItem[] | null {
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

    const targetDir = path.resolve(currentDir, dirPart);
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(targetDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const items: CompletionItem[] = [];
    for (const entry of entries) {
        if (!entry.name.toLowerCase().startsWith(filePrefix.toLowerCase())) continue;
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
    return items;
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

/** Suggest 6502/undocumented opcode mnemonics. */
function getOpcodeCompletions(prefix: string): CompletionItem[] {
    const lowerPrefix = prefix.toLowerCase();
    const items: CompletionItem[] = [];
    for (const op of OPCODES) {
        if (op.startsWith(lowerPrefix)) {
            items.push({ label: op, kind: CompletionItemKind.Keyword });
        }
    }
    return items;
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
    visibleUris?: ReadonlySet<string>
): CompletionItem[] {
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
}

export function getCompletions(
    document: TextDocument,
    position: Position,
    documentIndex: Map<string, DocumentIndex>,
    options: CompletionOptions = {}
): CompletionItem[] {
    const { visibleUris } = options;
    // File-path completion takes priority: it fires from inside a quoted string,
    // a context none of the other modes should also try to complete in.
    const fileCompletions = getFilePathCompletions(document, position);
    if (fileCompletions !== null) return fileCompletions;

    const fullLine = document.getText(Range.create(
        Position.create(position.line, 0),
        Position.create(position.line + 1, 0)
    ));
    // Don't offer keyword/opcode/symbol completions inside comments or strings
    const commentIdx = fullLine.indexOf(';');
    if (commentIdx >= 0 && commentIdx < position.character) return [];

    const { before, prefix } = splitAtCursor(document, position);

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
        return getOpcodeCompletions(prefix);
    }

    const firstToken = tokens[0].toLowerCase();

    // A directive's argument: never an opcode. Directives with a fixed,
    // non-symbol vocabulary (.enc, .cpu, ...) get no completions at all;
    // everything else (.byte, .assert, .dstruct, ...) may reference a symbol.
    if (firstToken.startsWith('.')) {
        if (NON_SYMBOL_ARG_DIRECTIVES.has(firstToken.slice(1))) {
            return [];
        }
        return getSymbolCompletions(document, position, documentIndex, false, visibleUris);
    }

    // Second token, with the first not a recognized opcode: that first token is
    // a code label ("label INX"), so this position is the opcode.
    if (tokens.length === 1 && !OPCODES.has(firstToken)) {
        return getOpcodeCompletions(prefix);
    }

    // Operand position after a real opcode: only addressable kinds make sense
    // (macro/function names are never referenced as a bare operand).
    const afterOpcode = OPCODES.has(firstToken) || (tokens.length > 1 && OPCODES.has(tokens[1].toLowerCase()));
    return getSymbolCompletions(document, position, documentIndex, afterOpcode, visibleUris);
}
