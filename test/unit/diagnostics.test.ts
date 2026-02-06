import { describe, it, expect } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { validateDocument } from '../../src/server/diagnostics';
import { parseDocument } from '../../src/server/parser';
import { DocumentIndex } from '../../src/server/types';
import { createDoc } from '../helpers/doc';

function getDiagnostics(source: string) {
    const doc = createDoc(source);
    const index = parseDocument(doc);
    const documentIndex = new Map<string, DocumentIndex>([[doc.uri, index]]);
    return validateDocument(doc, documentIndex);
}

function errors(source: string) {
    return getDiagnostics(source).filter(d => d.severity === DiagnosticSeverity.Error);
}

function warnings(source: string) {
    return getDiagnostics(source).filter(d => d.severity === DiagnosticSeverity.Warning);
}

describe('duplicate label detection', () => {
    it('flags duplicate in global scope', () => {
        const diags = errors('label\nlabel');
        expect(diags.length).toBeGreaterThanOrEqual(1);
        expect(diags.some(d => d.message.includes('Duplicate'))).toBe(true);
    });

    it('allows same name in different scopes', () => {
        const diags = errors('a .proc\nx\n.pend\nb .proc\nx\n.pend');
        const dupes = diags.filter(d => d.message.includes('Duplicate'));
        expect(dupes).toHaveLength(0);
    });

    it('flags duplicate local under same parent', () => {
        const diags = errors('main\n_x = 1\n_x = 2');
        const dupes = diags.filter(d => d.message.includes('Duplicate'));
        expect(dupes.length).toBeGreaterThanOrEqual(1);
    });

    it('allows same local under different parents', () => {
        const diags = errors('a\n_x = 1\nb\n_x = 1');
        const dupes = diags.filter(d => d.message.includes('Duplicate'));
        expect(dupes).toHaveLength(0);
    });
});

describe('unclosed block detection', () => {
    it('flags unclosed .proc', () => {
        const diags = errors('x .proc\n        nop');
        expect(diags.some(d => d.message.includes('Unclosed'))).toBe(true);
    });

    it('flags unclosed .block', () => {
        const diags = errors('x .block\n        nop');
        expect(diags.some(d => d.message.includes('Unclosed'))).toBe(true);
    });

    it('no error for properly closed block', () => {
        const diags = errors('x .proc\n        nop\n.pend');
        const unclosed = diags.filter(d => d.message.includes('Unclosed'));
        expect(unclosed).toHaveLength(0);
    });

    it('flags unmatched closer', () => {
        const diags = errors('.pend');
        expect(diags.some(d => d.message.includes('without matching'))).toBe(true);
    });

    it('allows .logical without close (optional)', () => {
        const diags = errors('        .logical $2000\n        nop');
        const unclosed = diags.filter(d => d.message.includes('Unclosed'));
        expect(unclosed).toHaveLength(0);
    });
});

describe('undefined symbol warnings', () => {
    it('warns for undefined symbol in operand', () => {
        const diags = warnings('start\n        lda undef');
        expect(diags.some(d => d.message.includes('Undefined symbol'))).toBe(true);
    });

    it('no warning for defined symbol', () => {
        const diags = warnings('val = 1\nstart\n        lda #val');
        const undef = diags.filter(d => d.message.includes("Undefined symbol 'val'"));
        expect(undef).toHaveLength(0);
    });

    it('no warning for builtin names', () => {
        const diags = warnings('start\n        lda #true');
        const undef = diags.filter(d => d.message.includes("'true'"));
        expect(undef).toHaveLength(0);
    });

    it('no warning for registers used as builtins', () => {
        // 'a', 'x', 'y' are in BUILTINS
        const diags = warnings('start\n        tax');
        expect(diags).toHaveLength(0);
    });

    it('no warning for macro parameter', () => {
        const diags = warnings('m .macro p\n        lda #p\n.endm');
        const undef = diags.filter(d => d.message.includes("'p'"));
        expect(undef).toHaveLength(0);
    });

    it('no warning for symbol inside string', () => {
        const diags = warnings('start\n        .text "undef"');
        const undef = diags.filter(d => d.message.includes("'undef'"));
        expect(undef).toHaveLength(0);
    });

    it('no warning for hex digits after $', () => {
        const diags = warnings('start\n        lda $FF');
        const undef = diags.filter(d => d.message.includes("'FF'"));
        expect(undef).toHaveLength(0);
    });

    it('checks symbols after data directives', () => {
        const diags = warnings('start\n        .byte undef');
        expect(diags.some(d => d.message.includes("Undefined symbol 'undef'"))).toBe(true);
    });

    it('no warning for defined symbol in data directive', () => {
        const diags = warnings('val = 1\nstart\n        .byte val');
        const undef = diags.filter(d => d.message.includes("'val'"));
        expect(undef).toHaveLength(0);
    });
});

describe('undefined macro warnings', () => {
    it('warns for undefined macro call', () => {
        const diags = warnings('start\n        .nonexistent');
        expect(diags.some(d => d.message.includes('Undefined macro'))).toBe(true);
    });

    it('no warning for defined macro', () => {
        const diags = warnings('m .macro\n.endm\nstart\n        .m');
        const undef = diags.filter(d => d.message.includes("Undefined macro 'm'"));
        expect(undef).toHaveLength(0);
    });

    it('no warning for builtin directives', () => {
        const diags = warnings('start\n        .byte 1');
        const undef = diags.filter(d => d.message.includes("Undefined macro 'byte'"));
        expect(undef).toHaveLength(0);
    });
});
