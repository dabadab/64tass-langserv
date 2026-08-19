import { DocumentLink, Range, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { pathToFileURL, fileURLToPath } from 'url';
import { findFilePathAt } from './workspace';

/**
 * Clickable links for the quoted file paths in a document - `.include`,
 * `.binclude` and `.binary`.
 *
 * Go-to-definition already opens these, but a link is discoverable without
 * knowing to try F12, and shows at a glance which paths actually resolve: only
 * paths that exist on disk become links, so a broken one stays plain text.
 */
export function buildDocumentLinks(
    document: TextDocument,
    searchPaths: readonly string[] = []
): DocumentLink[] {
    let fromFile: string;
    try {
        fromFile = fileURLToPath(document.uri);
    } catch {
        return [];   // untitled or non-file document; nothing to resolve against
    }

    const links: DocumentLink[] = [];
    const lines = document.getText().split('\n');
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        if (!line.includes('"') && !line.includes("'")) continue;

        // findFilePathAt is position-driven, so ask about the line's first quote
        // and let it report the extent of whatever path it finds there.
        const quote = Math.min(
            ...[line.indexOf('"'), line.indexOf("'")].filter(i => i >= 0)
        );
        const reference = findFilePathAt(line, quote + 1, fromFile, searchPaths);
        if (!reference?.resolved) continue;

        links.push({
            range: Range.create(
                Position.create(lineNum, reference.start),
                Position.create(lineNum, reference.end)
            ),
            target: pathToFileURL(reference.resolved).toString(),
            tooltip: reference.resolved,
        });
    }
    return links;
}
