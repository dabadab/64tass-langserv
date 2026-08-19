import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { buildDocumentLinks } from '../../src/server/documentLinks';

let dir: string;
const docFor = (source: string) =>
    TextDocument.create(pathToFileURL(path.join(dir, 'main.asm')).toString(), '64tass', 1, source);

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), '64tass-links-'));
    fs.mkdirSync(path.join(dir, 'libs'));
    fs.writeFileSync(path.join(dir, 'dep.asm'), 'depsym = 1');
    fs.writeFileSync(path.join(dir, 'blob.bin'), 'DATA');
    fs.writeFileSync(path.join(dir, 'libs', 'far.asm'), 'farsym = 1');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('buildDocumentLinks', () => {
    it('links an .include path', () => {
        const links = buildDocumentLinks(docFor('        .include "dep.asm"'));
        expect(links).toHaveLength(1);
        expect(links[0].target).toBe(pathToFileURL(path.join(dir, 'dep.asm')).toString());
    });

    it('covers the path text without the quotes', () => {
        const source = '        .include "dep.asm"';
        const links = buildDocumentLinks(docFor(source));
        expect(source.slice(links[0].range.start.character, links[0].range.end.character)).toBe('dep.asm');
    });

    it.each(['include', 'binclude', 'binary'])('links a .%s path', (directive) => {
        const file = directive === 'binary' ? 'blob.bin' : 'dep.asm';
        expect(buildDocumentLinks(docFor(`        .${directive} "${file}"`))).toHaveLength(1);
    });

    it('does not link a path that does not exist', () => {
        // A broken path staying plain text is the signal that it is broken.
        expect(buildDocumentLinks(docFor('        .include "missing.asm"'))).toEqual([]);
    });

    it('links a path that only resolves through a search path', () => {
        expect(buildDocumentLinks(docFor('        .include "far.asm"'))).toEqual([]);
        const links = buildDocumentLinks(docFor('        .include "far.asm"'), [path.join(dir, 'libs')]);
        expect(links[0].target).toBe(pathToFileURL(path.join(dir, 'libs', 'far.asm')).toString());
    });

    it('links every path in a document, on the right lines', () => {
        const links = buildDocumentLinks(docFor([
            '        .include "dep.asm"',
            'start   lda #1',
            '        .binary "blob.bin"',
        ].join('\n')));
        expect(links.map(l => l.range.start.line)).toEqual([0, 2]);
    });

    it('ignores quoted strings that are not file paths', () => {
        expect(buildDocumentLinks(docFor('        .text "dep.asm"'))).toEqual([]);
    });

    it('returns nothing for a document with no file URI', () => {
        const doc = TextDocument.create('untitled:Untitled-1', '64tass', 1, '        .include "dep.asm"');
        expect(buildDocumentLinks(doc)).toEqual([]);
    });
});
