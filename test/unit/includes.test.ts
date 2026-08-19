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

describe('compilationUnit', () => {
    it('is just the file itself when nothing includes it', () => {
        // The bug this fixes: symbols from an unrelated file elsewhere in the
        // workspace were offered as completions.
        const graph = new IncludeGraph();
        graph.addRef('file:///dep.asm', 'file:///other.asm');
        expect([...graph.compilationUnit('file:///lone.asm')]).toEqual(['file:///lone.asm']);
    });

    it('includes the files a root pulls in', () => {
        const graph = new IncludeGraph();
        graph.addRef('file:///a.asm', 'file:///main.asm');
        graph.addRef('file:///b.asm', 'file:///main.asm');
        expect([...graph.compilationUnit('file:///main.asm')].sort())
            .toEqual(['file:///a.asm', 'file:///b.asm', 'file:///main.asm']);
    });

    it('lets siblings under one root see each other', () => {
        // Verified against the assembler: an .include'd file resolves symbols
        // from another file included alongside it.
        const graph = new IncludeGraph();
        graph.addRef('file:///a.asm', 'file:///main.asm');
        graph.addRef('file:///b.asm', 'file:///main.asm');
        expect(graph.compilationUnit('file:///a.asm').has('file:///b.asm')).toBe(true);
        expect(graph.compilationUnit('file:///a.asm').has('file:///main.asm')).toBe(true);
    });

    it('excludes a tree belonging to a different root', () => {
        const graph = new IncludeGraph();
        graph.addRef('file:///a.asm', 'file:///main.asm');
        graph.addRef('file:///forest.asm', 'file:///the_forest.asm');
        const unit = graph.compilationUnit('file:///a.asm');
        expect(unit.has('file:///forest.asm')).toBe(false);
        expect(unit.has('file:///the_forest.asm')).toBe(false);
    });

    it('spans both trees when two roots share a file', () => {
        // A shared header really is assembled into both, so from inside it both
        // are in scope.
        const graph = new IncludeGraph();
        graph.addRef('file:///common.asm', 'file:///one.asm');
        graph.addRef('file:///common.asm', 'file:///two.asm');
        graph.addRef('file:///only1.asm', 'file:///one.asm');
        expect([...graph.compilationUnit('file:///common.asm')].sort()).toEqual([
            'file:///common.asm', 'file:///one.asm', 'file:///only1.asm', 'file:///two.asm',
        ]);
    });
});
