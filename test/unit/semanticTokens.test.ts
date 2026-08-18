import { describe, it, expect } from 'vitest';
import { buildSemanticTokens, encodeModifiers, TOKEN_TYPES, TOKEN_MODIFIERS } from '../../src/server/semanticTokens';
import { buildIndex } from '../helpers/doc';

function tokens(source: string, caseSensitive = false) {
    const uri = `file:///${Math.random()}.asm`;
    const { documentIndex } = buildIndex({ source, uri, caseSensitive });
    return buildSemanticTokens(source, uri, documentIndex, caseSensitive).map(t => ({
        text: source.split('\n')[t.line].substr(t.startCharacter, t.length),
        type: t.tokenType,
        modifiers: t.tokenModifiers
    }));
}
const typeOf = (list: ReturnType<typeof tokens>, text: string) => list.find(t => t.text === text)?.type;

describe('encodeModifiers', () => {
    it('encodes modifiers as a bitset matching the legend order', () => {
        expect(encodeModifiers([])).toBe(0);
        expect(encodeModifiers(['declaration'])).toBe(1);
        expect(encodeModifiers(['readonly'])).toBe(2);
        expect(encodeModifiers(['declaration', 'readonly'])).toBe(3);
        expect(encodeModifiers(['defaultLibrary'])).toBe(4);
    });

    it('ignores unknown modifiers', () => {
        expect(encodeModifiers(['nonsense'])).toBe(0);
    });
});

describe('buildSemanticTokens - what the grammar cannot know', () => {
    it('distinguishes a builtin directive from a user macro call', () => {
        const list = tokens('mymac .macro\n.endm\nstart\n        .byte 1\n        .mymac');
        // ".byte" is a directive; ".mymac" resolves to a user macro
        expect(list.find(t => t.text === '.byte')?.type).toBe('keyword');
        expect(list.find(t => t.text === '.byte')?.modifiers).toContain('defaultLibrary');
        expect(typeOf(list, 'mymac')).toBe('macro');
    });

    it('classifies a reference by the kind of its definition', () => {
        const list = tokens([
            'p       .proc',
            '        rts',
            '        .pend',
            'tbl     .byte 1',
            'val     = 5',
            'start',
            '        jsr p',
            '        lda tbl',
            '        lda #val'
        ].join('\n'));

        expect(list.filter(t => t.text === 'p').every(t => t.type === 'function')).toBe(true);
        expect(list.filter(t => t.text === 'tbl').every(t => t.type === 'property')).toBe(true);
        expect(list.filter(t => t.text === 'val').every(t => t.type === 'variable')).toBe(true);
    });

    it('marks a definition with the declaration modifier', () => {
        const list = tokens('start\n        jsr start');
        const decls = list.filter(t => t.text === 'start' && t.modifiers.includes('declaration'));
        const uses = list.filter(t => t.text === 'start' && !t.modifiers.includes('declaration'));
        expect(decls).toHaveLength(1);
        expect(uses).toHaveLength(1);
    });

    it('marks a constant as readonly but a .var as not', () => {
        const list = tokens('c = 1\nv .var 2\nstart\n        lda #c\n        lda #v');
        expect(list.find(t => t.text === 'c' && !t.modifiers.includes('declaration'))?.modifiers).toContain('readonly');
        expect(list.find(t => t.text === 'v' && !t.modifiers.includes('declaration'))?.modifiers).not.toContain('readonly');
    });

    it('classifies macro parameters', () => {
        const list = tokens('m .macro count\n        lda #count\n.endm');
        expect(typeOf(list, 'count')).toBe('parameter');
    });

    it('classifies a block as a namespace', () => {
        const list = tokens('b .block\n.bend\nstart\n        lda b');
        expect(list.filter(t => t.text === 'b').every(t => t.type === 'namespace')).toBe(true);
    });
});

describe('buildSemanticTokens - what it deliberately leaves alone', () => {
    it('does not emit tokens for opcodes', () => {
        expect(tokens('start\n        lda #1\n        rts').some(t => ['lda', 'rts'].includes(t.text))).toBe(false);
    });

    it('does not emit tokens for registers and builtin functions', () => {
        expect(tokens('start\n        tax\n        lda #abs(1)').some(t => ['a', 'x', 'abs'].includes(t.text))).toBe(false);
    });

    it('does not classify an unresolvable identifier', () => {
        // Better to leave the grammar's colouring than to guess
        expect(tokens('start\n        lda unknown_thing').some(t => t.text === 'unknown_thing')).toBe(false);
    });

    it('does not classify text inside a string literal', () => {
        expect(tokens('start\n        .text "start"').filter(t => t.text === 'start')).toHaveLength(1);
    });

    it('does not classify text inside a comment', () => {
        expect(tokens('start\n        nop ; start again').filter(t => t.text === 'start')).toHaveLength(1);
    });

    it('returns nothing for an unindexed document', () => {
        const { documentIndex } = buildIndex({ source: 'start', uri: 'file:///indexed.asm' });
        expect(buildSemanticTokens('start', 'file:///other.asm', documentIndex, false)).toEqual([]);
    });
});

describe('semantic token legend', () => {
    it('has unique entries, since indices are sent over the wire', () => {
        expect(new Set(TOKEN_TYPES).size).toBe(TOKEN_TYPES.length);
        expect(new Set(TOKEN_MODIFIERS).size).toBe(TOKEN_MODIFIERS.length);
    });

    it('only emits token types that are in the legend', () => {
        const list = tokens('p .proc\n.pend\ntbl .byte 1\nval = 1\nstart\n        jsr p');
        for (const t of list) expect(TOKEN_TYPES).toContain(t.type);
    });

    it('returns tokens sorted by position, as the encoding requires', () => {
        const source = 'a = 1\nb = 2\nstart\n        lda #a\n        lda #b';
        const uri = 'file:///sorted.asm';
        const { documentIndex } = buildIndex({ source, uri });
        const raw = buildSemanticTokens(source, uri, documentIndex, false);
        for (let i = 1; i < raw.length; i++) {
            const prev = raw[i - 1], cur = raw[i];
            expect(cur.line > prev.line || (cur.line === prev.line && cur.startCharacter >= prev.startCharacter)).toBe(true);
        }
    });
});
