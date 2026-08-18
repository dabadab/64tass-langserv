import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { indexDocument, clearIncludeRefs, IndexContext } from '../../src/server/indexing';
import { IncludeGraph } from '../../src/server/includes';
import { DocumentIndex } from '../../src/server/types';

/**
 * A fake workspace: files on disk plus a set of "open" documents whose buffers
 * may differ from disk, mirroring what the editor gives the server.
 */
function makeContext(disk: Record<string, string>, open: Record<string, string> = {}, defaultCaseSensitive = false) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '64tass-idx-'));
    const uriOf = (name: string) => pathToFileURL(path.join(dir, name)).toString();

    for (const [name, content] of Object.entries(disk)) {
        fs.writeFileSync(path.join(dir, name), content);
    }
    const openDocs = new Map<string, TextDocument>();
    for (const [name, content] of Object.entries(open)) {
        openDocs.set(uriOf(name), TextDocument.create(uriOf(name), '64tass', 1, content));
    }

    const context: IndexContext = {
        documentIndex: new Map<string, DocumentIndex>(),
        includeGraph: new IncludeGraph(),
        getOpenDocument: (uri) => openDocs.get(uri),
        getDocumentText: (uri) => {
            const doc = openDocs.get(uri);
            if (doc) return doc.getText();
            try { return fs.readFileSync(new URL(uri), 'utf-8'); } catch { return null; }
        },
        defaultCaseSensitive,
    };

    return {
        context, uriOf, dir,
        docFor: (name: string) => openDocs.get(uriOf(name))
            ?? TextDocument.create(uriOf(name), '64tass', 1, fs.readFileSync(path.join(dir, name), 'utf-8')),
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    };
}

describe('indexDocument', () => {
    it('indexes a document and the files it includes', () => {
        const w = makeContext({
            'main.asm': '        .include "dep.asm"\nmain\n        rts',
            'dep.asm': 'depsym = 1',
        });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            expect([...w.context.documentIndex.keys()].sort())
                .toEqual([w.uriOf('dep.asm'), w.uriOf('main.asm')].sort());
        } finally { w.cleanup(); }
    });

    it('records the include reference against the root', () => {
        const w = makeContext({
            'main.asm': '        .include "dep.asm"',
            'dep.asm': 'depsym = 1',
        });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            expect(w.context.includeGraph.rootsFor(w.uriOf('dep.asm'))).toEqual([w.uriOf('main.asm')]);
        } finally { w.cleanup(); }
    });

    it('indexes transitively', () => {
        const w = makeContext({
            'a.asm': '        .include "b.asm"',
            'b.asm': '        .include "c.asm"',
            'c.asm': 'deep = 1',
        });
        try {
            indexDocument(w.docFor('a.asm'), w.context);
            expect(w.context.documentIndex.has(w.uriOf('c.asm'))).toBe(true);
            // every level is attributed to the original root
            expect(w.context.includeGraph.rootsFor(w.uriOf('c.asm'))).toEqual([w.uriOf('a.asm')]);
        } finally { w.cleanup(); }
    });

    it('terminates on a circular include', () => {
        const w = makeContext({
            'a.asm': '        .include "b.asm"',
            'b.asm': '        .include "a.asm"',
        });
        try {
            expect(() => indexDocument(w.docFor('a.asm'), w.context)).not.toThrow();
            expect(w.context.documentIndex.size).toBe(2);
        } finally { w.cleanup(); }
    });

    it('survives an include that cannot be read', () => {
        const w = makeContext({ 'main.asm': '        .include "missing.asm"\nmain' });
        try {
            expect(() => indexDocument(w.docFor('main.asm'), w.context)).not.toThrow();
            expect(w.context.documentIndex.has(w.uriOf('main.asm'))).toBe(true);
        } finally { w.cleanup(); }
    });

    // L3: an include open with unsaved edits must not be re-read from disk
    it('indexes an open include from its buffer, not from disk', () => {
        const w = makeContext(
            { 'main.asm': '        .include "dep.asm"', 'dep.asm': 'ondisk = 1' },
            { 'dep.asm': 'inbuffer = 1' }
        );
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const names = w.context.documentIndex.get(w.uriOf('dep.asm'))!.labels.map(l => l.name);
            expect(names).toContain('inbuffer');
            expect(names).not.toContain('ondisk');
        } finally { w.cleanup(); }
    });
});

describe('indexDocument - case sensitivity cascade', () => {
    it('applies the workspace default when no pragma is present', () => {
        const w = makeContext({ 'main.asm': 'MyLabel' }, {}, true);
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            expect(w.context.documentIndex.get(w.uriOf('main.asm'))!.caseSensitive).toBe(true);
            expect(w.context.documentIndex.get(w.uriOf('main.asm'))!.labels[0].name).toBe('MyLabel');
        } finally { w.cleanup(); }
    });

    it('a pragma in the root overrides the default for the whole include tree', () => {
        const w = makeContext({
            'main.asm': '; 64tass-langserv: case-sensitive\n        .include "dep.asm"',
            'dep.asm': 'DepLabel',
        }, {}, false);
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            // the include inherits the root's pragma
            expect(w.context.documentIndex.get(w.uriOf('dep.asm'))!.caseSensitive).toBe(true);
            expect(w.context.documentIndex.get(w.uriOf('dep.asm'))!.labels[0].name).toBe('DepLabel');
        } finally { w.cleanup(); }
    });

    it('a pragma in an include overrides only from there down', () => {
        const w = makeContext({
            'main.asm': 'RootLabel\n        .include "dep.asm"',
            'dep.asm': '; 64tass-langserv: case-sensitive\nDepLabel',
        }, {}, false);
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            expect(w.context.documentIndex.get(w.uriOf('main.asm'))!.caseSensitive).toBe(false);
            expect(w.context.documentIndex.get(w.uriOf('dep.asm'))!.caseSensitive).toBe(true);
        } finally { w.cleanup(); }
    });
});

describe('clearIncludeRefs', () => {
    // L2: closing one document must not strip an include another still uses
    it('keeps an include that another root still references', () => {
        const w = makeContext({
            'a.asm': '        .include "shared.asm"',
            'b.asm': '        .include "shared.asm"',
            'shared.asm': 'shared = 1',
        });
        try {
            indexDocument(w.docFor('a.asm'), w.context);
            indexDocument(w.docFor('b.asm'), w.context);

            clearIncludeRefs(w.uriOf('a.asm'), w.context);
            expect(w.context.documentIndex.has(w.uriOf('shared.asm'))).toBe(true);

            clearIncludeRefs(w.uriOf('b.asm'), w.context);
            expect(w.context.documentIndex.has(w.uriOf('shared.asm'))).toBe(false);
        } finally { w.cleanup(); }
    });

    it('keeps an orphaned include that is open in its own right', () => {
        const w = makeContext(
            { 'main.asm': '        .include "dep.asm"', 'dep.asm': 'dep = 1' },
            { 'dep.asm': 'dep = 1' }
        );
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            clearIncludeRefs(w.uriOf('main.asm'), w.context);
            // no root includes it any more, but the editor still has it open
            expect(w.context.documentIndex.has(w.uriOf('dep.asm'))).toBe(true);
        } finally { w.cleanup(); }
    });
});

describe('indexDocument - text access', () => {
    // L3's real guarantee after extraction: indexing cannot reach the filesystem
    // itself, so an include's content can only come from getDocumentText - which
    // is contractually required to prefer the open buffer.
    it('reads include content only through getDocumentText', () => {
        const w = makeContext({
            'main.asm': '        .include "dep.asm"',
            'dep.asm': 'ondisk = 1',
        });
        try {
            const asked: string[] = [];
            const spied: IndexContext = {
                ...w.context,
                getDocumentText: (uri) => { asked.push(uri); return 'fromaccessor = 1'; },
                getOpenDocument: () => undefined,
            };
            indexDocument(w.docFor('main.asm'), spied);

            expect(asked).toContain(w.uriOf('dep.asm'));
            // the on-disk content was never used
            const names = spied.documentIndex.get(w.uriOf('dep.asm'))!.labels.map(l => l.name);
            expect(names).toEqual(['fromaccessor']);
        } finally { w.cleanup(); }
    });

    it('reuses the open TextDocument when there is one', () => {
        const w = makeContext(
            { 'main.asm': '        .include "dep.asm"', 'dep.asm': 'ondisk = 1' },
            { 'dep.asm': 'inbuffer = 1' }
        );
        try {
            let textAccessorCalls = 0;
            const spied: IndexContext = {
                ...w.context,
                getDocumentText: (uri) => { textAccessorCalls++; return w.context.getDocumentText(uri); },
            };
            indexDocument(w.docFor('main.asm'), spied);

            expect(spied.documentIndex.get(w.uriOf('dep.asm'))!.labels.map(l => l.name)).toEqual(['inbuffer']);
            expect(textAccessorCalls).toBe(0); // the open document was used directly
        } finally { w.cleanup(); }
    });
});
