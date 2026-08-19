import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

/**
 * Resolve an `.include`/`.binclude` path the way 64tass does (verified against
 * the assembler): the directory of the file doing the including is tried first,
 * then each search path in order, and the search paths stack. Search paths mirror
 * 64tass's `-I` flag, exposed as the `64tass.includePaths` setting.
 *
 * Returns a file URI, or null if the path resolves to nothing on disk.
 */
export function resolveIncludePath(
    fromUri: string,
    includePath: string,
    // Absolute directories. Callers resolve any relative setting value against the
    // workspace root before getting here, since a language server has no cwd worth
    // resolving against.
    searchPaths: readonly string[] = []
): string | null {
    let fromDir: string;
    try {
        fromDir = path.dirname(fileURLToPath(fromUri));
    } catch {
        return null;
    }

    for (const dir of [fromDir, ...searchPaths]) {
        const candidate = path.resolve(dir, includePath);
        try {
            if (fs.statSync(candidate).isFile()) return pathToFileURL(candidate).toString();
        } catch {
            // Unreadable or missing - keep looking.
        }
    }
    return null;
}

/**
 * Turn configured search paths into absolute directories. Relative entries are
 * taken against the workspace root, which stands in for the cwd a real 64tass
 * invocation would have.
 */
export function absoluteSearchPaths(configured: readonly string[], workspaceRoot: string | null): string[] {
    return configured
        .filter(p => p.trim().length > 0)
        .map(p => (workspaceRoot ? path.resolve(workspaceRoot, p) : path.resolve(p)));
}
