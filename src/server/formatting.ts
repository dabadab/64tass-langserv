/**
 * Column alignment: label, mnemonic, operand, comment.
 *
 * Conservative by construction - it only ever changes the WHITESPACE BETWEEN
 * those four fields. A line it cannot split confidently is returned untouched,
 * and so is anything inside a `.comment` block or a line that is nothing but a
 * comment, where the spacing is usually deliberate (banners, ASCII art).
 *
 * The default columns are the ones the 64tass distribution's own sources use
 * most: mnemonic at 8, operand at 12, trailing comment at 40.
 */
import { TextEdit, Range, Position } from 'vscode-languageserver/node';
import { parseLineStructure, findCommentBlockLines } from './utils';
import { OPCODES, ALL_DIRECTIVES } from './constants';

export interface FormatColumns {
    mnemonic: number;
    operand: number;
    comment: number;
}

export const DEFAULT_COLUMNS: FormatColumns = { mnemonic: 8, operand: 12, comment: 40 };

/** Pad `text` so the next field starts at `column`, always leaving one space. */
function padTo(text: string, column: number): string {
    return text + ' '.repeat(Math.max(1, column - text.length));
}

/** A label, an anonymous label, or one of the things that can open a line. */
const WORD = /^([a-zA-Z_][a-zA-Z0-9_]*|[-+]+|[.#][a-zA-Z_][a-zA-Z0-9_]*|\*)/;
/** What can stand in the instruction slot, once any label is off the front. */
const SLOT = /^(\*\s*=|:?=|[.#]?[a-zA-Z_][a-zA-Z0-9_]*|\*)/;

interface Fields {
    label: string;
    /** Mnemonic, directive, macro call, `*=` or the `=` of an assignment. */
    slot: string;
    operand: string;
}

/**
 * Split a line into its fields, or null when it is not a shape worth touching.
 *
 * The first word is the instruction when it IS one - the assembler's own rule,
 * which is about the token and not the column. For a word that is neither an
 * instruction nor a directive the indentation decides instead: at column 0 it
 * reads as a label, indented it reads as an unprefixed macro call, and that is
 * where each belongs anyway.
 */
function splitFields(body: string): Fields | null {
    const indented = /^\s/.test(body);
    const rest = body.trim();
    const first = rest.match(WORD);
    if (!first) return null;

    const word = first[1];
    const after = rest.slice(word.length);
    const colon = after.startsWith(':') && !after.startsWith(':=');
    // A trailing colon settles it before anything else does: `nop:` is a label,
    // even though `nop` is an instruction (verified). Testing the word first
    // turned that line into `nop :` - an instruction with a stray operand, and a
    // label the program no longer had.
    const isInstruction = !colon && (/^[.#*]/.test(word)
        || OPCODES.has(word.toLowerCase())
        || ALL_DIRECTIVES.includes(word.toLowerCase()));
    const assigned = /^\s*:?=/.test(after);

    if (!isInstruction && (colon || assigned || !indented)) {
        const label = word + (colon ? ':' : '');
        const remainder = rest.slice(label.length).trimStart();
        if (remainder === '') return { label, slot: '', operand: '' };
        const slot = remainder.match(SLOT)?.[1];
        if (slot === undefined) return null;
        return { label, slot, operand: remainder.slice(slot.length).trim() };
    }

    const slot = rest.match(SLOT)?.[1];
    if (slot === undefined) return null;
    return { label: '', slot, operand: rest.slice(slot.length).trim() };
}

/**
 * The line rewritten to the given columns, or null to leave it exactly as it is.
 */
export function formatLine(line: string, columns: FormatColumns): string | null {
    const { code, commentStart } = parseLineStructure(line);
    const comment = commentStart >= 0 ? line.slice(commentStart).trimEnd() : '';
    const body = code.trimEnd();

    // A blank line, or one that is only a comment: left alone, including its
    // indentation - banner comments are lined up on purpose.
    if (body.trim() === '') return line.trimEnd() === line ? null : line.trimEnd();

    // A line holding one word and nothing else is ambiguous - a label, or a macro
    // call taking no arguments - and the assembler reads it the same wherever it
    // sits. Moving it would pick a side the author did not. Its comment still
    // lines up.
    const lone = body.trim().match(/^[a-zA-Z_][a-zA-Z0-9_]*:?$|^[-+]+$/);
    if (lone) {
        const kept = body.trimEnd();
        const out = comment === '' ? kept : padTo(kept, columns.comment) + comment;
        return out === line ? null : out;
    }

    const fields = splitFields(body);
    if (fields === null) return null;

    let out = fields.label;
    if (fields.slot !== '') {
        out = padTo(out, columns.mnemonic) + fields.slot;
        // `=` reads better with a single space, the way the sources write it; an
        // operand column would push the value oddly far right.
        if (fields.operand !== '') {
            out = /=$/.test(fields.slot)
                ? `${out} ${fields.operand}`
                : padTo(out, columns.operand) + fields.operand;
        }
    }
    if (comment !== '') out = (out === '' ? '' : padTo(out, columns.comment)) + comment;

    return out === line ? null : out;
}

/** Edits that align `text`, restricted to `range` when one is given. */
export function formatDocument(text: string, columns: FormatColumns, range?: Range): TextEdit[] {
    const lines = text.split('\n');
    // The assembler ignores these entirely, and so does this.
    const commentBlockLines = findCommentBlockLines(lines);

    const first = range ? Math.max(0, range.start.line) : 0;
    const last = range ? Math.min(lines.length - 1, range.end.line) : lines.length - 1;

    const edits: TextEdit[] = [];
    for (let line = first; line <= last; line++) {
        if (commentBlockLines.has(line)) continue;
        const formatted = formatLine(lines[line], columns);
        if (formatted === null || formatted === lines[line]) continue;
        edits.push(TextEdit.replace(
            Range.create(Position.create(line, 0), Position.create(line, lines[line].length)),
            formatted
        ));
    }
    return edits;
}
