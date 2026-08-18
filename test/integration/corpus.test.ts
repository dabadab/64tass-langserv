import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument } from '../../src/server/parser';
import { validateDocument } from '../../src/server/diagnostics';
import { detectCaseSensitivityPragma } from '../../src/server/utils';
import { DocumentIndex } from '../../src/server/types';
import { TASS_EXISTS, compile } from '../helpers/compiler';

const CORPUS = path.join(__dirname, '..', 'fixtures', 'corpus');

/** Extra 64tass flags a fixture needs to assemble (mirrors its define pragmas). */
const COMPILE_FLAGS: Record<string, string[]> = {
    'conditionals.asm': ['-D', 'linking=0'],
};

const files = fs.readdirSync(CORPUS).filter(f => f.endsWith('.asm')).sort();

/** Index a document together with its include tree, as the server does. */
function indexTree(doc: TextDocument, index: Map<string, DocumentIndex>, seen: Set<string>, inherited: boolean, baseScope: string | null = null) {
    if (seen.has(doc.uri)) return;
    seen.add(doc.uri);
    const effective = detectCaseSensitivityPragma(doc.getText()) ?? inherited;
    const parsed = parseDocument(doc, effective, undefined, undefined, baseScope);
    index.set(doc.uri, parsed);
    for (const includeUri of parsed.includes) {
        if (seen.has(includeUri)) continue;
        try {
            const content = fs.readFileSync(new URL(includeUri), 'utf-8');
            const childScope = parsed.includeScopes.get(includeUri) ?? baseScope;
            indexTree(TextDocument.create(includeUri, '64tass', 1, content), index, seen, effective, childScope);
        } catch { /* unreadable include */ }
    }
}

function diagnose(file: string) {
    const full = path.join(CORPUS, file);
    const uri = pathToFileURL(full).toString();
    const doc = TextDocument.create(uri, '64tass', 1, fs.readFileSync(full, 'utf-8'));
    const index = new Map<string, DocumentIndex>();
    indexTree(doc, index, new Set(), true);
    return validateDocument(doc, index, index.get(uri)!.caseSensitive);
}

describe('corpus: fixtures assemble cleanly', () => {
    it('has fixtures to check', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    // Guards the premise of this whole suite. Without it a fixture could stop
    // assembling and the zero-error assertions below would still pass, proving
    // nothing. Skips (loudly, see T4) when the assembler is unavailable.
    it.skipIf(!TASS_EXISTS).each(files)('%s is accepted by 64tass', (file) => {
        const result = compile(path.join(CORPUS, file), ['-C', ...(COMPILE_FLAGS[file] ?? [])]);
        expect(result.stderr).not.toMatch(/error:/);
        expect(result.exitCode).toBe(0);
    });
});

describe('corpus: no false positives', () => {
    // The headline assertion: code the assembler accepts must produce no Errors.
    it.each(files)('%s produces no error diagnostics', (file) => {
        const errors = diagnose(file).filter(d => d.severity === DiagnosticSeverity.Error);
        expect(errors.map(e => `L${e.range.start.line + 1}: ${e.message}`)).toEqual([]);
    });

    // Warnings are a budget rather than zero: some genuinely need a workspace scan
    // to resolve. Tightening this number as things improve is the point.
    it('keeps the total warning count within budget', () => {
        const BUDGET = 0;
        const total = files.reduce(
            (sum, f) => sum + diagnose(f).filter(d => d.severity === DiagnosticSeverity.Warning).length, 0);
        expect(total).toBeLessThanOrEqual(BUDGET);
    });
});
