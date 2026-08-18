import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectSourceFiles, SOURCE_EXTENSIONS, IGNORED_DIRECTORIES } from '../../src/server/workspace';

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
