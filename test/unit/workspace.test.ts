import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectSourceFiles, findFilePathAt, SOURCE_EXTENSIONS, IGNORED_DIRECTORIES } from '../../src/server/workspace';

let root: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), '64tass-ws-'));
    const write = (rel: string) => {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, '; test\n');
    };
    write('main.asm');
    write('lib.inc');
    write('other.s');
    write('data.src');
    write('notes.txt');            // wrong extension
    write('sub/nested.asm');
    write('sub/deep/deeper.asm');
    write('node_modules/dep.asm'); // ignored directory
    write('.git/hook.asm');        // ignored directory
    write('out/generated.asm');    // ignored directory
    write('UPPER.ASM');            // extension casing
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const namesIn = (files: string[]) => files.map(f => path.relative(root, f)).sort();

describe('collectSourceFiles', () => {
    it('finds source files recursively', () => {
        const found = namesIn(collectSourceFiles(root));
        expect(found).toContain('main.asm');
        expect(found).toContain('lib.inc');
        expect(found).toContain('other.s');
        expect(found).toContain('data.src');
        expect(found).toContain(path.join('sub', 'nested.asm'));
        expect(found).toContain(path.join('sub', 'deep', 'deeper.asm'));
    });

    it('ignores files with other extensions', () => {
        expect(namesIn(collectSourceFiles(root))).not.toContain('notes.txt');
    });

    it('matches the extension case-insensitively', () => {
        expect(namesIn(collectSourceFiles(root))).toContain('UPPER.ASM');
    });

    it('skips dependency, VCS and build directories', () => {
        const found = namesIn(collectSourceFiles(root));
        expect(found.some(f => f.startsWith('node_modules'))).toBe(false);
        expect(found.some(f => f.startsWith('.git'))).toBe(false);
        expect(found.some(f => f.startsWith('out'))).toBe(false);
    });

    it('respects the limit and reports it', () => {
        let reported: number | undefined;
        const found = collectSourceFiles(root, { limit: 3, onLimit: n => { reported = n; } });
        expect(found).toHaveLength(3);
        expect(reported).toBe(3);
    });

    it('does not report the limit when the tree fits', () => {
        let reported: number | undefined;
        collectSourceFiles(root, { limit: 1000, onLimit: n => { reported = n; } });
        expect(reported).toBeUndefined();
    });

    it('returns an empty list for a missing directory', () => {
        expect(collectSourceFiles(path.join(root, 'does-not-exist'))).toEqual([]);
    });

    it('exposes the handled extensions and ignore list', () => {
        expect(SOURCE_EXTENSIONS).toEqual(expect.arrayContaining(['.asm', '.s', '.inc', '.src']));
        expect(IGNORED_DIRECTORIES.has('node_modules')).toBe(true);
    });
});

describe('collectSourceFiles - symlinks', () => {
    it('does not follow a symlinked directory that points at its own parent', () => {
        const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), '64tass-link-'));
        try {
            fs.writeFileSync(path.join(linkDir, 'a.asm'), '; x\n');
            fs.symlinkSync(linkDir, path.join(linkDir, 'loop'), 'dir');
            // Would recurse forever if symlinked directories were followed
            const found = collectSourceFiles(linkDir);
            expect(found.map(f => path.basename(f))).toEqual(['a.asm']);
        } finally {
            fs.rmSync(linkDir, { recursive: true, force: true });
        }
    });
});

describe('findFilePathAt', () => {
    let dir: string;
    let fromFile: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), '64tass-paths-'));
        fs.writeFileSync(path.join(dir, 'dep.asm'), '; dep\n');
        fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'sub', 'nested.inc'), '; nested\n');
        fs.writeFileSync(path.join(dir, 'data.bin'), 'binary');
        fromFile = path.join(dir, 'main.asm');
    });

    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    const at = (line: string, ch: number) => findFilePathAt(line, ch, fromFile);

    // M5: definition used to work for .include only, though completion offered all three
    it.each(['include', 'binclude', 'binary'])('resolves a .%s path', (directive) => {
        const line = `        .${directive} "dep.asm"`;
        const ref = at(line, line.indexOf('dep.asm') + 2);
        expect(ref).not.toBeNull();
        expect(ref!.text).toBe('dep.asm');
        expect(ref!.resolved).toBe(path.join(dir, 'dep.asm'));
    });

    it('resolves a path in a subdirectory', () => {
        const line = '        .include "sub/nested.inc"';
        expect(at(line, line.indexOf('sub/'))!.resolved).toBe(path.join(dir, 'sub', 'nested.inc'));
    });

    it('reports a path that does not exist as unresolved', () => {
        const line = '        .include "missing.asm"';
        const ref = at(line, line.indexOf('missing'));
        expect(ref).not.toBeNull();
        expect(ref!.resolved).toBeNull();
    });

    it('returns null when the cursor is outside the path', () => {
        const line = '        .include "dep.asm" ; trailing';
        expect(at(line, 2)).toBeNull();                              // on the directive
        expect(at(line, line.indexOf('"'))).toBeNull();              // on the opening quote
        expect(at(line, line.indexOf(';'))).toBeNull();              // in the comment
    });

    it('treats the position just past the last character as still on the path', () => {
        // Clicking at the end of the path text is normal editor behaviour
        const line = '        .include "dep.asm"';
        const end = line.indexOf('dep.asm') + 'dep.asm'.length;
        expect(at(line, end)).not.toBeNull();
    });

    it('reports the span of the path text', () => {
        const line = '        .include "dep.asm"';
        const ref = at(line, line.indexOf('dep.asm'))!;
        expect(ref.start).toBe(line.indexOf('dep.asm'));
        expect(ref.end).toBe(line.indexOf('dep.asm') + 'dep.asm'.length);
    });

    it('handles single quotes', () => {
        const line = "        .include 'dep.asm'";
        expect(at(line, line.indexOf('dep.asm'))!.resolved).toBe(path.join(dir, 'dep.asm'));
    });

    it('returns null for a line with no file directive', () => {
        expect(at('        lda #1', 5)).toBeNull();
        expect(at('        .byte "not a path"', 18)).toBeNull();
    });

    it('handles a label before the directive', () => {
        const line = 'lbl     .binary "data.bin"';
        expect(at(line, line.indexOf('data.bin'))!.resolved).toBe(path.join(dir, 'data.bin'));
    });
});
