import { describe, it, expect } from 'vitest';
import { TextEdit } from 'vscode-languageserver/node';
import { buildCodeActions } from '../../src/server/codeActions';
import { validateDocument } from '../../src/server/diagnostics';
import { createDoc, buildIndex } from '../helpers/doc';

/** Diagnose a source, then ask for the quick fixes on those diagnostics. */
function fixesFor(source: string, caseSensitive = false) {
    const doc = createDoc(source);
    const { documentIndex } = buildIndex({ source, uri: doc.uri, caseSensitive });
    const diagnostics = validateDocument(doc, documentIndex, caseSensitive);
    return {
        diagnostics,
        actions: buildCodeActions(doc, diagnostics, documentIndex, caseSensitive),
        uri: doc.uri,
    };
}

const titles = (source: string) => fixesFor(source).actions.map(a => a.title);
const editsOf = (source: string, index = 0) => {
    const { actions, uri } = fixesFor(source);
    return actions[index]?.edit?.changes?.[uri] as TextEdit[];
};

describe('undefined symbol fixes', () => {
    it('suggests a near-miss label', () => {
        expect(titles('counter = 1\nstart\n        lda countor')).toContain("Change to 'counter'");
    });

    it('replaces only the misspelled word', () => {
        const edits = editsOf('counter = 1\nstart\n        lda countor');
        expect(edits).toHaveLength(1);
        expect(edits[0].newText).toBe('counter');
        expect(edits[0].range.start.line).toBe(2);
    });

    it('offers nothing when no label is close enough', () => {
        expect(titles('counter = 1\nstart\n        lda zzzzzzzz')).toEqual([]);
    });

    it('rejects a candidate that is merely much longer', () => {
        // The length difference alone puts it past the threshold.
        expect(titles('ab = 1\nstart\n        lda abcdefghij')).toEqual([]);
    });

    it('still suggests across a small length difference', () => {
        expect(titles('counter = 1\nstart\n        lda counte')).toContain("Change to 'counter'");
    });

    it('offers at most three suggestions', () => {
        const source = ['aaa1 = 1', 'aaa2 = 2', 'aaa3 = 3', 'aaa4 = 4', 'aaa5 = 5', 'start', '        lda aaa'].join('\n');
        expect(titles(source).length).toBeLessThanOrEqual(3);
    });

    it('puts the closest suggestion first', () => {
        const source = ['counter = 1', 'countdown = 2', 'start', '        lda countor'].join('\n');
        expect(titles(source)[0]).toBe("Change to 'counter'");
    });

    it('preserves the display casing of the suggestion', () => {
        // Matching is case-insensitive by default, but the edit should insert the
        // name as it was written at the definition.
        const edits = editsOf('Counter = 1\nstart\n        lda countor');
        expect(edits[0].newText).toBe('Counter');
    });

    it('attaches the diagnostic it fixes', () => {
        const { actions, diagnostics } = fixesFor('counter = 1\nstart\n        lda countor');
        expect(actions[0].diagnostics).toEqual([diagnostics.find(d => d.code === 'undefined-symbol')]);
    });
});

describe('undefined macro fixes', () => {
    it('suggests a near-miss macro', () => {
        // The diagnostic's range covers the name only, not the leading dot, so the
        // replacement must not reintroduce one.
        const source = ['setptr  .macro', '        rts', '        .endm', 'start', '        .setpr'].join('\n');
        const edits = editsOf(source);
        expect(edits[0].newText).toBe('setptr');
        expect(edits[0].range.start.character).toBe(9);
    });

    it('does not suggest a plain label for a macro call', () => {
        const source = ['setptr  = 1', 'start', '        .setpr'].join('\n');
        expect(titles(source)).toEqual([]);
    });
});

describe('unclosed block fixes', () => {
    it('offers the matching closer', () => {
        expect(titles('outer   .proc\n        lda #1')).toContain("Add '.pend'");
    });

    it('inserts the closer at the end of the document', () => {
        const source = 'outer   .proc\n        lda #1';
        const edits = editsOf(source);
        expect(edits[0].newText).toContain('.pend');
        expect(edits[0].range.start.line).toBe(1);
    });

    it('matches the indentation of the opening line', () => {
        const edits = editsOf('    outer   .proc\n        lda #1');
        expect(edits[0].newText).toMatch(/\n {4}\.pend\n/);
    });

    it('offers the right closer per directive', () => {
        expect(titles('outer   .block\n        lda #1')).toContain("Add '.bend'");
        expect(titles('m       .macro\n        lda #1')).toContain("Add '.endm'");
    });
});

describe('buildCodeActions', () => {
    it('offers nothing for a clean document', () => {
        expect(titles('counter = 1\nstart\n        lda counter\n        rts')).toEqual([]);
    });

    it('ignores diagnostics it has no fix for', () => {
        // A duplicate label has no obvious repair; it should not produce an action.
        const { actions } = fixesFor('dup = 1\ndup = 2');
        expect(actions).toEqual([]);
    });
});
