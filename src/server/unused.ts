/**
 * Symbols nothing in the program refers to, shown as greyed-out hints.
 *
 * Mirrors 64tass's own `-Wunused` family (`unused label`, `unused const`,
 * `unused macro`, `unused variable`), which is off unless asked for - so this is
 * too, behind `64tass.unusedSymbols`.
 *
 * Deliberately NAME-based rather than scope-resolved: a name that appears
 * anywhere in the compilation unit outside its own definitions counts as used,
 * even if that occurrence would really resolve to a different scope's symbol.
 * The error that costs something is greying out a symbol that is used, and this
 * direction can only ever miss one that is not.
 */
import { Diagnostic, DiagnosticSeverity, DiagnosticTag } from 'vscode-languageserver/node';
import { DocumentIndex, LabelDefinition } from './types';
import { parseLineStructure, stripStrings } from './utils';

/** What 64tass calls each kind in its warning text. */
function describeKind(label: LabelDefinition): string {
    switch (label.kind) {
        case 'var': return 'variable';
        case 'macro': return 'macro';
        case 'const': return 'const';
        default: return 'label';
    }
}

const IDENTIFIER = /[a-zA-Z_][a-zA-Z0-9_]*/g;

/**
 * Every identifier written in `uris`, minus the definitions themselves.
 *
 * Comments and string contents are stripped first: a name mentioned in a comment
 * is not a use, and 64tass would not count it as one either.
 */
function referencedNames(
    uris: Iterable<string>,
    documentIndex: Map<string, DocumentIndex>,
    getText: (uri: string) => string | null,
    caseSensitive: boolean
): Set<string> {
    const used = new Set<string>();
    for (const uri of uris) {
        const text = getText(uri);
        if (text === null) continue;
        // Where this file's definitions sit, so the defining occurrence of a name
        // does not count as a use of it.
        const definitions = new Set<string>();
        for (const label of documentIndex.get(uri)?.labels ?? []) {
            definitions.add(`${label.range.start.line}:${label.range.start.character}`);
        }
        const lines = text.split('\n');
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const code = stripStrings(parseLineStructure(lines[lineNum]).code);
            IDENTIFIER.lastIndex = 0;
            let match;
            while ((match = IDENTIFIER.exec(code)) !== null) {
                if (definitions.has(`${lineNum}:${match.index}`)) continue;
                used.add(caseSensitive ? match[0] : match[0].toLowerCase());
            }
        }
    }
    return used;
}

/**
 * Hints for the definitions in `uri` that nothing refers to.
 *
 * `visibleUris` is the compilation unit: a symbol used by a program assembled
 * separately is not a use, and a symbol used by a file included alongside this
 * one is.
 */
export function findUnusedSymbols(
    uri: string,
    documentIndex: Map<string, DocumentIndex>,
    visibleUris: Iterable<string>,
    getText: (uri: string) => string | null
): Diagnostic[] {
    const index = documentIndex.get(uri);
    if (!index) return [];

    const used = referencedNames(visibleUris, documentIndex, getText, index.caseSensitive);
    const diagnostics: Diagnostic[] = [];
    for (const label of index.labels) {
        // Never named, so never referred to by name either.
        if (label.isAnonymous) continue;
        if (used.has(label.name)) continue;
        diagnostics.push({
            severity: DiagnosticSeverity.Hint,
            range: label.range,
            message: `Unused ${describeKind(label)} '${label.originalName}'`,
            source: '64tass',
            code: 'unused-symbol',
            tags: [DiagnosticTag.Unnecessary],
        });
    }
    return diagnostics;
}
