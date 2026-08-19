import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { indexDocument, IndexContext } from '../../src/server/indexing';
import { IncludeGraph } from '../../src/server/includes';
import { validateDocument } from '../../src/server/diagnostics';
import { DocumentIndex } from '../../src/server/types';
import { DEFAULT_CPU } from '../../src/server/constants';

/**
 * Real sources from the 64tass distribution. They are valid assembly - the only
 * complaints 64tass itself has are about binary data files that ship separately
 * (map.ctm, picture.kla, music.sid) and one deliberate `.warn` - so anything
 * reported here is a false positive.
 *
 * Between them they exercise the metaprogramming the hand-written fixtures do
 * not: for-in loops, typed function parameters, dict literals, `.comment`
 * blocks, compound assignment, and labels whose members come from a macro or a
 * function's returned namespace. Each of those was a bug these files found.
 */
const DIR = path.join(__dirname, '..', 'fixtures', '64tass-examples');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.asm')).sort();

/** Index a file with its include tree, exactly as the server does. */
function diagnose(file: string) {
    const full = path.join(DIR, file);
    const uri = pathToFileURL(full).toString();
    const doc = TextDocument.create(uri, '64tass', 1, fs.readFileSync(full, 'utf-8'));
    const documentIndex = new Map<string, DocumentIndex>();
    const context: IndexContext = {
        documentIndex,
        includeGraph: new IncludeGraph(),
        getOpenDocument: () => undefined,
        getDocumentText: (u) => {
            try { return fs.readFileSync(new URL(u), 'utf-8'); } catch { return null; }
        },
        defaultCaseSensitive: false,
        defaultCpu: DEFAULT_CPU,
        includePaths: [],
    };
    indexDocument(doc, context);
    return validateDocument(doc, documentIndex, documentIndex.get(uri)!.caseSensitive)
        .map(d => `L${d.range.start.line + 1} ${d.severity === DiagnosticSeverity.Error ? 'error' : 'warning'}: ${d.message}`);
}

/**
 * The one construct still unmodelled: loading_a_sid_file's `loadsid` builds its
 * result by assigning `_sid.init` and `_sid.play` inside the function and
 * returning `_sid`, so the members belong to a local namespace rather than to
 * the function's own scope. Listed rather than skipped, so the file is still
 * checked for everything else and this shrinks visibly when it is fixed.
 */
const KNOWN_GAPS: Record<string, string[]> = {
    'loading_a_sid_file.asm': [
        "L57 warning: Undefined symbol 'music.init'",
        "L63 warning: Undefined symbol 'music.play'",
    ],
};

describe('64tass example sources', () => {
    it.each(files)('%s produces no unexpected diagnostics', (file) => {
        expect(diagnose(file)).toEqual(KNOWN_GAPS[file] ?? []);
    });

    it('reports nothing at all in most of them', () => {
        const clean = files.filter(f => !(f in KNOWN_GAPS));
        expect(clean.length).toBeGreaterThanOrEqual(7);
        for (const file of clean) expect(diagnose(file), file).toEqual([]);
    });
});
