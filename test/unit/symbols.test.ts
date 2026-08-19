import { describe, it, expect } from 'vitest';
import { Position } from 'vscode-languageserver/node';
import { getWordAtPosition, findSymbolInfo, findDefinition, isParameter, findAnonymousLabel } from '../../src/server/symbols';
import { DocumentIndex } from '../../src/server/types';
import { createDoc, buildIndex, emptyIndex } from '../helpers/doc';

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

    it('returns full dotted reference when cursor is on the last segment', () => {
        const doc = createDoc('        lda scope.label');
        // 'label' starts at column 18
        expect(getWordAtPosition(doc, Position.create(0, 20))).toBe('scope.label');
    });

    it('returns only the prefix segment when cursor is on an earlier segment', () => {
        const doc = createDoc('        lda scope.label');
        // 'scope' spans columns 12-16
        expect(getWordAtPosition(doc, Position.create(0, 15))).toBe('scope');
    });

    it('isolates the clicked segment in a 3-level dotted reference', () => {
        const doc = createDoc('        lda outer.inner.label');
        // 'outer' spans columns 12-16
        expect(getWordAtPosition(doc, Position.create(0, 14))).toBe('outer');
        // 'inner' spans columns 18-22
        expect(getWordAtPosition(doc, Position.create(0, 20))).toBe('outer.inner');
        // 'label' spans columns 24-28
        expect(getWordAtPosition(doc, Position.create(0, 26))).toBe('outer.inner.label');
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
        const index: DocumentIndex = emptyIndex({ parametersAtScope: new Map([['m', ['p1', 'p2']]]) });
        expect(isParameter('p1', 'm', index)).toBe(true);
    });

    it('returns true for parent scope parameter', () => {
        const index: DocumentIndex = emptyIndex({ parametersAtScope: new Map([['outer', ['p1']]]) });
        expect(isParameter('p1', 'outer.inner', index)).toBe(true);
    });

    it('returns false for non-parameter', () => {
        const index: DocumentIndex = emptyIndex({ parametersAtScope: new Map([['m', ['p1']]]) });
        expect(isParameter('other', 'm', index)).toBe(false);
    });

    it('returns false with null scopePath', () => {
        const index: DocumentIndex = emptyIndex({ parametersAtScope: new Map([['m', ['p1']]]) });
        expect(isParameter('p1', null, index)).toBe(false);
    });

    it('matches case-insensitively', () => {
        const index: DocumentIndex = emptyIndex({ parametersAtScope: new Map([['m', ['param']]]) });
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

    // Verified against the assembler: named code labels do NOT delimit anonymous
    // labels - only .proc/.block style scopes do.
    it('resolves across an intervening named code label', () => {
        const source = 'first\n-\nsecond\n-\n        nop';
        const { documentIndex, docs } = buildIndex({ source });

        // Nearest backward from line 4 is the - on line 3
        const near = findAnonymousLabel('-', 1, docs[0].uri, 4, documentIndex);
        expect(near).not.toBeNull();
        expect(near!.range.start.line).toBe(3);

        // -- reaches past the 'second' code label to the - on line 1
        const far = findAnonymousLabel('-', 2, docs[0].uri, 4, documentIndex);
        expect(far).not.toBeNull();
        expect(far!.range.start.line).toBe(1);
    });

    it('resolves a backward label defined before a named code label', () => {
        // The exact case from the review: "first inx / - iny / second dey / bne -"
        const source = 'first   inx\n-       iny\nsecond  dey\n        bne -';
        const { documentIndex, docs } = buildIndex({ source });

        const result = findAnonymousLabel('-', 1, docs[0].uri, 3, documentIndex);
        expect(result).not.toBeNull();
        expect(result!.range.start.line).toBe(1);
    });

    it('does not reach into a nested scope', () => {
        // A - inside a .block is not visible from outside it
        const source = 'b .block\n-\n.bend\n        nop';
        const { documentIndex, docs } = buildIndex({ source });

        const result = findAnonymousLabel('-', 1, docs[0].uri, 3, documentIndex);
        expect(result).toBeNull();
    });

    it('does not reach into a sibling scope', () => {
        const source = 'a .block\n-\n.bend\nb .block\n        nop\n.bend';
        const { documentIndex, docs } = buildIndex({ source });

        const result = findAnonymousLabel('-', 1, docs[0].uri, 4, documentIndex);
        expect(result).toBeNull();
    });

    it('sees an enclosing scope\'s label from inside a nested scope', () => {
        const source = '-\nb .block\n        nop\n.bend';
        const { documentIndex, docs } = buildIndex({ source });

        const result = findAnonymousLabel('-', 1, docs[0].uri, 2, documentIndex);
        expect(result).not.toBeNull();
        expect(result!.range.start.line).toBe(0);
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

describe('case sensitivity', () => {
    it('matches case-insensitively by default', () => {
        const source = 'MyLabel\n        lda #1';
        const { documentIndex, docs } = buildIndex({ source });

        // Should find label regardless of case
        const symbol1 = findSymbolInfo('MyLabel', docs[0].uri, 1, documentIndex, false);
        const symbol2 = findSymbolInfo('mylabel', docs[0].uri, 1, documentIndex, false);
        const symbol3 = findSymbolInfo('MYLABEL', docs[0].uri, 1, documentIndex, false);

        expect(symbol1).toBeDefined();
        expect(symbol2).toBeDefined();
        expect(symbol3).toBeDefined();
        expect(symbol1!.originalName).toBe('MyLabel');
    });

    it('matches case-sensitively when enabled', () => {
        const source = 'MyLabel\n        lda #1';
        const { documentIndex, docs } = buildIndex({ source, caseSensitive: true });

        // Should only find exact case match
        const symbol1 = findSymbolInfo('MyLabel', docs[0].uri, 1, documentIndex, true);
        const symbol2 = findSymbolInfo('mylabel', docs[0].uri, 1, documentIndex, true);
        const symbol3 = findSymbolInfo('MYLABEL', docs[0].uri, 1, documentIndex, true);

        expect(symbol1).toBeDefined();
        expect(symbol1!.originalName).toBe('MyLabel');
        expect(symbol2).toBeNull(); // Different case, should not match
        expect(symbol3).toBeNull(); // Different case, should not match
    });

    it('distinguishes symbols with same name but different case in case-sensitive mode', () => {
        const source = 'myLabel\nMyLabel\nMYLABEL\n        lda #1';
        const { documentIndex, docs } = buildIndex({ source, caseSensitive: true });

        // Case-sensitive should find exact matches
        const match1 = findSymbolInfo('myLabel', docs[0].uri, 3, documentIndex, true);
        const match2 = findSymbolInfo('MyLabel', docs[0].uri, 3, documentIndex, true);
        const match3 = findSymbolInfo('MYLABEL', docs[0].uri, 3, documentIndex, true);

        expect(match1).toBeDefined();
        expect(match1!.originalName).toBe('myLabel');
        expect(match2).toBeDefined();
        expect(match2!.originalName).toBe('MyLabel');
        expect(match3).toBeDefined();
        expect(match3!.originalName).toBe('MYLABEL');
    });

    it('applies case sensitivity to local symbols', () => {
        const source = 'main\n_Local\n        lda _local';
        const { documentIndex, docs } = buildIndex({ source, caseSensitive: true });

        // Case-sensitive should not match different case
        const sensitive = findSymbolInfo('_local', docs[0].uri, 2, documentIndex, true);
        expect(sensitive).toBeNull();

        // Exact case should match
        const exact = findSymbolInfo('_Local', docs[0].uri, 2, documentIndex, true);
        expect(exact).toBeDefined();
    });

    // These two must build the index with the same case sensitivity they look up
    // with: a case-insensitive index stores names lowercased, so probing it with a
    // case-sensitive lookup (or vice versa) tests nothing meaningful.
    const DOTTED_SOURCE = 'Outer .proc\n    Inner .proc\n        Value = 42\n    .pend\n.pend\nmain\n        lda #Outer.Inner.Value';

    it('resolves dotted references case-insensitively when case-insensitive', () => {
        const { documentIndex, docs } = buildIndex({ source: DOTTED_SOURCE });

        // Any casing resolves against a case-insensitive index
        expect(findSymbolInfo('outer.inner.value', docs[0].uri, 6, documentIndex, false)).not.toBeNull();
        expect(findSymbolInfo('OUTER.INNER.VALUE', docs[0].uri, 6, documentIndex, false)).not.toBeNull();
        expect(findSymbolInfo('Outer.Inner.Value', docs[0].uri, 6, documentIndex, false)).not.toBeNull();
    });

    it('applies case sensitivity to dotted references when case-sensitive', () => {
        const { documentIndex, docs } = buildIndex({ source: DOTTED_SOURCE, caseSensitive: true });

        // Exact case matches, including the scope path segments
        expect(findSymbolInfo('Outer.Inner.Value', docs[0].uri, 6, documentIndex, true)).not.toBeNull();

        // Wrong case does not - in the name or in any scope segment
        expect(findSymbolInfo('outer.inner.value', docs[0].uri, 6, documentIndex, true)).toBeNull();
        expect(findSymbolInfo('Outer.Inner.value', docs[0].uri, 6, documentIndex, true)).toBeNull();
        expect(findSymbolInfo('outer.Inner.Value', docs[0].uri, 6, documentIndex, true)).toBeNull();
    });
});

describe('mixed case sensitivity across documents', () => {
    // Two compilation units in one workspace can now have different effective
    // settings (via the pragma cascade), so the index can hold both at once.
    const SOURCES = [
        { source: 'Sensitive = 1\n        lda #Sensitive', uri: 'file:///cs.asm', caseSensitive: true },
        { source: 'Insensitive = 2\n        lda #Insensitive', uri: 'file:///ci.asm', caseSensitive: false },
    ];

    it('records each document with its own case sensitivity', () => {
        const { documentIndex } = buildIndex(...SOURCES);
        expect(documentIndex.get('file:///cs.asm')!.caseSensitive).toBe(true);
        expect(documentIndex.get('file:///ci.asm')!.caseSensitive).toBe(false);
    });

    it('stores names per that document\'s own setting', () => {
        const { documentIndex } = buildIndex(...SOURCES);
        // case-sensitive document keeps the original case
        expect(documentIndex.get('file:///cs.asm')!.labels[0].name).toBe('Sensitive');
        // case-insensitive document lowercases
        expect(documentIndex.get('file:///ci.asm')!.labels[0].name).toBe('insensitive');
    });

    it('resolves each document under its own rules', () => {
        const { documentIndex } = buildIndex(...SOURCES);
        // exact case required in the sensitive document
        expect(findSymbolInfo('Sensitive', 'file:///cs.asm', 1, documentIndex, true)).not.toBeNull();
        expect(findSymbolInfo('sensitive', 'file:///cs.asm', 1, documentIndex, true)).toBeNull();
        // any case accepted in the insensitive one
        expect(findSymbolInfo('INSENSITIVE', 'file:///ci.asm', 1, documentIndex, false)).not.toBeNull();
    });

    it('still applies the first entry to documents that do not override', () => {
        const { documentIndex } = buildIndex(
            { source: 'Alpha = 1', uri: 'file:///a.asm', caseSensitive: true },
            { source: 'Beta = 2', uri: 'file:///b.asm' }
        );
        expect(documentIndex.get('file:///b.asm')!.caseSensitive).toBe(true);
        expect(documentIndex.get('file:///b.asm')!.labels[0].name).toBe('Beta');
    });
});

describe('.with imported scopes', () => {
    // Verified against the assembler: `.with X` makes X's members visible
    // unqualified until `.endwith`, without changing where definitions land.
    const BLOCK = 'scope   .block\nbar     .byte 1\n        .bend\n';

    it('resolves an unqualified member inside the block', () => {
        const source = BLOCK + '        .with scope\n        lda bar\n        .endwith';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///w1.asm' });
        const found = findSymbolInfo('bar', docs[0].uri, 4, documentIndex);
        expect(found).not.toBeNull();
        expect(found!.scopePath).toBe('scope');
    });

    it('still resolves the qualified form inside the block', () => {
        const source = BLOCK + '        .with scope\n        lda scope.bar\n        .endwith';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///w2.asm' });
        expect(findSymbolInfo('scope.bar', docs[0].uri, 4, documentIndex)).not.toBeNull();
    });

    it('does not resolve after .endwith', () => {
        const source = BLOCK + '        .with scope\n        .endwith\n        lda bar';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///w3.asm' });
        expect(findSymbolInfo('bar', docs[0].uri, 5, documentIndex)).toBeNull();
    });

    it('does not resolve before the .with', () => {
        const source = BLOCK + '        lda bar\n        .with scope\n        .endwith';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///w4.asm' });
        expect(findSymbolInfo('bar', docs[0].uri, 3, documentIndex)).toBeNull();
    });

    it('resolves through nested .with blocks', () => {
        const source = [
            'a .block', 'b .block', 'deep .byte 1', '.bend', '.bend',
            '        .with a', '        .with b', '        lda deep',
            '        .endwith', '        .endwith'
        ].join('\n');
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///w5.asm' });
        const found = findSymbolInfo('deep', docs[0].uri, 7, documentIndex);
        expect(found).not.toBeNull();
        expect(found!.scopePath).toBe('a.b');
    });

    it('pops only the innermost scope at .endwith', () => {
        const source = [
            'a .block', 'aa .byte 1', '.bend',
            'b .block', 'bb .byte 2', '.bend',
            '        .with a', '        .with b',
            '        .endwith',
            '        lda aa',   // still inside .with a
            '        lda bb',   // b was popped
            '        .endwith'
        ].join('\n');
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///w6.asm' });
        expect(findSymbolInfo('aa', docs[0].uri, 9, documentIndex)).not.toBeNull();
        expect(findSymbolInfo('bb', docs[0].uri, 10, documentIndex)).toBeNull();
    });

    it('works with a .proc as the imported scope', () => {
        const source = 'p .proc\nbar .byte 1\n.pend\n        .with p\n        lda bar\n        .endwith';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///w7.asm' });
        expect(findSymbolInfo('bar', docs[0].uri, 4, documentIndex)).not.toBeNull();
    });

    it('a label defined inside a .with belongs to the enclosing scope', () => {
        // Verified: the assembler resolves it as "newlbl", not "scope.newlbl"
        const source = BLOCK + '        .with scope\nnewlbl  nop\n        .endwith';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///w8.asm' });
        const label = documentIndex.get(docs[0].uri)!.labels.find(l => l.name === 'newlbl');
        expect(label).toBeDefined();
        expect(label!.scopePath).toBeNull();
    });

    it('still reports a genuinely undefined symbol inside a .with', () => {
        const source = BLOCK + '        .with scope\n        lda nope\n        .endwith';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///w9.asm' });
        expect(findSymbolInfo('nope', docs[0].uri, 4, documentIndex)).toBeNull();
    });
});

describe('.dstruct / .dunion instance members', () => {
    // Verified against the assembler: an instance exposes the members of the type it
    // instantiates, and a member the type does not declare is still an error.
    const STRUCT = 'pt      .struct\nposx    .byte ?\nposy    .byte ?\n        .ends\n';

    it('resolves a member through the instance', () => {
        const source = STRUCT + 'p1      .dstruct pt, 1, 2\n        lda p1.posx';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///d1.asm' });
        const found = findSymbolInfo('p1.posx', docs[0].uri, 5, documentIndex);
        expect(found).not.toBeNull();
        expect(found!.name).toBe('posx');
        expect(found!.scopePath).toBe('pt');
    });

    it('resolves members of several instances of one type', () => {
        const source = STRUCT + 'p1 .dstruct pt, 1, 2\np2 .dstruct pt, 3, 4\n        nop';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///d2.asm' });
        expect(findSymbolInfo('p1.posy', docs[0].uri, 6, documentIndex)).not.toBeNull();
        expect(findSymbolInfo('p2.posx', docs[0].uri, 6, documentIndex)).not.toBeNull();
    });

    it('does not invent a member the type does not declare', () => {
        const source = STRUCT + 'p1      .dstruct pt, 1, 2\n        nop';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///d3.asm' });
        expect(findSymbolInfo('p1.nosuch', docs[0].uri, 5, documentIndex)).toBeNull();
    });

    it('indexes the instance itself as a label', () => {
        const source = STRUCT + 'p1      .dstruct pt, 1, 2\n        lda p1';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///d4.asm' });
        expect(findSymbolInfo('p1', docs[0].uri, 5, documentIndex)).not.toBeNull();
        expect(documentIndex.get(docs[0].uri)!.structInstances.get('p1')).toBe('pt');
    });

    it('works for .dunion too', () => {
        const source = 'u .union\naa .byte ?\nbb .word ?\n.endu\nv .dunion u\n        lda v.bb';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///d5.asm' });
        expect(findSymbolInfo('v.bb', docs[0].uri, 5, documentIndex)).not.toBeNull();
    });

    it('still resolves a member via the type name', () => {
        const source = STRUCT + 'p1 .dstruct pt, 1, 2\n        lda pt.posx';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///d6.asm' });
        expect(findSymbolInfo('pt.posx', docs[0].uri, 5, documentIndex)).not.toBeNull();
    });
});

describe('members of a label on a macro call', () => {
    const SOURCE = [
        'drv     .macro',
        'inner   nop',
        'patchme lda #0',
        '        .endm',
        '        * = $1000',
        'virt    #drv',
        '        sta virt.patchme + 1',
    ].join('\n');

    it('resolves a member through the macro the label calls', () => {
        // Verified: "virt #drv" makes drv's patchme reachable as virt.patchme,
        // and not as a bare patchme.
        const { documentIndex, docs } = buildIndex({ source: SOURCE });
        const found = findSymbolInfo('virt.patchme', docs[0].uri, 6, documentIndex, false);
        expect(found?.name).toBe('patchme');
    });

    it('returns nothing for a member the macro does not define', () => {
        const { documentIndex, docs } = buildIndex({ source: SOURCE });
        expect(findSymbolInfo('virt.nosuch', docs[0].uri, 6, documentIndex, false)).toBeNull();
    });
});

describe('members of a label assigned from a function call', () => {
    const SOURCE = [
        'mk      .function _v',
        'BITMAP  = _v + 1',
        'SCREEN  = _v + 2',
        '        .endf namespace(*)',
        'PIC     = mk(5)',
        '        * = $1000',
        '        lda #PIC.BITMAP',
    ].join('\n');

    it('resolves a member through the function that produced it', () => {
        // Verified: a .function returning namespace(*) exposes its own labels as
        // members of whatever the call is assigned to.
        const { documentIndex, docs } = buildIndex({ source: SOURCE });
        expect(findSymbolInfo('PIC.BITMAP', docs[0].uri, 6, documentIndex, false)?.name).toBe('bitmap');
    });

    it('returns nothing for a member the function does not define', () => {
        const { documentIndex, docs } = buildIndex({ source: SOURCE });
        expect(findSymbolInfo('PIC.NOSUCH', docs[0].uri, 6, documentIndex, false)).toBeNull();
    });

    it('still prefers a real scope of that name over the substitution', () => {
        // MAPDATA is assigned from ctm7(), but its members live in a namespace
        // literally called mapdata - the written path has to win.
        const source = [
            'ctm7    .function _f',
            'mapdata .namespace',
            'COLORS  = 5',
            '        .endn',
            '        .endf mapdata',
            'MAPDATA = ctm7("x")',
            '        * = $1000',
            '        lda #MAPDATA.COLORS',
        ].join('\n');
        const { documentIndex, docs } = buildIndex({ source });
        expect(findSymbolInfo('MAPDATA.COLORS', docs[0].uri, 7, documentIndex, false)?.name).toBe('colors');
    });
});
