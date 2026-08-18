import { describe, it, expect } from 'vitest';
import { IncludeGraph } from '../../src/server/includes';

describe('IncludeGraph', () => {
    it('reports a file as referenced once a root includes it', () => {
        const g = new IncludeGraph();
        expect(g.isReferenced('dep')).toBe(false);
        g.addRef('dep', 'main');
        expect(g.isReferenced('dep')).toBe(true);
    });

    it('orphans an include when its only root goes away', () => {
        const g = new IncludeGraph();
        g.addRef('dep', 'main');
        expect(g.clearRoot('main')).toEqual(['dep']);
        expect(g.isReferenced('dep')).toBe(false);
    });

    // The C-series bug this class exists to prevent: two roots share an include,
    // and closing one must not strip it from the other.
    it('keeps an include alive while another root still refers to it', () => {
        const g = new IncludeGraph();
        g.addRef('dep', 'main');
        g.addRef('dep', 'other');

        expect(g.clearRoot('main')).toEqual([]);
        expect(g.isReferenced('dep')).toBe(true);

        expect(g.clearRoot('other')).toEqual(['dep']);
        expect(g.isReferenced('dep')).toBe(false);
    });

    it('orphans only the includes that lost their last root', () => {
        const g = new IncludeGraph();
        g.addRef('shared', 'a');
        g.addRef('shared', 'b');
        g.addRef('only_a', 'a');

        expect(g.clearRoot('a')).toEqual(['only_a']);
        expect(g.isReferenced('shared')).toBe(true);
    });

    it('is idempotent when clearing an unknown root', () => {
        const g = new IncludeGraph();
        g.addRef('dep', 'main');
        expect(g.clearRoot('nobody')).toEqual([]);
        expect(g.isReferenced('dep')).toBe(true);
    });

    it('ignores a duplicate reference from the same root', () => {
        const g = new IncludeGraph();
        g.addRef('dep', 'main');
        g.addRef('dep', 'main');
        expect(g.clearRoot('main')).toEqual(['dep']);
    });

    it('lists the roots that reach a file', () => {
        const g = new IncludeGraph();
        g.addRef('dep', 'a');
        g.addRef('dep', 'b');
        expect(g.rootsFor('dep').sort()).toEqual(['a', 'b']);
        expect(g.rootsFor('unknown')).toEqual([]);
    });

    it('reports affected roots including the file itself', () => {
        const g = new IncludeGraph();
        g.addRef('dep', 'main');
        expect(g.affectedRoots('dep').sort()).toEqual(['dep', 'main']);
        // A file nothing includes still affects itself
        expect(g.affectedRoots('lonely')).toEqual(['lonely']);
    });

    it('does not duplicate a root that is also the file', () => {
        const g = new IncludeGraph();
        g.addRef('a', 'a');
        expect(g.affectedRoots('a')).toEqual(['a']);
    });
});
