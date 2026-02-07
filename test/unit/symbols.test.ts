import { describe, it, expect } from 'vitest';
import { Position } from 'vscode-languageserver/node';
import { getWordAtPosition, findSymbolInfo, findDefinition, isParameter, findAnonymousLabel } from '../../src/server/symbols';
import { DocumentIndex } from '../../src/server/types';
import { createDoc, buildIndex } from '../helpers/doc';

describe('getWordAtPosition', () => {
    it('returns word at start of line', () => {
        const doc = createDoc('label lda #1');
        expect(getWordAtPosition(doc, Position.create(0, 0))).toBe('label');
    });

    it('returns word when cursor is in the middle', () => {
        const doc = createDoc('label lda #1');
        expect(getWordAtPosition(doc, Position.create(0, 2))).toBe('label');
    });

    it('returns opcode', () => {
        const doc = createDoc('label lda #1');
        expect(getWordAtPosition(doc, Position.create(0, 7))).toBe('lda');
    });

    it('returns dotted reference', () => {
        const doc = createDoc('        lda scope.label');
        expect(getWordAtPosition(doc, Position.create(0, 15))).toBe('scope.label');
    });

    it('returns null on whitespace', () => {
        const doc = createDoc('a   b');
        expect(getWordAtPosition(doc, Position.create(0, 2))).toBeNull();
    });

    it('returns null on empty line', () => {
        const doc = createDoc('');
        expect(getWordAtPosition(doc, Position.create(0, 0))).toBeNull();
    });

    it('returns underscore word', () => {
        const doc = createDoc('_local');
        expect(getWordAtPosition(doc, Position.create(0, 0))).toBe('_local');
    });
});

describe('findSymbolInfo', () => {
    it('finds global symbol', () => {
        const { documentIndex, docs } = buildIndex({ source: 'start\n        lda #1' });
        const result = findSymbolInfo('start', docs[0].uri, 1, documentIndex);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('start');
    });

    it('finds symbol case-insensitively', () => {
        const { documentIndex, docs } = buildIndex({ source: 'MyLabel\n        lda #1' });
        const result = findSymbolInfo('mylabel', docs[0].uri, 1, documentIndex);
        expect(result).not.toBeNull();
        expect(result!.originalName).toBe('MyLabel');
    });

    it('finds symbol inside scope', () => {
        const { documentIndex, docs } = buildIndex({
            source: 's .proc\ninner\n        lda #1\n.pend'
        });
        const result = findSymbolInfo('inner', docs[0].uri, 2, documentIndex);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('inner');
    });

    it('resolves parent scope (inner sees outer labels)', () => {
        const { documentIndex, docs } = buildIndex({
            source: 'glob\ns .proc\n        lda #1\n.pend'
        });
        // From inside the proc (line 2), should find global 'glob'
        const result = findSymbolInfo('glob', docs[0].uri, 2, documentIndex);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('glob');
    });

    it('finds local symbol in same localScope', () => {
        const { documentIndex, docs } = buildIndex({
            source: 'main\n_loc = 1\n        lda #_loc'
        });
        const result = findSymbolInfo('_loc', docs[0].uri, 2, documentIndex);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('_loc');
    });

    it('does not find local symbol from different localScope', () => {
        const { documentIndex, docs } = buildIndex({
            source: 'a\n_x = 1\nb\n        lda #_x'
        });
        // Line 3 is under localScope 'b', but _x is defined under localScope 'a'
        const result = findSymbolInfo('_x', docs[0].uri, 3, documentIndex);
        expect(result).toBeNull();
    });

    it('strips leading dot for macro calls', () => {
        const { documentIndex, docs } = buildIndex({
            source: 'm .macro\n.endm\n        .m'
        });
        const result = findSymbolInfo('.m', docs[0].uri, 2, documentIndex);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('m');
    });

    it('resolves dotted scope reference', () => {
        const { documentIndex, docs } = buildIndex({
            source: 's .proc\nx\n.pend\n        nop'
        });
        const result = findSymbolInfo('s.x', docs[0].uri, 3, documentIndex);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('x');
    });

    it('resolves cross-document symbols', () => {
        const { documentIndex, docs } = buildIndex(
            { source: 'main\n        lda #val', uri: 'file:///main.asm' },
            { source: 'val = 42', uri: 'file:///dep.asm' }
        );
        const result = findSymbolInfo('val', docs[0].uri, 1, documentIndex);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('val');
        expect(result!.uri).toBe('file:///dep.asm');
    });

    it('returns null for undefined symbol', () => {
        const { documentIndex, docs } = buildIndex({ source: 'start\n        lda #1' });
        const result = findSymbolInfo('nonexistent', docs[0].uri, 1, documentIndex);
        expect(result).toBeNull();
    });
});

describe('findDefinition', () => {
    it('returns Location for defined symbol', () => {
        const { documentIndex, docs } = buildIndex({ source: 'start\n        lda #1' });
        const result = findDefinition('start', docs[0].uri, 1, documentIndex);
        expect(result).not.toBeNull();
        expect(result!.uri).toBe(docs[0].uri);
        expect(result!.range.start.line).toBe(0);
    });

    it('returns null for undefined symbol', () => {
        const { documentIndex, docs } = buildIndex({ source: 'start\n        lda #1' });
        const result = findDefinition('undef', docs[0].uri, 1, documentIndex);
        expect(result).toBeNull();
    });
});

describe('isParameter', () => {
    it('returns true for direct parameter match', () => {
        const index: DocumentIndex = {
            labels: [],
            scopeAtLine: new Map(),
            parametersAtScope: new Map([['m', ['p1', 'p2']]]),
            macroSubLabels: new Map(),
            labelDefinedByMacro: new Map(),
            includes: []
        };
        expect(isParameter('p1', 'm', index)).toBe(true);
    });

    it('returns true for parent scope parameter', () => {
        const index: DocumentIndex = {
            labels: [],
            scopeAtLine: new Map(),
            parametersAtScope: new Map([['outer', ['p1']]]),
            macroSubLabels: new Map(),
            labelDefinedByMacro: new Map(),
            includes: []
        };
        expect(isParameter('p1', 'outer.inner', index)).toBe(true);
    });

    it('returns false for non-parameter', () => {
        const index: DocumentIndex = {
            labels: [],
            scopeAtLine: new Map(),
            parametersAtScope: new Map([['m', ['p1']]]),
            macroSubLabels: new Map(),
            labelDefinedByMacro: new Map(),
            includes: []
        };
        expect(isParameter('other', 'm', index)).toBe(false);
    });

    it('returns false with null scopePath', () => {
        const index: DocumentIndex = {
            labels: [],
            scopeAtLine: new Map(),
            parametersAtScope: new Map([['m', ['p1']]]),
            macroSubLabels: new Map(),
            labelDefinedByMacro: new Map(),
            includes: []
        };
        expect(isParameter('p1', null, index)).toBe(false);
    });

    it('matches case-insensitively', () => {
        const index: DocumentIndex = {
            labels: [],
            scopeAtLine: new Map(),
            parametersAtScope: new Map([['m', ['param']]]),
            macroSubLabels: new Map(),
            labelDefinedByMacro: new Map(),
            includes: []
        };
        expect(isParameter('PARAM', 'm', index)).toBe(true);
    });
});

describe('getWordAtPosition - anonymous labels', () => {
    it('captures single + symbol', () => {
        const doc = createDoc('    jmp +');
        const word = getWordAtPosition(doc, Position.create(0, 8)); // On the +
        expect(word).toBe('+');
    });

    it('captures multiple + symbols', () => {
        const doc = createDoc('    jmp +++');
        const word = getWordAtPosition(doc, Position.create(0, 9)); // On middle +
        expect(word).toBe('+++');
    });

    it('captures single - symbol', () => {
        const doc = createDoc('    bne -');
        const word = getWordAtPosition(doc, Position.create(0, 8)); // On the -
        expect(word).toBe('-');
    });

    it('captures multiple - symbols', () => {
        const doc = createDoc('    bne --');
        const word = getWordAtPosition(doc, Position.create(0, 9)); // On second -
        expect(word).toBe('--');
    });

    it('rejects mixed +- symbols', () => {
        const doc = createDoc('    jmp +-');
        const word = getWordAtPosition(doc, Position.create(0, 8)); // On the +
        expect(word).toBeNull(); // Invalid pattern
    });

    it('rejects mixed -+ symbols', () => {
        const doc = createDoc('    jmp -+');
        const word = getWordAtPosition(doc, Position.create(0, 8)); // On the -
        expect(word).toBeNull(); // Invalid pattern
    });
});

describe('findAnonymousLabel', () => {
    it('finds next forward label', () => {
        const source = 'main\n+\n        nop\n+\n        rts';
        const { documentIndex, docs } = buildIndex({ source });

        // From line 2 (first nop), find next +
        const result = findAnonymousLabel('+', 1, docs[0].uri, 2, documentIndex);
        expect(result).toBeDefined();
        expect(result!.range.start.line).toBe(3); // Second + label
    });

    it('finds previous backward label', () => {
        const source = 'main\n-\n        nop\n-\n        rts';
        const { documentIndex, docs } = buildIndex({ source });

        // From line 4 (rts), find previous -
        const result = findAnonymousLabel('-', 1, docs[0].uri, 4, documentIndex);
        expect(result).toBeDefined();
        expect(result!.range.start.line).toBe(3); // Second - label
    });

    it('finds second forward label with distance 2', () => {
        const source = 'main\n        nop\n+\n+\n+\n        nop';
        const { documentIndex, docs } = buildIndex({ source });

        // From line 1, find second next + (skip one)
        const result = findAnonymousLabel('+', 2, docs[0].uri, 1, documentIndex);
        expect(result).toBeDefined();
        expect(result!.range.start.line).toBe(3); // Second + label
    });

    it('finds second backward label with distance 2', () => {
        const source = 'main\n-\n-\n-\n        nop';
        const { documentIndex, docs } = buildIndex({ source });

        // From line 4, find second previous -
        const result = findAnonymousLabel('-', 2, docs[0].uri, 4, documentIndex);
        expect(result).toBeDefined();
        expect(result!.range.start.line).toBe(2); // Second - label
    });

    it('returns null if label not found', () => {
        const source = 'main\n        nop';
        const { documentIndex, docs } = buildIndex({ source });

        const result = findAnonymousLabel('+', 1, docs[0].uri, 1, documentIndex);
        expect(result).toBeNull();
    });

    it('returns null if distance too far', () => {
        const source = 'main\n+\n        nop';
        const { documentIndex, docs } = buildIndex({ source });

        // Only one + label, but asking for second one
        const result = findAnonymousLabel('+', 2, docs[0].uri, 0, documentIndex);
        expect(result).toBeNull();
    });

    it('respects local scope boundaries', () => {
        const source = 'first\n-\nsecond\n-\n        nop';
        const { documentIndex, docs } = buildIndex({ source });

        // From line 4 under 'second' scope, find backward - should only see - at line 3
        const result = findAnonymousLabel('-', 1, docs[0].uri, 4, documentIndex);
        expect(result).toBeDefined();
        expect(result!.range.start.line).toBe(3); // - under 'second' scope
        expect(result!.localScope).toBe('second');
    });

    it('does not find labels from different scopes', () => {
        const source = 'func1\n+\nfunc2\n        nop';
        const { documentIndex, docs } = buildIndex({ source });

        // From line 3 under 'func2' scope, try to find backward +
        // Should not find the + from 'func1' scope
        const result = findAnonymousLabel('-', 1, docs[0].uri, 3, documentIndex);
        expect(result).toBeNull();
    });
});

describe('findSymbolInfo - anonymous labels', () => {
    it('resolves forward anonymous label reference', () => {
        const source = 'main\n        bcc +\n+';
        const { documentIndex, docs } = buildIndex({ source });

        const symbol = findSymbolInfo('+', docs[0].uri, 1, documentIndex);
        expect(symbol).toBeDefined();
        expect(symbol!.isAnonymous).toBe(true);
        expect(symbol!.range.start.line).toBe(2); // The + label on line 2
    });

    it('resolves backward anonymous label reference', () => {
        const source = 'main\n-\n        bne -';
        const { documentIndex, docs } = buildIndex({ source });

        const symbol = findSymbolInfo('-', docs[0].uri, 2, documentIndex);
        expect(symbol).toBeDefined();
        expect(symbol!.isAnonymous).toBe(true);
        expect(symbol!.range.start.line).toBe(1); // The - label on line 1
    });

    it('resolves multi-symbol forward reference', () => {
        const source = 'main\n        bcc ++\n+\n+';
        const { documentIndex, docs } = buildIndex({ source });

        // From line 1, ++ should jump to second + (line 3, 0-indexed)
        const symbol = findSymbolInfo('++', docs[0].uri, 1, documentIndex);
        expect(symbol).toBeDefined();
        expect(symbol!.range.start.line).toBe(3); // Second + label
    });
});
