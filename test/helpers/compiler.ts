import { execFileSync } from 'child_process';
import * as fs from 'fs';

/**
 * Path to the real assembler. Override with TASS_PATH to run the integration
 * tests on a machine where 64tass lives somewhere else.
 */
export const TASS_PATH = process.env.TASS_PATH ?? '/home/db/bin/64tass';

export const TASS_EXISTS = fs.existsSync(TASS_PATH);

/**
 * Set REQUIRE_TASS=1 to make a missing assembler a hard failure instead of a
 * silent skip. Without it these suites disappear from a green run - which is
 * what CI would do, hiding the fact that nothing was verified against 64tass.
 */
export const REQUIRE_TASS = process.env.REQUIRE_TASS === '1' || process.env.REQUIRE_TASS === 'true';

if (REQUIRE_TASS && !TASS_EXISTS) {
    throw new Error(
        `REQUIRE_TASS is set but no 64tass binary was found at '${TASS_PATH}'. ` +
        `Install it or point TASS_PATH at it.`
    );
}

if (!TASS_EXISTS) {
    // Make the skip visible; a silently green run is the thing T4 is about.
    console.warn(
        `[integration] 64tass not found at '${TASS_PATH}' - compiler reference tests ` +
        `will be SKIPPED. Set TASS_PATH to its location, or REQUIRE_TASS=1 to fail instead.`
    );
}

/**
 * The 64tass version the generated tables in `addressing.ts` and the register
 * modes in `constants.ts` were probed from. Those tables describe one specific
 * assembler build, so the tests that compare them back are only meaningful
 * against the same version - a different one may legitimately differ.
 */
export const TABLES_PROBED_FROM = '1.60.3243';

/** The version string of the assembler in use, or null if it cannot be read. */
export const TASS_VERSION: string | null = (() => {
    if (!TASS_EXISTS) return null;
    try {
        const out = execFileSync(TASS_PATH, ['--version'], { encoding: 'utf-8' });
        return out.match(/V([0-9.]+)/)?.[1] ?? null;
    } catch {
        return null;
    }
})();

/** True when the assembler present is the one the generated tables came from. */
export const TABLES_MATCH_TASS = TASS_VERSION === TABLES_PROBED_FROM;

if (TASS_EXISTS && !TABLES_MATCH_TASS) {
    console.warn(
        `[integration] 64tass is V${TASS_VERSION}, but the generated opcode tables were ` +
        `probed from V${TABLES_PROBED_FROM} - the table-comparison tests will be SKIPPED. ` +
        `Everything else still runs against this assembler.`
    );
}

export interface CompilerResult {
    exitCode: number;
    stderr: string;
}

/** Run 64tass on a file and return the result. */
export function compile(filePath: string, extraFlags: string[] = []): CompilerResult {
    try {
        execFileSync(TASS_PATH, [
            '--quiet', '-o', '/dev/null', ...extraFlags, filePath
        ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        return { exitCode: 0, stderr: '' };
    } catch (err: any) {
        return {
            exitCode: err.status ?? 1,
            stderr: err.stderr ?? ''
        };
    }
}

export interface CompilerDiagnostic {
    file: string;
    line: number;
    col: number;
    severity: 'error' | 'warning' | 'note';
    message: string;
}

/** Parse 64tass error output into structured diagnostics. */
export function parseErrors(stderr: string): CompilerDiagnostic[] {
    const diagnostics: CompilerDiagnostic[] = [];
    const pattern = /^(.+?):(\d+):(\d+): (error|warning|note): (.+)$/gm;
    let match;
    while ((match = pattern.exec(stderr)) !== null) {
        diagnostics.push({
            file: match[1],
            line: parseInt(match[2], 10),
            col: parseInt(match[3], 10),
            severity: match[4] as 'error' | 'warning' | 'note',
            message: match[5],
        });
    }
    return diagnostics;
}
