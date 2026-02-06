import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { TASS_EXISTS, compile, parseErrors } from '../helpers/compiler';
import { parseDocument } from '../../src/server/parser';
import { validateDocument } from '../../src/server/diagnostics';
import { DocumentIndex } from '../../src/server/types';

const FIXTURES = path.resolve(__dirname, '../fixtures');

function fixtureDoc(filename: string) {
    const filePath = path.join(FIXTURES, filename);
    const source = fs.readFileSync(filePath, 'utf-8');
    const uri = `file://${filePath}`;
    const doc = TextDocument.create(uri, '64tass', 1, source);
    const index = parseDocument(doc);
    const documentIndex = new Map<string, DocumentIndex>([[doc.uri, index]]);

    // Also parse any includes
    for (const incUri of index.includes) {
        const incPath = incUri.startsWith('file://') ? incUri.slice(7) : incUri;
        if (fs.existsSync(incPath)) {
            const incSource = fs.readFileSync(incPath, 'utf-8');
            const incDoc = TextDocument.create(incUri, '64tass', 1, incSource);
            const incIndex = parseDocument(incDoc);
            documentIndex.set(incUri, incIndex);
        }
    }

    return { doc, index, documentIndex, filePath };
}

function getErrors(doc: TextDocument, documentIndex: Map<string, DocumentIndex>) {
    return validateDocument(doc, documentIndex)
        .filter(d => d.severity === DiagnosticSeverity.Error);
}

describe.skipIf(!TASS_EXISTS)('compiler reference: valid fixtures', () => {
    const validFixtures = [
        'basic-labels.asm',
        'scopes.asm',
        'locals.asm',
        'macros.asm',
        'data-directives.asm',
        'includes-main.asm',
    ];

    for (const fixture of validFixtures) {
        it(`${fixture} compiles cleanly with 64tass`, () => {
            const result = compile(path.join(FIXTURES, fixture));
            expect(result.exitCode, `64tass stderr:\n${result.stderr}`).toBe(0);
        });

        it(`${fixture} produces no Error diagnostics from our validator`, () => {
            const { doc, documentIndex } = fixtureDoc(fixture);
            const errors = getErrors(doc, documentIndex);
            expect(errors, errors.map(e => e.message).join(', ')).toHaveLength(0);
        });
    }
});

describe.skipIf(!TASS_EXISTS)('compiler reference: error fixtures', () => {
    it('errors-duplicates.asm fails with 64tass', () => {
        const result = compile(path.join(FIXTURES, 'errors-duplicates.asm'));
        expect(result.exitCode).not.toBe(0);

        const compilerDiags = parseErrors(result.stderr);
        const errorDiags = compilerDiags.filter(d => d.severity === 'error');
        expect(errorDiags.length).toBeGreaterThanOrEqual(1);
        expect(errorDiags.some(d => d.message.includes('duplicate'))).toBe(true);
    });

    it('errors-duplicates.asm also flagged by our validator', () => {
        const { doc, documentIndex } = fixtureDoc('errors-duplicates.asm');
        const errors = getErrors(doc, documentIndex);
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors.some(e => e.message.includes('Duplicate'))).toBe(true);
    });

    it('errors-unclosed.asm fails with 64tass', () => {
        const result = compile(path.join(FIXTURES, 'errors-unclosed.asm'));
        expect(result.exitCode).not.toBe(0);

        const compilerDiags = parseErrors(result.stderr);
        const errorDiags = compilerDiags.filter(d => d.severity === 'error');
        expect(errorDiags.length).toBeGreaterThanOrEqual(1);
    });

    it('errors-unclosed.asm also flagged by our validator', () => {
        const { doc, documentIndex } = fixtureDoc('errors-unclosed.asm');
        const errors = getErrors(doc, documentIndex);
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors.some(e => e.message.includes('Unclosed'))).toBe(true);
    });
});

describe.skipIf(!TASS_EXISTS)('compiler reference: label agreement', () => {
    it('basic-labels.asm: parser finds same labels compiler would expect', () => {
        const { index } = fixtureDoc('basic-labels.asm');
        const labelNames = index.labels.map(l => l.name);
        // These are the labels defined in the fixture
        expect(labelNames).toContain('start');
        expect(labelNames).toContain('val');
        expect(labelNames).toContain('count');
        expect(labelNames).toContain('table');
        expect(labelNames).toContain('msg');
        expect(labelNames).toContain('ptr');
        expect(labelNames).toContain('loop');
    });

    it('scopes.asm: parser detects nested scope structure', () => {
        const { index } = fixtureDoc('scopes.asm');
        const labelNames = index.labels.map(l => l.name);
        expect(labelNames).toContain('outer');
        expect(labelNames).toContain('inner');
        expect(labelNames).toContain('myblock');
        expect(labelNames).toContain('main');

        // inner should be inside outer scope
        const inner = index.labels.find(l => l.name === 'inner');
        expect(inner?.scopePath).toBe('outer');
    });

    it('locals.asm: parser detects local symbols under correct parents', () => {
        const { index } = fixtureDoc('locals.asm');
        const tmps = index.labels.filter(l => l.name === '_tmp');
        expect(tmps).toHaveLength(2);
        expect(tmps[0].localScope).toBe('first');
        expect(tmps[1].localScope).toBe('second');
    });

    it('macros.asm: parser detects macro parameters', () => {
        const { index } = fixtureDoc('macros.asm');
        expect(index.parametersAtScope.get('load')).toEqual(['value']);
        expect(index.parametersAtScope.get('add2')).toEqual(['a', 'b']);
    });
});
