import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolveIncludePath } from './paths';

/** File extensions this extension handles. */
export const SOURCE_EXTENSIONS = ['.asm', '.s', '.inc', '.src'];

/**
 * Directories never worth scanning. Skipped by name at any depth - these hold
 * dependencies, VCS metadata or build output, not hand-written sources.
 */
export const IGNORED_DIRECTORIES = new Set([
    'node_modules', '.git', '.svn', '.hg', '.vscode', 'out', 'dist', 'build'
]);

export interface CollectOptions {
    /** Stop after this many files, so a huge tree cannot stall the scan. */
    limit?: number;
    /** Called when the limit was hit and files were left unscanned. */
    onLimit?: (limit: number) => void;
}

/**
 * Recursively collect source files under `root`.
 *
 * Symlinked directories are not followed, which keeps a self-referential link
 * from looping forever. Unreadable directories are skipped rather than throwing,
 * since a workspace can easily contain something the server cannot open.
 */
export function collectSourceFiles(root: string, options: CollectOptions = {}): string[] {
    const limit = options.limit ?? Infinity;
    const found: string[] = [];

    const walk = (dir: string): void => {
        if (found.length >= limit) return;

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return; // unreadable directory - skip it rather than fail the scan
        }

        for (const entry of entries) {
            if (found.length >= limit) return;
            const full = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (IGNORED_DIRECTORIES.has(entry.name)) continue;
                walk(full);
            } else if (entry.isFile()) {
                if (SOURCE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
                    found.push(full);
                }
            }
            // isSymbolicLink(): deliberately not followed
        }
    };

    walk(root);
    if (found.length >= limit && limit !== Infinity) options.onLimit?.(limit);
    return found;
}

/** Directives whose argument is a quoted file path (same set completion offers). */
const FILE_PATH_DIRECTIVE = /(?:^|\s)\.(include|binclude|binary)\s+(["'])([^"']*)\2/i;

export interface FilePathReference {
    /** The path exactly as written in the source */
    text: string;
    /** Absolute path if the file exists, else null */
    resolved: string | null;
    /** Column where the path text starts (excluding the quote) */
    start: number;
    /** Column just past the path text */
    end: number;
}

/**
 * The quoted file path under `character` on `line`, if any.
 *
 * Covers .include, .binclude and .binary - go-to-definition previously handled
 * only .include, while completion already offered all three.
 *
 * @param fromFile absolute path of the file containing the line, used to resolve
 *                 the reference relative to it
 * @param searchPaths extra directories to try, mirroring 64tass's -I flag. It
 *                 applies to .binary as well as the include directives (verified).
 */
export function findFilePathAt(line: string, character: number, fromFile: string, searchPaths: readonly string[] = []): FilePathReference | null {
    const match = line.match(FILE_PATH_DIRECTIVE);
    if (!match || match.index === undefined) return null;

    const pathText = match[3];
    // Offset of the path within the line: match start + everything before the path
    const start = match.index + match[0].length - pathText.length - 1; // -1 for the closing quote
    const end = start + pathText.length;
    if (character < start || character > end) return null;

    let resolved: string | null = null;
    if (pathText !== '') {
        const uri = resolveIncludePath(pathToFileURL(fromFile).toString(), pathText, searchPaths);
        if (uri) {
            try { resolved = fileURLToPath(uri); } catch { resolved = null; }
        }
    }

    return { text: pathText, resolved, start, end };
}
