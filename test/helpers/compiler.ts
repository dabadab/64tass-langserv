import { execFileSync } from 'child_process';
import * as fs from 'fs';

const TASS_PATH = '/home/db/bin/64tass';

export const TASS_EXISTS = fs.existsSync(TASS_PATH);

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
