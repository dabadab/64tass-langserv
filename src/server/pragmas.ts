/**
 * The `; 64tass-langserv: ...` pragmas, described in one place.
 *
 * They are ordinary comments as far as the assembler is concerned - they tell
 * THIS extension something it cannot work out on its own, usually because the
 * real build passes it on the command line. Completion and hover both read this
 * table, so a new pragma is described once.
 */
import { CompletionItem, CompletionItemKind, Hover, MarkupKind, Range, Position, TextEdit } from 'vscode-languageserver/node';
import { CPU_NAMES } from './constants';

export const PRAGMA_PREFIX = '64tass-langserv:';

export interface Pragma {
    /** What follows the prefix, and what completion inserts. */
    name: string;
    /** The whole line, as it would be written. */
    syntax: string;
    /** One sentence on what it changes. */
    summary: string;
    /** Longer note shown on hover, when there is more worth saying. */
    detail?: string;
    /** Values the argument can take, offered after the name. */
    values?: readonly string[];
}

export const PRAGMAS: readonly Pragma[] = [
    {
        name: 'case-sensitive',
        syntax: '; 64tass-langserv: case-sensitive',
        summary: 'Match symbol names case-sensitively in this file and everything it includes.',
        detail: 'Mirrors 64tass\'s `-C` flag. Overrides the `64tass.caseSensitive` setting for '
            + 'this compilation unit, so one workspace can hold projects built both ways.',
    },
    {
        name: 'case-insensitive',
        syntax: '; 64tass-langserv: case-insensitive',
        summary: 'Match symbol names case-insensitively, which is the assembler\'s default.',
        detail: 'Overrides the `64tass.caseSensitive` setting for this file and its includes.',
    },
    {
        name: 'cpu',
        syntax: '; 64tass-langserv: cpu <name>',
        summary: 'Set the target CPU for this file and everything it includes.',
        detail: 'For when the target is chosen on the command line rather than in the source - '
            + 'a `.cpu "..."` directive needs no pragma. Declaring it also turns on the checks '
            + 'that would otherwise be guessing: a mnemonic or addressing mode this target does '
            + 'not have.',
        values: CPU_NAMES,
    },
    {
        name: 'define',
        syntax: '; 64tass-langserv: define <NAME> = <VALUE>',
        summary: 'Define a symbol the build supplies, as 64tass\'s `-D` flag does.',
        detail: 'Indexed as an ordinary constant, so it resolves like any other symbol - and, '
            + 'more to the point, lets `.if` branches that depend on it be decided.',
    },
    {
        name: 'root',
        syntax: '; 64tass-langserv: root <file>',
        summary: 'Name the file to assemble when this one is saved.',
        detail: 'An include usually cannot be assembled alone. Without this, the single root that '
            + 'includes this file is used, or the file itself. Only matters with '
            + '`64tass.assemblerPath` set.',
    },
];

/** A comment line, and how much of the pragma has been typed on it. */
const PARTIAL_PREFIX = /^\s*;\s*([a-zA-Z0-9-]*)$/;
const AFTER_PREFIX = /^\s*;\s*64tass-langserv\s*:\s*([a-zA-Z-]*)$/i;
const AFTER_NAME = /^\s*;\s*64tass-langserv\s*:\s*([a-zA-Z-]+)\s+(\S*)$/i;

/**
 * Completions for the text before the cursor, or null when it is not a pragma
 * being typed.
 *
 * Deliberately silent on a comment that has not started to look like one: a
 * popup on every `; note to self` would be a nuisance, so the prefix has to be
 * under way before anything is offered.
 */
export function pragmaCompletions(before: string, position: Position): CompletionItem[] | null {
    const started = before.match(PARTIAL_PREFIX);
    if (started) {
        const typed = started[1];
        if (typed === '' || !PRAGMA_PREFIX.startsWith(typed.toLowerCase())) return null;
        const range = Range.create(Position.create(position.line, position.character - typed.length), position);
        return [{
            label: PRAGMA_PREFIX,
            kind: CompletionItemKind.Keyword,
            detail: 'extension pragma',
            textEdit: TextEdit.replace(range, `${PRAGMA_PREFIX} `),
            // Straight on to which pragma it is.
            command: { title: 'Trigger Suggest', command: 'editor.action.triggerSuggest' },
        }];
    }

    const afterName = before.match(AFTER_NAME);
    if (afterName) {
        const pragma = PRAGMAS.find(p => p.name === afterName[1].toLowerCase());
        if (!pragma?.values) return null;
        const typed = afterName[2];
        const range = Range.create(Position.create(position.line, position.character - typed.length), position);
        return pragma.values.map(value => ({
            label: value,
            kind: CompletionItemKind.Value,
            textEdit: TextEdit.replace(range, value),
        }));
    }

    const afterPrefix = before.match(AFTER_PREFIX);
    if (afterPrefix) {
        const typed = afterPrefix[1];
        const range = Range.create(Position.create(position.line, position.character - typed.length), position);
        return PRAGMAS.map(pragma => ({
            label: pragma.name,
            kind: CompletionItemKind.Keyword,
            detail: pragma.summary,
            documentation: { kind: MarkupKind.Markdown, value: describe(pragma) },
            textEdit: TextEdit.replace(range, pragma.values ? `${pragma.name} ` : pragma.name),
            command: pragma.values
                ? { title: 'Trigger Suggest', command: 'editor.action.triggerSuggest' }
                : undefined,
        }));
    }

    return null;
}

function describe(pragma: Pragma): string {
    const lines = [`\`${pragma.syntax}\``, '', pragma.summary];
    if (pragma.detail) lines.push('', pragma.detail);
    if (pragma.values) lines.push('', `One of: ${pragma.values.map(v => `\`${v}\``).join(', ')}`);
    return lines.join('\n');
}

/** The pragma written on this line, whatever the cursor sits on. */
const PRAGMA_LINE = /^(\s*;\s*64tass-langserv\s*:\s*)([a-zA-Z-]+)/i;

/**
 * Hover for a pragma line. Answers anywhere on the line rather than on the name
 * alone - the interesting question is what the line does, and the comment has no
 * other meaning to hover over.
 */
export function pragmaHover(line: string, lineNumber: number): Hover | null {
    const match = line.match(PRAGMA_LINE);
    if (!match) return null;
    const pragma = PRAGMAS.find(p => p.name === match[2].toLowerCase());
    if (!pragma) return null;
    return {
        contents: { kind: MarkupKind.Markdown, value: describe(pragma) },
        range: Range.create(
            Position.create(lineNumber, match[1].length - (match[1].length - match[1].trimStart().length)),
            Position.create(lineNumber, match[0].length)
        ),
    };
}
