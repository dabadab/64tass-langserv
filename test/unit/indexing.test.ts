import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { indexDocument, clearIncludeRefs, settleBareWords, IndexContext } from '../../src/server/indexing';
import { IncludeGraph } from '../../src/server/includes';
import { DocumentIndex } from '../../src/server/types';
import { DEFAULT_CPU } from '../../src/server/constants';

/**
 * A fake workspace: files on disk plus a set of "open" documents whose buffers
 * may differ from disk, mirroring what the editor gives the server.
 */
function makeContext(disk: Record<string, string>, open: Record<string, string> = {}, defaultCaseSensitive = false, includeDirs: string[] = []) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '64tass-idx-'));
    const uriOf = (name: string) => pathToFileURL(path.join(dir, name)).toString();

    for (const [name, content] of Object.entries(disk)) {
        const full = path.join(dir, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
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
        defaultCpu: DEFAULT_CPU,
        defaultCpuExplicit: false,
        includePaths: includeDirs.map(d => path.join(dir, d)),
    };

    return {
        context, uriOf, dir,
        docFor: (name: string) => openDocs.get(uriOf(name))
            ?? TextDocument.create(uriOf(name), '64tass', 1, fs.readFileSync(path.join(dir, name), 'utf-8')),
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    };
}

describe('.binclude scoping', () => {
    it('puts a bincluded file\'s symbols in the label\'s scope, not the global one', () => {
        const w = makeContext({
            'main.asm': '        * = $1000\nlib     .binclude "dep.asm"',
            'dep.asm': 'inner   .byte 1',
        });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const dep = w.context.documentIndex.get(w.uriOf('dep.asm'))!;
            expect(dep.labels.find(l => l.name === 'inner')?.scopePath).toBe('lib');
        } finally { w.cleanup(); }
    });

    it('indexes the .binclude label itself as a block scope', () => {
        const w = makeContext({
            'main.asm': 'lib     .binclude "dep.asm"',
            'dep.asm': 'inner   .byte 1',
        });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const main = w.context.documentIndex.get(w.uriOf('main.asm'))!;
            const label = main.labels.find(l => l.name === 'lib');
            expect(label?.kind).toBe('block');
            expect(label?.scopePath).toBeNull();
        } finally { w.cleanup(); }
    });

    it('nests, so a .binclude inside a .binclude gets the full path', () => {
        const w = makeContext({
            'main.asm': 'lib     .binclude "mid.asm"',
            'mid.asm': 'sub     .binclude "dep.asm"',
            'dep.asm': 'inner   .byte 1',
        });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const dep = w.context.documentIndex.get(w.uriOf('dep.asm'))!;
            expect(dep.labels.find(l => l.name === 'inner')?.scopePath).toBe('lib.sub');
        } finally { w.cleanup(); }
    });

    it('adds the enclosing scope, so a .binclude inside a .block nests under it', () => {
        const w = makeContext({
            'main.asm': 'outer   .block\nlib     .binclude "dep.asm"\n        .bend',
            'dep.asm': 'inner   .byte 1',
        });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const dep = w.context.documentIndex.get(w.uriOf('dep.asm'))!;
            expect(dep.labels.find(l => l.name === 'inner')?.scopePath).toBe('outer.lib');
        } finally { w.cleanup(); }
    });

    it('carries the scope through a plain .include below a .binclude', () => {
        // .include is textual, so a file pulled in that way stays in the scope the
        // .binclude opened (verified against the assembler).
        const w = makeContext({
            'main.asm': 'lib     .binclude "mid.asm"',
            'mid.asm': '        .include "dep.asm"',
            'dep.asm': 'inner   .byte 1',
        });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const dep = w.context.documentIndex.get(w.uriOf('dep.asm'))!;
            expect(dep.labels.find(l => l.name === 'inner')?.scopePath).toBe('lib');
        } finally { w.cleanup(); }
    });

    it('leaves a plain .include in the global scope', () => {
        const w = makeContext({
            'main.asm': '        .include "dep.asm"',
            'dep.asm': 'inner   .byte 1',
        });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const dep = w.context.documentIndex.get(w.uriOf('dep.asm'))!;
            expect(dep.labels.find(l => l.name === 'inner')?.scopePath).toBeNull();
        } finally { w.cleanup(); }
    });

    it('keeps an unlabelled .binclude out of the global scope', () => {
        // The assembler opens an unnameable scope, so its symbols are unreachable
        // from outside - a synthetic scope name reproduces that.
        const w = makeContext({
            'main.asm': '        .binclude "dep.asm"',
            'dep.asm': 'inner   .byte 1',
        });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const dep = w.context.documentIndex.get(w.uriOf('dep.asm'))!;
            expect(dep.labels.find(l => l.name === 'inner')?.scopePath).not.toBeNull();
            expect(w.context.documentIndex.get(w.uriOf('main.asm'))!.labels).toHaveLength(0);
        } finally { w.cleanup(); }
    });
});

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

describe('include search paths', () => {
    it('does not resolve an include that is not next to the includer', () => {
        const w = makeContext({
            'main.asm': '        .include "thing.asm"',
            'libs/thing.asm': 'libsym = 1',
        });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            expect(w.context.documentIndex.has(w.uriOf('libs/thing.asm'))).toBe(false);
        } finally { w.cleanup(); }
    });

    it('resolves it once the directory is a search path', () => {
        const w = makeContext({
            'main.asm': '        .include "thing.asm"',
            'libs/thing.asm': 'libsym = 1',
        }, {}, false, ['libs']);
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const dep = w.context.documentIndex.get(w.uriOf('libs/thing.asm'));
            expect(dep?.labels.map(l => l.name)).toContain('libsym');
        } finally { w.cleanup(); }
    });

    it('searches the includer\'s own directory before the search paths', () => {
        // 64tass tries the includer's directory first (verified), so a local file
        // wins over a same-named one on the search path.
        const w = makeContext({
            'main.asm': '        .include "thing.asm"',
            'thing.asm': 'local_wins = 1',
            'libs/thing.asm': 'search_path_wins = 1',
        }, {}, false, ['libs']);
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            expect(w.context.documentIndex.has(w.uriOf('thing.asm'))).toBe(true);
            expect(w.context.documentIndex.has(w.uriOf('libs/thing.asm'))).toBe(false);
        } finally { w.cleanup(); }
    });

    it('tries search paths in order', () => {
        const w = makeContext({
            'main.asm': '        .include "thing.asm"',
            'a/thing.asm': 'first = 1',
            'b/thing.asm': 'second = 1',
        }, {}, false, ['a', 'b']);
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            expect(w.context.documentIndex.has(w.uriOf('a/thing.asm'))).toBe(true);
            expect(w.context.documentIndex.has(w.uriOf('b/thing.asm'))).toBe(false);
        } finally { w.cleanup(); }
    });

    it('applies to .binclude as well, keeping its scope', () => {
        const w = makeContext({
            'main.asm': 'lib     .binclude "thing.asm"',
            'libs/thing.asm': 'inner   .byte 1',
        }, {}, false, ['libs']);
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const dep = w.context.documentIndex.get(w.uriOf('libs/thing.asm'))!;
            expect(dep.labels.find(l => l.name === 'inner')?.scopePath).toBe('lib');
        } finally { w.cleanup(); }
    });
});

describe('a bare word that names a macro', () => {
    // Verified: with `inc_d020 .macro` in scope, a bare `inc_d020` on its own line
    // assembles to the macro's bytes, and `jmp inc_d020` is "can't get integer
    // value of macro" - it is a call, not a label. Which macros exist is only
    // known once the include tree is read, hence the pass after indexing.
    const MACRO = 'inc_d020 .macro\n        inc $d020\n        .endm';

    it('is not indexed as a label when the macro comes from an include', () => {
        const w = makeContext({
            'main.asm': '        .include "macros.inc"\nstart\n        inc_d020\n        rts',
            'macros.inc': MACRO,
        });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const main = w.context.documentIndex.get(w.uriOf('main.asm'))!;
            expect(main.labels.map(l => l.name)).toEqual(['start']);
            expect(main.labelsByName.has('inc_d020')).toBe(false);
        } finally { w.cleanup(); }
    });

    it('is not indexed as a label when the macro is in the same file', () => {
        const w = makeContext({ 'main.asm': `${MACRO}\nstart\n        inc_d020` });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const labels = w.context.documentIndex.get(w.uriOf('main.asm'))!.labels;
            expect(labels.filter(l => l.name === 'inc_d020').map(l => l.kind)).toEqual(['macro']);
        } finally { w.cleanup(); }
    });

    it('leaves a bare word alone when nothing of the name is callable', () => {
        const w = makeContext({ 'main.asm': 'start\n        rts\nloop\n        jmp loop' });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            expect(w.context.documentIndex.get(w.uriOf('main.asm'))!.labels.map(l => l.name))
                .toEqual(['start', 'loop']);
        } finally { w.cleanup(); }
    });

    it('keeps a definition that says so with a colon', () => {
        // `inc_d020:` is a label definition whatever else exists - and one the
        // assembler then rejects as a duplicate, which is a different report.
        const w = makeContext({ 'main.asm': `${MACRO}\ninc_d020:\n        rts` });
        try {
            indexDocument(w.docFor('main.asm'), w.context);
            const kinds = w.context.documentIndex.get(w.uriOf('main.asm'))!
                .labels.filter(l => l.name === 'inc_d020').map(l => l.kind);
            expect(kinds).toEqual(['macro', 'code']);
        } finally { w.cleanup(); }
    });
});

describe('what the workspace scan records', () => {
    // The scan shares one indexedUris set across every file, which no other test
    // does - and that is the only way scanWorkspace ever runs indexDocument.
    function scan(w: ReturnType<typeof makeContext>, order: string[]) {
        const scanned = new Set<string>();
        for (const name of order) {
            const uri = w.uriOf(name);
            if (scanned.has(uri) || w.context.documentIndex.has(uri)) continue;
            indexDocument(w.docFor(name), w.context, scanned, uri);
        }
        return scanned;
    }

    const TREE = {
        'main.asm': '        .include "lib.inc"\nmain_sym rts\n        jsr deep',
        'main2.asm': '        .include "lib.inc"\nmain_sym2 rts\n        jsr deep',
        'lib.inc': '        .include "sub.inc"\nlib     nop',
        'sub.inc': 'deep    jsr main_sym',
    };

    it.each([
        ['includes first', ['lib.inc', 'sub.inc', 'main.asm', 'main2.asm']],
        ['roots first', ['main.asm', 'main2.asm', 'lib.inc', 'sub.inc']],
    ])('attributes a two-level tree to every root, scanning %s', (_name, order) => {
        // The deep include was attributed to whichever file the directory listing
        // reached first, so its compilation unit depended on disk order.
        const w = makeContext(TREE);
        try {
            scan(w, order);
            const unit = w.context.includeGraph.compilationUnit(w.uriOf('sub.inc'));
            expect([...unit].sort()).toEqual([
                w.uriOf('lib.inc'), w.uriOf('main.asm'), w.uriOf('main2.asm'), w.uriOf('sub.inc'),
            ].sort());
            expect(w.context.includeGraph.rootsFor(w.uriOf('sub.inc'))).toContain(w.uriOf('main2.asm'));
        } finally { w.cleanup(); }
    });

    it('settles bare words per program, not across the workspace', () => {
        // A macro called `wait` in one program used to delete the code label
        // `wait` in another that never includes it - and re-opening the file
        // brought it back, so the behaviour flipped per session.
        const w = makeContext({
            'a.asm': 'wait    .macro\n        nop\n        .endm',
            'b.asm': 'wait\n        dex\n        jsr wait',
        });
        try {
            const scanned = scan(w, ['a.asm', 'b.asm']);
            settleBareWords(scanned, w.context.documentIndex,
                uri => w.context.includeGraph.compilationUnit(uri));
            expect(w.context.documentIndex.get(w.uriOf('b.asm'))!.labels.map(l => l.name)).toEqual(['wait']);
        } finally { w.cleanup(); }
    });

    it('still drops one the same program defines', () => {
        const w = makeContext({
            'main.asm': '        .include "m.inc"\nwait\n        dex',
            'm.inc': 'wait    .macro\n        nop\n        .endm',
        });
        try {
            const scanned = scan(w, ['main.asm', 'm.inc']);
            settleBareWords(scanned, w.context.documentIndex,
                uri => w.context.includeGraph.compilationUnit(uri));
            expect(w.context.documentIndex.get(w.uriOf('main.asm'))!.labels.map(l => l.name)).toEqual([]);
        } finally { w.cleanup(); }
    });
});
