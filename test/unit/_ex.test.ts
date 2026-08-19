import { it } from 'vitest';
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
const DIR = path.join(__dirname, '..', 'fixtures', '64tass-examples');
it('examples', () => {
    for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.asm')).sort()) {
        const full = path.join(DIR, f);
        const uri = pathToFileURL(full).toString();
        const doc = TextDocument.create(uri, '64tass', 1, fs.readFileSync(full, 'utf-8'));
        const documentIndex = new Map<string, DocumentIndex>();
        const context: IndexContext = {
            documentIndex, includeGraph: new IncludeGraph(),
            getOpenDocument: () => undefined,
            getDocumentText: (u) => { try { return fs.readFileSync(new URL(u), 'utf-8'); } catch { return null; } },
            defaultCaseSensitive: false, defaultCpu: DEFAULT_CPU, includePaths: [],
        };
        indexDocument(doc, context);
        const ds = validateDocument(doc, documentIndex, documentIndex.get(uri)!.caseSensitive);
        console.log(`--- ${f}  (${ds.length})`);
        for (const d of ds) console.log(`    L${d.range.start.line + 1} ${d.severity === DiagnosticSeverity.Error ? 'ERR ' : 'warn'} ${d.message}`);
    }
});
