import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { resolveIncludePath, absoluteSearchPaths } from '../../src/server/paths';

let dir: string;
const uriOf = (name: string) => pathToFileURL(path.join(dir, name)).toString();

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), '64tass-paths-'));
    fs.mkdirSync(path.join(dir, 'libs'));
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'here.asm'), '');
    fs.writeFileSync(path.join(dir, 'libs', 'lib.asm'), '');
    fs.writeFileSync(path.join(dir, 'libs', 'here.asm'), '');
    fs.writeFileSync(path.join(dir, 'sub', 'lib.asm'), '');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('resolveIncludePath', () => {
    it('finds a file next to the includer with no search paths', () => {
        expect(resolveIncludePath(uriOf('main.asm'), 'here.asm')).toBe(uriOf('here.asm'));
    });

    it('returns null when nothing matches', () => {
        expect(resolveIncludePath(uriOf('main.asm'), 'missing.asm')).toBeNull();
    });

    it('falls back to a search path', () => {
        expect(resolveIncludePath(uriOf('main.asm'), 'lib.asm', [path.join(dir, 'libs')]))
            .toBe(uriOf('libs/lib.asm'));
    });

    it('prefers the includer\'s directory over a search path', () => {
        expect(resolveIncludePath(uriOf('main.asm'), 'here.asm', [path.join(dir, 'libs')]))
            .toBe(uriOf('here.asm'));
    });

    it('takes the first search path that has the file', () => {
        expect(resolveIncludePath(uriOf('main.asm'), 'lib.asm', [path.join(dir, 'sub'), path.join(dir, 'libs')]))
            .toBe(uriOf('sub/lib.asm'));
    });

    it('resolves a relative path against the includer', () => {
        expect(resolveIncludePath(uriOf('main.asm'), 'libs/lib.asm')).toBe(uriOf('libs/lib.asm'));
        expect(resolveIncludePath(uriOf('libs/x.asm'), '../here.asm')).toBe(uriOf('here.asm'));
    });

    it('does not match a directory', () => {
        expect(resolveIncludePath(uriOf('main.asm'), 'libs')).toBeNull();
    });

    it('returns null for a non-file URI rather than throwing', () => {
        expect(resolveIncludePath('untitled:Untitled-1', 'here.asm')).toBeNull();
    });
});

describe('absoluteSearchPaths', () => {
    it('resolves relative entries against the workspace root', () => {
        expect(absoluteSearchPaths(['libs'], '/work')).toEqual([path.resolve('/work/libs')]);
    });

    it('leaves absolute entries alone', () => {
        expect(absoluteSearchPaths(['/opt/inc'], '/work')).toEqual([path.resolve('/opt/inc')]);
    });

    it('drops blank entries', () => {
        expect(absoluteSearchPaths(['', '  ', 'libs'], '/work')).toEqual([path.resolve('/work/libs')]);
    });

    it('still returns absolute paths with no workspace root', () => {
        expect(absoluteSearchPaths(['libs'], null).every(p => path.isAbsolute(p))).toBe(true);
    });
});
