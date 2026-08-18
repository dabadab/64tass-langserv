import * as fs from 'fs';
import * as path from 'path';

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
