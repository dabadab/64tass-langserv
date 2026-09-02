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

/**
 * The target a file is written for, where it is not the default. These are the
 * flags the source needs to assemble at all - `45gs02-compatibility.asm` is a
 * pile of 45GS02 mnemonics and says so nowhere in its text - and a user opening
 * one would supply the same fact through `64tass.cpu` or a cpu pragma. Now that
 * CPU-dependent checks are judged against the target in force rather than only a
 * declared one, the suite has to supply it too.
 */
const FILE_CPU: Record<string, string> = {
    '45gs02-compatibility.asm': '45gs02',
};

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
        defaultCpu: FILE_CPU[file] ?? DEFAULT_CPU,
        defaultCpuExplicit: file in FILE_CPU,
        includePaths: [],
    };
    indexDocument(doc, context);
    return validateDocument(doc, documentIndex, documentIndex.get(uri)!.caseSensitive)
        .map(d => `L${d.range.start.line + 1} ${d.severity === DiagnosticSeverity.Error ? 'error' : 'warning'}: ${d.message}`);
}

/**
 * Nothing is expected any more: `loading_a_sid_file` used to report `music.init`
 * and `music.play`, because its `loadsid` builds the result with dotted
 * assignments (`_sid.init = ...`) that were indexed nowhere at all.
 */
const KNOWN_GAPS: Record<string, string[]> = {};

describe('64tass example sources', () => {
    it.each(files)('%s produces no unexpected diagnostics', (file) => {
        expect(diagnose(file)).toEqual(KNOWN_GAPS[file] ?? []);
    });

    it('reports nothing at all in any of them', () => {
        for (const file of files) expect(diagnose(file), file).toEqual([]);
    });
});
