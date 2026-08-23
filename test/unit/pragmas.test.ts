import { describe, it, expect } from 'vitest';
import { Position } from 'vscode-languageserver/node';
import { pragmaCompletions, pragmaHover, PRAGMAS } from '../../src/server/pragmas';
import { getCompletions } from '../../src/server/completions';
import { buildHover } from '../../src/server/hover';
import { buildIndex } from '../helpers/doc';
import { CPU_NAMES } from '../../src/server/constants';

const complete = (before: string) => pragmaCompletions(before, Position.create(0, before.length));
const labels = (before: string) => complete(before)?.map(i => i.label) ?? null;

describe('pragma completion', () => {
    it('stays out of the way until the prefix is under way', () => {
        expect(complete(';')).toBeNull();
        expect(complete('; ')).toBeNull();
        expect(complete('; note to self')).toBeNull();
    });

    it('completes the prefix once it is recognisable', () => {
        expect(labels('; 64t')).toEqual(['64tass-langserv:']);
        expect(labels('        ; 64tass-lang')).toEqual(['64tass-langserv:']);
    });

    it('offers every pragma after the prefix', () => {
        expect(labels('; 64tass-langserv: ')).toEqual(PRAGMAS.map(p => p.name));
    });

    it('offers the values a pragma takes', () => {
        expect(labels('; 64tass-langserv: cpu ')).toEqual([...CPU_NAMES]);
    });

    it('has nothing to offer where the argument is free text', () => {
        expect(complete('; 64tass-langserv: define ')).toBeNull();
        expect(complete('; 64tass-langserv: root ')).toBeNull();
    });

    it('replaces what was typed rather than appending to it', () => {
        const [item] = complete('; 64tass-langserv: cpu 65')!;
        expect(item.textEdit).toMatchObject({ range: { start: { character: 23 }, end: { character: 25 } } });
    });

    it('reaches the cursor through the ordinary completion entry point', () => {
        // Completion normally goes silent inside a comment, so this has to be
        // tried before that check.
        const source = '        *= $1000\n; 64tass-langserv: ';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///pragma.asm' });
        const items = getCompletions(docs[0], Position.create(1, source.split('\n')[1].length), documentIndex);
        expect(items.map(i => i.label)).toEqual(PRAGMAS.map(p => p.name));
    });

    it('leaves an ordinary comment silent', () => {
        const source = '        *= $1000\n; just a comment';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///plain.asm' });
        expect(getCompletions(docs[0], Position.create(1, 16), documentIndex)).toEqual([]);
    });
});

describe('pragma hover', () => {
    it('explains the pragma on the line', () => {
        const hover = pragmaHover('; 64tass-langserv: cpu 65816', 0);
        expect(String((hover!.contents as { value: string }).value)).toContain('Set the target CPU');
    });

    it('answers anywhere on the line, indented or not', () => {
        expect(pragmaHover('        ; 64tass-langserv: define X = 1', 3)).not.toBeNull();
    });

    it('says nothing about an ordinary comment or an unknown pragma', () => {
        expect(pragmaHover('; ordinary comment', 0)).toBeNull();
        expect(pragmaHover('; 64tass-langserv: nosuchthing', 0)).toBeNull();
    });

    it('wins over the symbol lookup, which would answer for "cpu"', () => {
        const source = '; 64tass-langserv: cpu 65816\ncpu     = 1';
        const { documentIndex, docs } = buildIndex({ source, uri: 'file:///hover.asm' });
        const hover = buildHover('cpu', docs[0], 0, documentIndex, false, '65816');
        expect(String((hover!.contents as { value: string }).value)).toContain('Set the target CPU');
    });

    it('documents every pragma the extension actually reads', () => {
        // A pragma nobody described is one nobody can discover.
        expect(PRAGMAS.map(p => p.name).sort())
            .toEqual(['case-insensitive', 'case-sensitive', 'cpu', 'define', 'root']);
        for (const pragma of PRAGMAS) {
            expect(pragma.syntax).toContain('64tass-langserv:');
            expect(pragma.summary.endsWith('.')).toBe(true);
        }
    });
});
