import { CodeAction, CodeActionKind, Diagnostic, Position, TextEdit } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentIndex } from './types';
import { collectVisibleLabels } from './symbols';

/** Longest suggestion distance still worth offering, as a share of the word's length. */
const MAX_DISTANCE_RATIO = 0.4;
/** How many spelling suggestions to offer at most. */
const MAX_SUGGESTIONS = 3;

/**
 * Quick fixes for the diagnostics that have an obvious repair: a misspelled
 * symbol or macro name, and a block that was never closed.
 *
 * Diagnostics are matched on their `code`, not their message text, so wording
 * can change without silently dropping the fixes.
 */
export function buildCodeActions(
    document: TextDocument,
    diagnostics: Diagnostic[],
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive: boolean
): CodeAction[] {
    const actions: CodeAction[] = [];
    const lines = document.getText().split('\n');

    for (const diagnostic of diagnostics) {
        if (diagnostic.code === 'undefined-symbol' || diagnostic.code === 'undefined-macro') {
            actions.push(...spellingFixes(document, diagnostic, documentIndex, caseSensitive, lines));
        } else if (diagnostic.code === 'unclosed-block') {
            const fix = closeBlockFix(document, diagnostic, lines);
            if (fix) actions.push(fix);
        }
    }
    return actions;
}

function spellingFixes(
    document: TextDocument,
    diagnostic: Diagnostic,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive: boolean,
    lines: string[]
): CodeAction[] {
    const line = lines[diagnostic.range.start.line] ?? '';
    const written = line.slice(diagnostic.range.start.character, diagnostic.range.end.character);
    if (!written) return [];

    // A macro is written ".name" but the diagnostic's range covers the name only,
    // so what is read here matches how macros are indexed either way.
    const isMacro = diagnostic.code === 'undefined-macro';
    const target = caseSensitive ? written : written.toLowerCase();

    const candidates = new Map<string, number>();
    for (const label of collectVisibleLabels(document.uri, diagnostic.range.start.line, documentIndex)) {
        if (isMacro && label.kind !== 'macro') continue;
        const distance = editDistance(target, label.name);
        if (distance === 0 || distance > Math.max(1, Math.floor(target.length * MAX_DISTANCE_RATIO))) continue;
        const existing = candidates.get(label.originalName);
        if (existing === undefined || distance < existing) candidates.set(label.originalName, distance);
    }

    return [...candidates]
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_SUGGESTIONS)
        .map(([name]) => ({
            title: `Change to '${name}'`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: { changes: { [document.uri]: [TextEdit.replace(diagnostic.range, name)] } },
        }));
}

function closeBlockFix(document: TextDocument, diagnostic: Diagnostic, lines: string[]): CodeAction | null {
    const data = diagnostic.data as { closeDirective?: string; openLine?: number } | undefined;
    const closeDirective = data?.closeDirective;
    if (!closeDirective) return null;

    // Append at the end of the document, matching the indentation of the line
    // that opened the block. Anywhere else would be a guess about intent.
    const openLine = lines[data?.openLine ?? diagnostic.range.start.line] ?? '';
    const indent = openLine.slice(0, openLine.length - openLine.trimStart().length) || '        ';
    const lastLine = Math.max(lines.length - 1, 0);
    const atEnd = Position.create(lastLine, lines[lastLine].length);
    const newText = (lines[lastLine].trim() === '' ? '' : '\n') + `${indent}${closeDirective}\n`;

    return {
        title: `Add '${closeDirective}'`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: { changes: { [document.uri]: [TextEdit.insert(atEnd, newText)] } },
        // Fixing one unclosed block can change how the rest of the file nests, so
        // this is offered rather than applied as part of a fix-all.
    };
}

/** Levenshtein distance, capped implicitly by the caller's threshold. */
function editDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > a.length) return Infinity;

    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        previous = current;
    }
    return previous[b.length];
}
