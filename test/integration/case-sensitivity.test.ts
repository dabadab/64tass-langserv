import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { TASS_EXISTS, compile } from '../helpers/compiler';
import { buildIndex } from '../helpers/doc';
import { validateDocument } from '../../src/server/diagnostics';
import { findSymbolInfo } from '../../src/server/symbols';

/**
 * The extension's caseSensitive setting claims to be "equivalent to the -C flag".
 * These tests check that claim against the real assembler rather than against our
 * own model of it: the same source is assembled with and without -C, and the
 * validator is run in the matching mode. The two must agree on whether a
 * differently-cased reference resolves.
 */
const MIXED_CASE = [
    '        * = $1000',
    'MyLabel nop',
    '        jsr mylabel',
    '        rts',
    ''
].join('\n');

function assembles(source: string, flags: string[]): boolean {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '64tass-case-'));
    try {
        const file = path.join(dir, 'case.asm');
        fs.writeFileSync(file, source);
        return !/error:/.test(compile(file, flags).stderr);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function undefinedSymbols(source: string, caseSensitive: boolean): string[] {
    const { documentIndex, docs } = buildIndex({ source, uri: `file:///case-${caseSensitive}.asm`, caseSensitive });
    return validateDocument(docs[0], documentIndex, caseSensitive)
        .filter(d => d.severity === DiagnosticSeverity.Warning && d.message.includes('Undefined symbol'))
        .map(d => d.message);
}

describe.skipIf(!TASS_EXISTS)('case sensitivity agrees with the assembler', () => {
    it('without -C a differently-cased reference resolves, and we agree', () => {
        expect(assembles(MIXED_CASE, [])).toBe(true);
        expect(undefinedSymbols(MIXED_CASE, false)).toEqual([]);
    });

    it('with -C it does not resolve, and we agree', () => {
        expect(assembles(MIXED_CASE, ['-C'])).toBe(false);
        expect(undefinedSymbols(MIXED_CASE, true).some(m => m.includes('mylabel'))).toBe(true);
    });

    it('exact-case references resolve under -C', () => {
        const source = ['        * = $1000', 'MyLabel nop', '        jsr MyLabel', '        rts', ''].join('\n');
        expect(assembles(source, ['-C'])).toBe(true);
        expect(undefinedSymbols(source, true)).toEqual([]);
    });

    it('distinct symbols differing only by case are distinct under -C', () => {
        // Legal with -C (two different symbols), a duplicate without it
        const source = ['        * = $1000', 'Foo = 1', 'foo = 2', '        lda #Foo', '        lda #foo', '        rts', ''].join('\n');
        expect(assembles(source, ['-C'])).toBe(true);
        expect(assembles(source, [])).toBe(false);

        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///distinct.asm', caseSensitive: true });
        expect(findSymbolInfo('Foo', docs[0].uri, 3, documentIndex, true)!.value).toBe('1');
        expect(findSymbolInfo('foo', docs[0].uri, 4, documentIndex, true)!.value).toBe('2');

        // ...and we flag the duplicate in the case-insensitive mode, as 64tass does
        const insensitive = buildIndex({ source, uri: 'file:///dup.asm', caseSensitive: false });
        const errs = validateDocument(insensitive.docs[0], insensitive.documentIndex, false)
            .filter(d => d.severity === DiagnosticSeverity.Error);
        expect(errs.some(e => e.message.includes('Duplicate'))).toBe(true);
    });
});
