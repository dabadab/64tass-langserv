import { it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument } from '../../src/server/parser';
import { validateDocument } from '../../src/server/diagnostics';
import { DocumentIndex } from '../../src/server/types';
const DIR = path.join(__dirname, '..', 'fixtures', '64tass-examples');
it('examples', () => {
    for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.asm')).sort()) {
        const full = path.join(DIR, f);
        const uri = pathToFileURL(full).toString();
        const doc = TextDocument.create(uri, '64tass', 1, fs.readFileSync(full, 'utf-8'));
        const index = parseDocument(doc);
        const di = new Map<string, DocumentIndex>([[uri, index]]);
        const ds = validateDocument(doc, di, index.caseSensitive);
        console.log(`--- ${f}  (${ds.length}) cpu=${index.cpu}`);
        for (const d of ds) console.log(`    L${d.range.start.line + 1} ${d.severity === DiagnosticSeverity.Error ? 'ERR ' : 'warn'} ${d.message}`);
    }
});
