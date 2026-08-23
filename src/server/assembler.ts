/**
 * Running the real assembler and turning its output into diagnostics.
 *
 * Everything else in this server is a careful approximation of what 64tass does;
 * this is 64tass. It catches the whole class the heuristics cannot reach -
 * expression typing, bank and page arithmetic, encoding errors, branch distance -
 * and it is the reason those heuristics can stay conservative.
 *
 * Off unless `64tass.assemblerPath` names a binary, and run only on save: the
 * file on disk is what the assembler reads, so an unsaved buffer would report on
 * text nobody can see.
 */
import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Diagnostic, DiagnosticSeverity, Range, Position } from 'vscode-languageserver/node';

/** One line of 64tass's `file:line:col: severity: message` output. */
export interface AssemblerMessage {
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'note';
    message: string;
}

const MESSAGE_PATTERN = /^(.+?):(\d+):(\d+): (error|warning|note): (.+)$/gm;

export function parseAssemblerOutput(output: string): AssemblerMessage[] {
    const messages: AssemblerMessage[] = [];
    MESSAGE_PATTERN.lastIndex = 0;
    let match;
    while ((match = MESSAGE_PATTERN.exec(output)) !== null) {
        messages.push({
            file: match[1],
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10),
            severity: match[4] as AssemblerMessage['severity'],
            message: match[5],
        });
    }
    return messages;
}

/**
 * Group messages into diagnostics by file URI, so each file's own errors can be
 * published against it - an error in an include belongs in that include.
 *
 * A "note" is a continuation of the message above it (64tass uses them to point
 * at the original of a duplicate), so it is folded into that diagnostic's text
 * rather than shown as a diagnostic of its own.
 */
export function toDiagnostics(messages: AssemblerMessage[], baseDir: string): Map<string, Diagnostic[]> {
    const byUri = new Map<string, Diagnostic[]>();
    let previous: Diagnostic | null = null;
    for (const message of messages) {
        if (message.severity === 'note' && previous) {
            previous.message += ` (${message.message})`;
            continue;
        }
        const absolute = path.resolve(baseDir, message.file);
        const uri = pathToFileURL(absolute).toString();
        // 64tass counts lines and columns from 1; LSP counts from 0. The column
        // it gives points into the line, but not at a token whose length it
        // reports, so the range is a caret rather than a span.
        const start = Position.create(Math.max(0, message.line - 1), Math.max(0, message.column - 1));
        const diagnostic: Diagnostic = {
            severity: message.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
            range: Range.create(start, Position.create(start.line, start.character + 1)),
            message: message.message,
            source: '64tass build',
        };
        const list = byUri.get(uri);
        if (list) list.push(diagnostic);
        else byUri.set(uri, [diagnostic]);
        previous = diagnostic;
    }
    return byUri;
}

export interface AssembleOptions {
    /** The binary to run - `64tass.assemblerPath`. */
    assemblerPath: string;
    /** Absolute path of the file to assemble: a root, not necessarily the open one. */
    file: string;
    /** `-I` directories, absolute. */
    includePaths?: readonly string[];
    /** Adds `-C` when true, mirroring the case-sensitivity setting. */
    caseSensitive?: boolean;
    /** The `--m...` flag for the target, when one is known. */
    cpuFlag?: string | null;
    /** Anything else the user configured, passed through verbatim. */
    extraArgs?: readonly string[];
    timeoutMs?: number;
}

export interface AssembleResult {
    diagnostics: Map<string, Diagnostic[]>;
    /** Set when the assembler could not be run at all, for the log. */
    failure: string | null;
}

/**
 * Assemble one file and return what it said, by URI.
 *
 * The output goes to the null device: assembling here is for the messages, and
 * writing a real output file would fight with the user's own build.
 */
export function assemble(options: AssembleOptions): Promise<AssembleResult> {
    const args = [
        '--quiet',
        '--output', os.devNull,
        ...(options.caseSensitive ? ['-C'] : []),
        ...(options.cpuFlag ? [options.cpuFlag] : []),
        ...(options.includePaths ?? []).flatMap(dir => ['-I', dir]),
        ...(options.extraArgs ?? []),
        options.file,
    ];
    const baseDir = path.dirname(options.file);

    return new Promise<AssembleResult>(resolve => {
        execFile(
            options.assemblerPath,
            args,
            { timeout: options.timeoutMs ?? 15000, maxBuffer: 4 * 1024 * 1024, cwd: baseDir },
            (error, stdout, stderr) => {
                const output = `${stderr}${stdout}`;
                const messages = parseAssemblerOutput(output);
                // A non-zero exit with messages is the normal "your source has
                // errors" case; a non-zero exit with none means the run itself
                // failed - no such binary, a timeout, a bad flag.
                const failure = error && messages.length === 0
                    ? (error.message.split('\n')[0] || 'assembler failed')
                    : null;
                resolve({ diagnostics: toDiagnostics(messages, baseDir), failure });
            }
        );
    });
}

/**
 * One map holding every run's messages, per file.
 *
 * Two programs that share a header can each have something to say about it, and
 * both are true - the header is part of both builds.
 */
export function mergeDiagnostics(runs: readonly Map<string, Diagnostic[]>[]): Map<string, Diagnostic[]> {
    const merged = new Map<string, Diagnostic[]>();
    for (const run of runs) {
        for (const [uri, diagnostics] of run) {
            merged.set(uri, [...(merged.get(uri) ?? []), ...diagnostics]);
        }
    }
    return merged;
}

/**
 * Which files to assemble when `uri` is saved.
 *
 * An include usually cannot stand alone, so: a `; 64tass-langserv: root <file>`
 * pragma wins outright, then every root whose include tree holds this file, and
 * failing both the file itself.
 *
 * EVERY root, not one of them: a header shared by two programs is part of both,
 * and an error it causes in either is real. That is the same set of files symbol
 * resolution treats as one compilation unit, so the two halves of the extension
 * answer for the same programs.
 */
export function chooseRoots(
    uri: string,
    text: string,
    rootsIncluding: readonly string[]
): string[] {
    const toPath = (fileUri: string): string | null => {
        try {
            return fileURLToPath(fileUri);
        } catch {
            return null;
        }
    };

    const pragma = detectRootPragma(text);
    if (pragma) {
        const from = toPath(uri);
        return from === null ? [] : [path.resolve(path.dirname(from), pragma)];
    }

    const roots = rootsIncluding.filter(root => root !== uri);
    const chosen = roots.length > 0 ? roots : [uri];
    // Sorted so a save assembles the same programs in the same order every time.
    return chosen.map(toPath).filter((p): p is string => p !== null).sort();
}

const ROOT_PRAGMA = /^\s*;\s*64tass-langserv\s*:\s*root\s+(\S.*?)\s*$/i;

/** The `; 64tass-langserv: root <file>` pragma's argument, or null. */
export function detectRootPragma(text: string): string | null {
    for (const line of text.split('\n')) {
        const match = line.match(ROOT_PRAGMA);
        if (match) return match[1];
    }
    return null;
}
