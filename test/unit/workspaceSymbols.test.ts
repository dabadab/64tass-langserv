import { describe, it, expect } from 'vitest';
import { SymbolKind } from 'vscode-languageserver/node';
import { findWorkspaceSymbols, fuzzyMatches } from '../../src/server/workspaceSymbols';
import { buildIndex } from '../helpers/doc';

const TWO_FILES = () => buildIndex(
    { source: 'sprite_init\n        rts\nsprite_draw\n        rts', uri: 'file:///a.asm' },
    { source: 'audio .proc\nplay\n        rts\n.pend\nvolume = 5', uri: 'file:///b.asm' }
).documentIndex;

const names = (s: { name: string }[]) => s.map(x => x.name);

describe('fuzzyMatches', () => {
    it('matches a subsequence, as a symbol picker should', () => {
        expect(fuzzyMatches('sinit', 'sprite_init')).toBe(true);
        expect(fuzzyMatches('sd', 'sprite_draw')).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(fuzzyMatches('SPR', 'sprite_init')).toBe(true);
        expect(fuzzyMatches('spr', 'SPRITE_INIT')).toBe(true);
    });

    it('rejects characters out of order or absent', () => {
        expect(fuzzyMatches('initsprite', 'sprite_init')).toBe(false);
        expect(fuzzyMatches('xyz', 'sprite_init')).toBe(false);
    });

    it('matches everything for an empty query', () => {
        expect(fuzzyMatches('', 'anything')).toBe(true);
    });
});

describe('findWorkspaceSymbols', () => {
    it('searches across every indexed document', () => {
        const found = names(findWorkspaceSymbols('', TWO_FILES()));
        expect(found).toEqual(expect.arrayContaining(['sprite_init', 'sprite_draw', 'audio', 'play', 'volume']));
    });

    it('filters by the query', () => {
        expect(names(findWorkspaceSymbols('sprite', TWO_FILES())).sort())
            .toEqual(['sprite_draw', 'sprite_init']);
    });

    it('ranks an exact match first', () => {
        const index = buildIndex(
            { source: 'init\ninit_sprites\nreinit', uri: 'file:///r.asm' }
        ).documentIndex;
        expect(names(findWorkspaceSymbols('init', index))[0]).toBe('init');
    });

    it('ranks a prefix match above a substring match', () => {
        const index = buildIndex({ source: 'reinit\ninit_all', uri: 'file:///r2.asm' }).documentIndex;
        expect(names(findWorkspaceSymbols('init', index))).toEqual(['init_all', 'reinit']);
    });

    it('reports the defining file and range', () => {
        const [sym] = findWorkspaceSymbols('volume', TWO_FILES());
        expect(sym.location.uri).toBe('file:///b.asm');
        expect(sym.location.range.start.line).toBe(4);
    });

    it('reports the enclosing scope as the container', () => {
        const [play] = findWorkspaceSymbols('play', TWO_FILES());
        expect(play.containerName).toBe('audio');
        const [init] = findWorkspaceSymbols('sprite_init', TWO_FILES());
        expect(init.containerName).toBeUndefined();
    });

    it('reports a local symbol\'s code label as its container', () => {
        const index = buildIndex({ source: 'main\n_tmp = 1', uri: 'file:///l.asm' }).documentIndex;
        const [tmp] = findWorkspaceSymbols('_tmp', index);
        expect(tmp.containerName).toBe('main');
    });

    it('maps kinds', () => {
        const index = buildIndex({ source: 'p .proc\n.pend\nval = 1', uri: 'file:///k.asm' }).documentIndex;
        expect(findWorkspaceSymbols('p', index)[0].kind).toBe(SymbolKind.Function);
        expect(findWorkspaceSymbols('val', index)[0].kind).toBe(SymbolKind.Constant);
    });

    it('omits anonymous labels, which have no name to search for', () => {
        const index = buildIndex({ source: 'main\n-\tinx\n+\trts', uri: 'file:///anon.asm' }).documentIndex;
        expect(names(findWorkspaceSymbols('', index))).toEqual(['main']);
    });

    it('returns nothing when nothing matches', () => {
        expect(findWorkspaceSymbols('zzzz', TWO_FILES())).toEqual([]);
    });

    it('caps the number of results', () => {
        const source = Array.from({ length: 50 }, (_, i) => `label${i}`).join('\n');
        const index = buildIndex({ source, uri: 'file:///many.asm' }).documentIndex;
        expect(findWorkspaceSymbols('label', index, 10)).toHaveLength(10);
    });
});
