import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { TASS_PATH, TASS_EXISTS } from '../helpers/compiler';
import { formatDocument, DEFAULT_COLUMNS } from '../../src/server/formatting';
import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * Formatting must be purely cosmetic, and there is one way to prove that: format
 * every corpus fixture and assemble both versions. The output has to be
 * byte-identical, which catches anything that moved a token rather than the
 * whitespace around it - a `.text` line whose spacing is data, a label that
 * drifted into an operand, a comment marker swallowed.
 */
const CORPUS = path.join(__dirname, '..', 'fixtures', 'corpus');

const COMPILE_FLAGS: Record<string, string[]> = {
    'conditionals.asm': ['-D', 'linking=0'],
    'switch-blocks.asm': ['-D', 'mode=2'],
};

const files = fs.readdirSync(CORPUS).filter(f => f.endsWith('.asm')).sort();

/** Assemble `file` and return the bytes it produced, or null if it would not. */
function output(file: string, flags: string[], outPath: string): Buffer | null {
    try {
        execFileSync(TASS_PATH, ['--quiet', '-o', outPath, ...flags, file],
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
        return null;
    }
    return fs.readFileSync(outPath);
}

/** Apply the edits back to front, so earlier ones do not shift later ones. */
function applyFormatting(source: string): string {
    const uri = 'file:///format.asm';
    return [...formatDocument(source, DEFAULT_COLUMNS)].reverse().reduce(
        (text, edit) => TextDocument.applyEdits(TextDocument.create(uri, '64tass', 1, text), [edit]),
        source);
}

/**
 * Squash the alignment out of a file, so formatting has real work to do - the
 * committed corpus is already tidy, and a test that formats tidy files proves
 * only that it left them alone.
 *
 * Lines carrying a string literal are left as they are: whitespace inside one is
 * data, and this crude collapse cannot tell where the literal starts.
 */
function unalign(source: string): string {
    return source.split('\n').map(line => {
        if (line.includes('"') || line.includes("'")) return line;
        const collapsed = line.replace(/^(\s*)(\S+)(\s+)/, (_, indent, token) => (indent ? ' ' : '') + token + ' ')
            .replace(/^(\s?\S+ \S+)(\s+)/, '$1 ');
        return collapsed.trimEnd();
    }).join('\n');
}

describe.skipIf(!TASS_EXISTS)('formatting keeps the program identical', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tass-fmt-'));
    // The corpus is copied out rather than written into: a fixture directory that
    // other suites scan is no place for temporary files, and includes have to
    // resolve relative to the file being assembled.
    const work = path.join(dir, 'corpus');
    fs.cpSync(CORPUS, work, { recursive: true });

    it.each(files)('%s assembles to the same bytes after formatting', (file) => {
        const source = fs.readFileSync(path.join(CORPUS, file), 'utf-8');
        const flags = COMPILE_FLAGS[file] ?? [];

        const before = output(path.join(CORPUS, file), flags, path.join(dir, 'before.prg'));
        expect(before, `${file} does not assemble as committed`).not.toBeNull();

        const formatted = applyFormatting(source);

        // Includes are resolved relative to the file, so the copy goes beside it.
        const copy = path.join(work, file);
        fs.writeFileSync(copy, formatted);
        const after = output(copy, flags, path.join(dir, 'after.prg'));
        expect(after, `${file} no longer assembles after formatting`).not.toBeNull();
        expect(after!.equals(before!)).toBe(true);
    });
    it.each(files)('%s survives being squashed and formatted again', (file) => {
        const source = fs.readFileSync(path.join(CORPUS, file), 'utf-8');
        const flags = COMPILE_FLAGS[file] ?? [];

        const before = output(path.join(CORPUS, file), flags, path.join(dir, 'before.prg'));
        expect(before).not.toBeNull();

        const copy = path.join(work, file);
        fs.writeFileSync(copy, applyFormatting(unalign(source)));
        const after = output(copy, flags, path.join(dir, 'after.prg'));
        expect(after, `${file} no longer assembles`).not.toBeNull();
        expect(after!.equals(before!)).toBe(true);
    });
});
