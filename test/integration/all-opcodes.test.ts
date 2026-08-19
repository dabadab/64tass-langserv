import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument } from '../../src/server/parser';
import { validateDocument } from '../../src/server/diagnostics';
import { DocumentIndex } from '../../src/server/types';

/**
 * The files in test/fixtures/all-opcodes exercise every mnemonic and every
 * addressing form 64tass supports for each CPU, and all of them assemble with
 * zero errors and zero warnings. So anything reported here is a false positive,
 * and any mnemonic not recognised is a hole in the opcode tables.
 *
 * These caught the 6502/6502i mix-up: `--m6502` is the NMOS set with the
 * undocumented opcodes, which `.cpu` spells `6502i`, while `.cpu "6502"` is the
 * documented set - so the tables had 30 undocumented mnemonics on the wrong CPU.
 */
const DIR = path.join(__dirname, '..', 'fixtures', 'all-opcodes');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.asm')).sort();

function indexOf(file: string) {
    const full = path.join(DIR, file);
    const uri = pathToFileURL(full).toString();
    const doc = TextDocument.create(uri, '64tass', 1, fs.readFileSync(full, 'utf-8'));
    // No cpu passed: each file's own `.cpu` directive must be what decides.
    const index = parseDocument(doc);
    const documentIndex = new Map<string, DocumentIndex>([[uri, index]]);
    return { doc, index, documentIndex };
}

describe('all-opcodes fixtures', () => {
    it.each(files)('%s produces no diagnostics at all', (file) => {
        const { doc, index, documentIndex } = indexOf(file);
        const reported = validateDocument(doc, documentIndex, index.caseSensitive)
            .map(d => `L${d.range.start.line + 1} ${d.severity === DiagnosticSeverity.Error ? 'error' : 'warning'}: ${d.message}`);
        expect(reported).toEqual([]);
    });

    it.each(files)('%s picks its CPU up from its own .cpu directive', (file) => {
        const { index } = indexOf(file);
        expect(index.cpu).toBe(path.basename(file, '.asm'));
    });

    it.each(files)('%s indexes no line as a label', (file) => {
        // Every line is an instruction or an anonymous label, so a named label
        // means a mnemonic was not recognised and got read as one instead.
        const { index } = indexOf(file);
        const named = index.labels.filter(l => !l.isAnonymous).map(l => `L${l.range.start.line + 1} ${l.originalName}`);
        expect(named).toEqual([]);
    });
});
