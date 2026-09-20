import { describe, it, expect } from 'vitest';
import { DiagnosticSeverity, DiagnosticTag } from 'vscode-languageserver/node';
import { validateDocument } from '../../src/server/diagnostics';
import { parseDocument } from '../../src/server/parser';
import { DocumentIndex } from '../../src/server/types';
import { createDoc } from '../helpers/doc';

function getDiagnostics(source: string, options: { caseSensitive?: boolean } = {}) {
    const caseSensitive = options.caseSensitive ?? false;
    const doc = createDoc(source);
    const index = parseDocument(doc, { caseSensitive });
    const documentIndex = new Map<string, DocumentIndex>([[doc.uri, index]]);
    return validateDocument(doc, documentIndex, caseSensitive);
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

    // Verified against the assembler: .var and := are re-assignable, "=" is not
    it('allows .var to be reassigned', () => {
        const diags = errors('v\t.var 1\nv\t.var 2');
        expect(diags.filter(d => d.message.includes('Duplicate'))).toHaveLength(0);
    });

    it('allows := to be reassigned', () => {
        const diags = errors('v := 1\nv := 2');
        expect(diags.filter(d => d.message.includes('Duplicate'))).toHaveLength(0);
    });

    it('still flags a redefined = constant', () => {
        const diags = errors('v = 1\nv = 2');
        expect(diags.some(d => d.message.includes('Duplicate'))).toBe(true);
    });

    it('allows a local .var to be reassigned', () => {
        const diags = errors('main\n_acc\t.var 0\n_acc\t.var 1');
        expect(diags.filter(d => d.message.includes('Duplicate'))).toHaveLength(0);
    });

    it('allows .var reassignment inside a .for loop in a macro', () => {
        // Reduced from example/azure/_common/sinus.asm, which assembles cleanly
        const diags = errors([
            'gensin\t.macro',
            'last\t.var\t0',
            '\t.for i = 1, i <= 4, i = i + 1',
            'cur\t.var\ti * 2',
            '\t.byte <(cur - last)',
            'last\t.var cur',
            '\t.next',
            '\t.endm'
        ].join('\n'));
        expect(diags.filter(d => d.message.includes('Duplicate'))).toHaveLength(0);
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

    // The assembler rejects an unclosed .logical with
    // "closing directive '.endlogical' not found", so this must be reported.
    // It used to be suppressed, because .here was not registered as a closer.
    it('flags unclosed .logical', () => {
        const diags = errors('        .logical $2000\n        nop');
        expect(diags.some(d => d.message.includes('Unclosed'))).toBe(true);
    });

    it('accepts .logical closed by .here', () => {
        const diags = errors('        .logical $2000\n        nop\n        .here');
        expect(diags.filter(d => d.message.includes('Unclosed'))).toHaveLength(0);
        expect(diags.filter(d => d.message.includes('without matching'))).toHaveLength(0);
    });

    it('accepts .logical closed by .endlogical', () => {
        const diags = errors('        .logical $2000\n        nop\n        .endlogical');
        expect(diags.filter(d => d.message.includes('Unclosed'))).toHaveLength(0);
    });

    it('flags unclosed .virtual', () => {
        const diags = errors('        .virtual $2000\n        nop');
        expect(diags.some(d => d.message.includes('Unclosed'))).toBe(true);
    });

    it('accepts .virtual closed by .endv', () => {
        const diags = errors('        .virtual $2000\n        nop\n        .endv');
        expect(diags.filter(d => d.message.includes('Unclosed'))).toHaveLength(0);
    });

    it('does not accept .here as a closer for .virtual', () => {
        // Verified: the assembler rejects this with "opening directive '.logical' not found"
        const diags = errors('        .virtual $2000\n        nop\n        .here');
        expect(diags.some(d => d.message.includes('Unclosed') || d.message.includes('without matching'))).toBe(true);
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

    it('does not treat dot-tags inside a string literal as macro calls', () => {
        const diags = warnings('\t.ptext "{rght}{grn} .kOd. .gfx. .leon. .Arok. .2026.{END}"');
        expect(diags.filter(d => d.message.includes('Undefined macro'))).toHaveLength(0);
    });

    it('still warns for an undefined macro call after a string on the same line', () => {
        const diags = warnings('\t.ptext "text" .nonexistent');
        expect(diags.some(d => d.message.includes("Undefined macro 'nonexistent'"))).toBe(true);
    });
});

describe('data directive operator validation', () => {
    it('errors on .byte with missing commas', () => {
        const diags = errors('        .byte 1 2 3');
        expect(diags.some(d => d.message.includes('operator'))).toBe(true);
    });

    it('accepts .byte with commas', () => {
        const diags = errors('        .byte 1, 2, 3');
        const opErrors = diags.filter(d => d.message.includes('operator'));
        expect(opErrors).toHaveLength(0);
    });

    it('errors on .word with missing operators', () => {
        const diags = errors('        .word $1000 $2000');
        expect(diags.some(d => d.message.includes('operator'))).toBe(true);
    });

    it('accepts .word with commas', () => {
        const diags = errors('        .word $1000, $2000');
        const opErrors = diags.filter(d => d.message.includes('operator'));
        expect(opErrors).toHaveLength(0);
    });

    it('accepts expressions with operators', () => {
        const diags = errors('        .byte 2*3+4, 5-1');
        const opErrors = diags.filter(d => d.message.includes('operator'));
        expect(opErrors).toHaveLength(0);
    });

    it('accepts unary operators', () => {
        const diags = errors('        .byte -5, +10');
        const opErrors = diags.filter(d => d.message.includes('operator'));
        expect(opErrors).toHaveLength(0);
    });

    // All of these forms are accepted by the assembler (verified); each used to be
    // split into two adjacent values and reported as a missing operator.
    it.each([
        ['float literal', '        .byte 360.0/4'],
        ['leading-dot float', '        .byte 1 + .5'],
        ['trailing-dot float', '        .byte 1. + 1'],
        ['exponent', '        .byte 1e2'],
        ['negative exponent', '        .byte 2.5e-3'],
        ['numbered macro argument', '        .byte \\1 * 2'],
        ['named macro argument', '        .byte \\name + 1'],
        ['dotted reference', '        .word tbl.lo'],
        ['multi-level dotted reference', '        .word scope.sub.val'],
        ['the sinus.asm expression', '        .byte <\\1 * sin(range(\\2) * rad(360.0/\\2))'],
    ])('accepts %s', (_name, source) => {
        const diags = errors(source);
        const opErrors = diags.filter(d => d.message.includes('operator'));
        expect(opErrors).toHaveLength(0);
    });

    // The check must still catch genuinely adjacent values
    it.each([
        ['two numbers', '        .byte 1 2'],
        ['two identifiers', '        .byte a b'],
        ['number then identifier', '        .byte 1 tbl'],
        ['two floats', '        .byte 1.5 2.5'],
        ['two dotted references', '        .word a.b c.d'],
    ])('still errors on %s', (_name, source) => {
        const diags = errors(source);
        expect(diags.some(d => d.message.includes('operator'))).toBe(true);
    });

    it('errors on .text with missing operator between strings', () => {
        const diags = errors('        .text "hello" "world"');
        expect(diags.some(d => d.message.includes('operator'))).toBe(true);
    });

    it('accepts .text with comma between strings', () => {
        const diags = errors('        .text "hello", "world"');
        const opErrors = diags.filter(d => d.message.includes('operator'));
        expect(opErrors).toHaveLength(0);
    });

    it('accepts parenthesized expressions', () => {
        const diags = errors('        .byte (1+2), 3');
        const opErrors = diags.filter(d => d.message.includes('operator'));
        expect(opErrors).toHaveLength(0);
    });

    it('accepts shift operators', () => {
        const diags = errors('        .word $1000<<8, $FF>>1');
        const opErrors = diags.filter(d => d.message.includes('operator'));
        expect(opErrors).toHaveLength(0);
    });

    it('accepts bitwise operators', () => {
        const diags = errors('        .byte $FF&$0F, $F0|$0F, $FF^$AA');
        const opErrors = diags.filter(d => d.message.includes('operator'));
        expect(opErrors).toHaveLength(0);
    });

    it('errors on identifiers without operators', () => {
        const diags = errors('a=1\nb=2\n        .byte a b');
        expect(diags.some(d => d.message.includes('operator'))).toBe(true);
    });

    it('accepts identifiers with operators', () => {
        const diags = errors('a=1\nb=2\n        .byte a, b');
        const opErrors = diags.filter(d => d.message.includes('operator'));
        expect(opErrors).toHaveLength(0);
    });
});

describe('anonymous label diagnostics', () => {
    it('allows multiple anonymous labels in same scope', () => {
        const source = 'main\n-\n        nop\n-\n        nop\n-\n        nop';
        const diags = errors(source);
        const duplicates = diags.filter(d => d.message.includes('Duplicate'));
        expect(duplicates).toHaveLength(0);
    });

    it('does not flag arithmetic + as anonymous label', () => {
        const source = 'table = $1000\n        lda table+1';
        const diags = warnings(source);
        const anonWarnings = diags.filter(d => d.message.includes('anonymous label'));
        expect(anonWarnings).toHaveLength(0);
    });

    it('does not flag arithmetic - as anonymous label', () => {
        const source = 'value = 100\n        lda value-10';
        const diags = warnings(source);
        const anonWarnings = diags.filter(d => d.message.includes('anonymous label'));
        expect(anonWarnings).toHaveLength(0);
    });

    it('does not flag immediate mode +/- as anonymous label', () => {
        const source = '        lda #-1\n        ldx #+5';
        const diags = warnings(source);
        const anonWarnings = diags.filter(d => d.message.includes('anonymous label'));
        expect(anonWarnings).toHaveLength(0);
    });

    it('warns about unresolved forward anonymous label', () => {
        const source = 'main\n        bcc +';
        const diags = warnings(source);
        expect(diags.some(d => d.message.includes('No forward anonymous label'))).toBe(true);
    });

    it('warns about unresolved backward anonymous label', () => {
        const source = 'main\n        bne -';
        const diags = warnings(source);
        expect(diags.some(d => d.message.includes('No backward anonymous label'))).toBe(true);
    });

    it('does not warn when forward label exists', () => {
        const source = 'main\n        bcc +\n+';
        const diags = warnings(source);
        const anonWarnings = diags.filter(d => d.message.includes('anonymous label'));
        expect(anonWarnings).toHaveLength(0);
    });

    it('does not warn when backward label exists', () => {
        const source = 'main\n-\n        bne -';
        const diags = warnings(source);
        const anonWarnings = diags.filter(d => d.message.includes('anonymous label'));
        expect(anonWarnings).toHaveLength(0);
    });

    it('does not flag +/- in data directives as anonymous labels', () => {
        const source = '        .byte -5, +10, 3+4, 7-2';
        const diags = warnings(source);
        const anonWarnings = diags.filter(d => d.message.includes('anonymous label'));
        expect(anonWarnings).toHaveLength(0);
    });

    it('does not flag +/- in .word directives', () => {
        const source = '        .word $1000+offset, base-$10';
        const diags = warnings(source);
        const anonWarnings = diags.filter(d => d.message.includes('anonymous label'));
        expect(anonWarnings).toHaveLength(0);
    });

    it('checks anonymous labels only in opcodes, not data directives', () => {
        // Should warn about unresolved + in opcode
        const source1 = 'main\n        bcc +';
        const diags1 = warnings(source1);
        expect(diags1.some(d => d.message.includes('No forward anonymous label'))).toBe(true);

        // Should NOT warn about + in data directive
        const source2 = 'main\n        .byte 1+2';
        const diags2 = warnings(source2);
        const anonWarnings2 = diags2.filter(d => d.message.includes('anonymous label'));
        expect(anonWarnings2).toHaveLength(0);
    });

    it('does not flag + in middle of expression as anonymous label', () => {
        const source = 'table = $1000\n        dec table + 5';
        const diags = warnings(source);
        const anonWarnings = diags.filter(d => d.message.includes('anonymous label'));
        expect(anonWarnings).toHaveLength(0);
    });

    it('does not flag - in middle of expression as anonymous label', () => {
        const source = 'value = 100\n        lda value - 10';
        const diags = warnings(source);
        const anonWarnings = diags.filter(d => d.message.includes('anonymous label'));
        expect(anonWarnings).toHaveLength(0);
    });
});

describe('loop variables', () => {
    it('does not flag the .for loop variable as undefined', () => {
        const diags = warnings('        .for i = 0, i < 13, i = i + 1\n        .byte i\n        .next');
        expect(diags.filter(d => d.message.includes("'i'"))).toHaveLength(0);
    });

    it('does not flag a loop variable used in an expression', () => {
        const diags = warnings([
            'colortab .byte 1, 2, 3',
            'screen = $0400',
            '        .for i = 0, i < 13, i = i + 1',
            '        lda colortab + 13 - i,y',
            '        sta screen + i * 40,x',
            '        .next'
        ].join('\n'));
        expect(diags.filter(d => d.message.includes("'i'"))).toHaveLength(0);
    });

    it('does not report the same loop variable in two loops as a duplicate', () => {
        const diags = errors([
            '        .for i = 0, i < 2, i = i + 1',
            '        .next',
            '        .for i = 0, i < 2, i = i + 1',
            '        .next'
        ].join('\n'));
        expect(diags.filter(d => d.message.includes('Duplicate'))).toHaveLength(0);
    });
});

describe('block directives inside string literals', () => {
    // ".text "a .proc b"" assembles cleanly; the directive name is just text
    it('does not open a block for a directive inside a string', () => {
        const diags = errors('\t.text "text with .proc inside"');
        expect(diags.filter(d => d.message.includes('Unclosed'))).toHaveLength(0);
    });

    it('does not close a block for a directive inside a string', () => {
        const diags = errors('\t.text "close it .pend here"');
        expect(diags.filter(d => d.message.includes('without matching'))).toHaveLength(0);
    });

    it('does not open a .macro for a directive inside a string', () => {
        const diags = errors('\t.text "a .macro b"');
        expect(diags.filter(d => d.message.includes('Unclosed'))).toHaveLength(0);
    });

    it('leaves a real block around a string containing a directive name intact', () => {
        const diags = errors('p .proc\n\t.text "nested .proc word"\n.pend');
        expect(diags.filter(d => d.message.includes('Unclosed'))).toHaveLength(0);
        expect(diags.filter(d => d.message.includes('without matching'))).toHaveLength(0);
    });

    it('still detects a genuinely unclosed block', () => {
        const diags = errors('p .proc\n\t.text "harmless"');
        expect(diags.some(d => d.message.includes('Unclosed'))).toBe(true);
    });

    it('still detects a genuinely unmatched closer', () => {
        const diags = errors('\t.text "harmless"\n.pend');
        expect(diags.some(d => d.message.includes('without matching'))).toBe(true);
    });
});

describe('label definitions do not silence the rest of the line', () => {
    it('checks the operand after a colon-terminated label', () => {
        const diags = warnings('loop: lda undefined_thing');
        expect(diags.some(d => d.message.includes("Undefined symbol 'undefined_thing'"))).toBe(true);
    });

    it('reports the operand at the right column after a colon label', () => {
        const [d] = warnings('loop: lda undefined_thing');
        expect(d.range.start.character).toBe('loop: lda '.length);
    });

    it('checks the operand after a colon-terminated data label', () => {
        const diags = warnings('tbl: .byte undefined_thing');
        expect(diags.some(d => d.message.includes("Undefined symbol 'undefined_thing'"))).toBe(true);
    });

    it('checks the right-hand side of an = assignment', () => {
        const diags = warnings('foo = undefined_thing + 1');
        expect(diags.some(d => d.message.includes("Undefined symbol 'undefined_thing'"))).toBe(true);
        expect(diags[0].range.start.character).toBe('foo = '.length);
    });

    it('checks the right-hand side of a := assignment', () => {
        const diags = warnings('foo := undefined_thing + 1');
        expect(diags.some(d => d.message.includes("Undefined symbol 'undefined_thing'"))).toBe(true);
        expect(diags[0].range.start.character).toBe('foo := '.length);
    });

    it('does not warn when the right-hand side is defined', () => {
        const diags = warnings('val = 1\nfoo = val + 1');
        expect(diags.filter(d => d.message.includes('Undefined'))).toHaveLength(0);
    });

    it('does not warn for the defined name itself', () => {
        expect(warnings('loop:')).toHaveLength(0);
        expect(warnings('loop:\tinx')).toHaveLength(0);
    });

    it('still ignores scope openers, with or without a colon', () => {
        expect(errors('p: .proc\n.pend').filter(d => d.message.includes('Undefined'))).toHaveLength(0);
        expect(warnings('m: .macro a\n.endm').filter(d => d.message.includes("'a'"))).toHaveLength(0);
    });

    it('checks operator placement after a colon label', () => {
        const diags = errors('tbl: .byte 1 2');
        expect(diags.some(d => d.message.includes('operator'))).toBe(true);
    });
});

describe('inactive .if branches', () => {
    // The assembler never evaluates a dead branch, so symbols there are not resolved.
    // Only provably-dead branches are suppressed - undecidable ones stay reported.
    it('suppresses undefined symbols in a .if 0 branch', () => {
        expect(warnings('\t.if 0\n\tjsr nope\n\t.endif')).toHaveLength(0);
    });

    it('still reports them in a .if 1 branch', () => {
        expect(warnings('\t.if 1\n\tjsr nope\n\t.endif')
            .some(d => d.message.includes("'nope'"))).toBe(true);
    });

    it('decides a branch from a constant flag', () => {
        expect(warnings('linking = 0\n\t.if linking = 1\n\tjsr nope\n\t.endif')).toHaveLength(0);
        expect(warnings('linking = 1\n\t.if linking = 1\n\tjsr nope\n\t.endif')
            .some(d => d.message.includes("'nope'"))).toBe(true);
    });

    it('keeps reporting when the condition cannot be decided', () => {
        // The flag itself is undefined, so we must not assume either branch is dead
        expect(warnings('\t.if unknown_flag\n\tjsr nope\n\t.endif')
            .some(d => d.message.includes("'nope'"))).toBe(true);
        // Program counter is not statically known
        expect(warnings('\t.if *>=$1000\n\tjsr nope\n\t.endif')
            .some(d => d.message.includes("'nope'"))).toBe(true);
    });

    it('reports only the taken side of an .else', () => {
        const diags = warnings('f = 0\n\t.if f\n\tjsr a_nope\n\t.else\n\tjsr b_nope\n\t.endif');
        expect(diags.some(d => d.message.includes("'a_nope'"))).toBe(false);
        expect(diags.some(d => d.message.includes("'b_nope'"))).toBe(true);
    });

    it('reports only the taken side of an .elsif chain', () => {
        const diags = warnings('f = 2\n\t.if f = 1\n\tjsr a_nope\n\t.elsif f = 2\n\tjsr b_nope\n\t.endif');
        expect(diags.some(d => d.message.includes("'a_nope'"))).toBe(false);
        expect(diags.some(d => d.message.includes("'b_nope'"))).toBe(true);
    });

    it('treats everything inside a dead outer block as dead', () => {
        expect(warnings('\t.if 0\n\t.if 1\n\tjsr nope\n\t.endif\n\t.endif')).toHaveLength(0);
    });

    it('resumes reporting after .endif', () => {
        const diags = warnings('\t.if 0\n\tjsr a_nope\n\t.endif\n\tjsr b_nope');
        expect(diags.some(d => d.message.includes("'a_nope'"))).toBe(false);
        expect(diags.some(d => d.message.includes("'b_nope'"))).toBe(true);
    });

    it('does not suppress other diagnostics in a dead branch', () => {
        // Only undefined-symbol reporting is skipped; structural errors still apply
        expect(errors('\t.if 0\n\t.byte 1 2\n\t.endif')
            .some(d => d.message.includes('operator'))).toBe(true);
    });
});

describe('define pragma', () => {
    it('resolves a flag supplied by the pragma', () => {
        const src = '; 64tass-langserv: define linking = 0\n\t.if linking = 1\n\tjsr nope\n\t.endif';
        expect(warnings(src)).toHaveLength(0);
    });

    it('keeps the branch live when the pragma makes the condition true', () => {
        const src = '; 64tass-langserv: define linking = 1\n\t.if linking = 1\n\tjsr nope\n\t.endif';
        expect(warnings(src).some(d => d.message.includes("'nope'"))).toBe(true);
    });

    it('makes the defined symbol resolvable in ordinary code', () => {
        const src = '; 64tass-langserv: define screen = $0400\nstart\n\tlda screen';
        expect(warnings(src).filter(d => d.message.includes("'screen'"))).toHaveLength(0);
    });

    it('does not report a redefinition as a duplicate', () => {
        const src = '; 64tass-langserv: define f = 0\n; 64tass-langserv: define f = 1\nstart';
        expect(errors(src).filter(d => d.message.includes('Duplicate'))).toHaveLength(0);
    });
});

describe('diagnostic ranges', () => {
    /** The source text the diagnostic's range actually covers. */
    function slice(source: string, d: { range: { start: { line: number; character: number }; end: { character: number } } }) {
        return source.split('\n')[d.range.start.line].slice(d.range.start.character, d.range.end.character);
    }

    // Every message quotes a name in single quotes; the range must cover exactly
    // that text, otherwise the squiggle sits on the wrong token.
    it.each([
        ['        lda undef_sym'],
        ['start\n        lda undef_sym'],
        ['loop: lda undef_sym'],
        ['foo = undef_sym + 1'],
        ['foo := undef_sym + 1'],
        ['tbl: .byte undef_sym'],
        ['        .byte 1 2'],
        ['        .byte 1 1 1'],
        ['val     .byte val val'],
        ['        .nonexistent'],
        ['label\nlabel'],
    ])('range matches the quoted name for %j', (source) => {
        const diags = getDiagnostics(source);
        expect(diags.length).toBeGreaterThan(0);
        for (const d of diags) {
            const quoted = d.message.match(/'([^']*)'/);
            if (!quoted) continue; // messages without a quoted name (e.g. "Unclosed ...")
            expect(slice(source, d), `${d.message} @ c${d.range.start.character}`).toBe(quoted[1]);
        }
    });

    it('places the operand correctly when the label repeats the operand text', () => {
        // Guards the operandStart derivation: indexOf would find the label at c0
        const source = 'val     .byte val val';
        const [d] = errors(source);
        expect(slice(source, d)).toBe('val');
        expect(d.range.start.character).toBe(source.lastIndexOf('val'));
    });

    it('reports a non-zero start column for an indented operand', () => {
        const [d] = warnings('        lda undef_sym');
        expect(d.range.start.character).toBe('        lda '.length);
    });

    it('gives every diagnostic a well-formed range', () => {
        const source = 'label\nlabel\n        lda undef\n        .byte 1 2\n.pend';
        for (const d of getDiagnostics(source)) {
            expect(d.range.start.line).toBeGreaterThanOrEqual(0);
            expect(d.range.start.character).toBeGreaterThanOrEqual(0);
            expect(d.range.end.character).toBeGreaterThan(d.range.start.character);
            expect(d.range.end.line).toBe(d.range.start.line);
        }
    });
});

describe('undefined macro range', () => {
    it('points at the macro name, not the leading dot', () => {
        // 64tass reports "not defined symbol 'nonexistent'" at the 'n', not the '.'
        const source = '        .nonexistent';
        const [d] = warnings(source);
        expect(d.range.start.character).toBe(source.indexOf('nonexistent'));
        expect(d.range.end.character).toBe(source.length);
    });
});

describe('duplicate labels across conditional branches', () => {
    // Each case below was checked against the assembler: it accepts definitions in
    // different branches of a chain, and rejects the rest.
    it('accepts the same label in .if and .else', () => {
        const diags = errors('        .if 1\nfoo     nop\n        .else\nfoo     lda #1\n        .endif');
        expect(diags.filter(d => d.message.includes('Duplicate'))).toHaveLength(0);
    });

    it('accepts it even when the condition cannot be decided', () => {
        // Mutual exclusion holds regardless of whether we can evaluate the flag
        const diags = errors('        .if unknown_flag\nfoo     nop\n        .else\nfoo     lda #1\n        .endif');
        expect(diags.filter(d => d.message.includes('Duplicate'))).toHaveLength(0);
    });

    it('accepts it across an .if/.elsif/.else chain', () => {
        const diags = errors([
            '        .if 0', 'foo     nop',
            '        .elsif 1', 'foo     lda #1',
            '        .else', 'foo     iny',
            '        .endif'
        ].join('\n'));
        expect(diags.filter(d => d.message.includes('Duplicate'))).toHaveLength(0);
    });

    it('accepts a nested branch versus the outer .else', () => {
        const diags = errors([
            '        .if 1', '        .if 1', 'foo     nop', '        .endif',
            '        .else', 'foo     lda #1', '        .endif'
        ].join('\n'));
        expect(diags.filter(d => d.message.includes('Duplicate'))).toHaveLength(0);
    });

    // ...and still reports the cases the assembler rejects
    it('still flags a duplicate within the same branch', () => {
        const diags = errors('        .if 1\nfoo     nop\nfoo     lda #1\n        .endif');
        expect(diags.some(d => d.message.includes("Duplicate label 'foo'"))).toBe(true);
    });

    it('still flags a label defined inside a branch and outside it', () => {
        const diags = errors('foo     nop\n        .if 1\nfoo     lda #1\n        .endif');
        expect(diags.some(d => d.message.includes("Duplicate label 'foo'"))).toBe(true);
    });

    it('still flags duplicates in unrelated conditional chains', () => {
        const diags = errors([
            '        .if 1', 'foo     nop', '        .endif',
            '        .if 1', 'foo     lda #1', '        .endif'
        ].join('\n'));
        expect(diags.some(d => d.message.includes("Duplicate label 'foo'"))).toBe(true);
    });

    it('still flags a plain duplicate with no conditionals at all', () => {
        expect(errors('foo\nfoo').some(d => d.message.includes('Duplicate'))).toBe(true);
    });
});

describe('register operands', () => {
    // 64tass accepts a register where an address would go, assembling it to the
    // matching transfer/accumulator instruction. Each case below was checked
    // against the assembler.
    it.each([
        ['lda x', 'TXA'], ['lda y', 'TYA'],
        ['ldx a', 'TAX'], ['ldy a', 'TAY'],
        ['ldx s', 'TSX'], ['stx s', 'TXS'],
        ['asl a', 'accumulator ASL'], ['lsr a', 'accumulator LSR'],
        ['rol a', 'accumulator ROL'], ['ror a', 'accumulator ROR'],
        ['psh p', 'PHP'], ['pul p', 'PLP'],
        ['psh a', 'PHA'], ['pul a', 'PLA'],
    ])('does not report %s (%s) as an undefined symbol', (source) => {
        expect(warnings('        ' + source).filter(d => d.message.includes('Undefined'))).toHaveLength(0);
    });

    it.each([
        'lda tbl,x',      // ordinary indexed
        'lda tbl,y',
        'lda $01,s',      // 65816 stack-relative
        'lda $10,b',      // bank suffix (forces absolute)
        'lda $10,d',      // direct-page suffix
    ])('does not report the index register or suffix in %s', (source) => {
        const diags = warnings('tbl .byte 1\n        ' + source);
        expect(diags.filter(d => d.message.includes('Undefined'))).toHaveLength(0);
    });

    // ...without becoming a blanket exemption for short names
    it('still reports a symbol that is not a register mode for that opcode', () => {
        // 'i' is a register only on 65EL02, and never for lda
        expect(warnings('        lda i').some(d => d.message.includes("Undefined symbol 'i'"))).toBe(true);
    });

    it('still reports the base symbol of an indexed operand', () => {
        expect(warnings('        lda nope,x').some(d => d.message.includes("Undefined symbol 'nope'"))).toBe(true);
    });

    it('still reports an ordinary undefined operand', () => {
        expect(warnings('        lda undefined_thing')
            .some(d => d.message.includes("Undefined symbol 'undefined_thing'"))).toBe(true);
    });
});

describe('missing-operator check: expression syntax', () => {
    const errorsFor = (source: string) =>
        getDiagnostics(source).filter(d => d.message.includes(String.raw`operator is expected`)).map(d => d.message);

    it.each([
        ['index', '        .text d[2]'],
        ['slice a:b', '        .text d[2:4]'],
        ['slice :n', '        .text d[:4]'],
        ['slice n:', '        .text d[4:]'],
        ['slice ::step', '        .text d[::2]'],
        ['slice :n:step', '        .text d[:6:2]'],
        ['ternary', '        .byte f ? 1 : 2'],
        ['ternary with a slice', '        .text d[:2000:2]'],
        ['ternary yielding a list', '        .text f ? d : []'],
        ['concatenation', '        .text "ab" .. "cd"'],
        ['equality', '        .byte 1 == 1'],
        ['inequality', '        .byte 1 != 2'],
        ['less or equal', '        .byte 1 <= 2'],
        ['greater or equal', '        .byte 2 >= 1'],
        ['logical and', '        .byte 1 && 1'],
        ['logical or', '        .byte 1 || 0'],
        ['power', '        .byte 2 ** 3'],
        ['modulo', '        .byte 7 % 3'],
        ['modulo without spaces', '        .byte 7%10'],
        ['unary not', '        .byte !0'],
        ['unary complement', '        .byte ~1 & 3'],
    ])('accepts %s', (_name, line) => {
        expect(errorsFor(`d = "abcdefgh"\nf = 1\n${line}`)).toEqual([]);
    });

    it('reads % as a binary prefix at the start and as modulo after a value', () => {
        // Verified against the assembler: `.byte %1010` emits 10, and
        // `.byte %1010 %0101` emits 10 as well - binary 1010 modulo decimal 101 -
        // so the second % is an operator and the line is not an error.
        expect(errorsFor('        .byte %1010')).toEqual([]);
        expect(errorsFor('        .byte %1010 %0101')).toEqual([]);
    });

    it('still reports two values with no operator between them', () => {
        expect(errorsFor('        .text "hello" "world"')).toHaveLength(1);
        expect(errorsFor('        .byte 1 2')).toHaveLength(1);
    });
});

describe('.comment blocks', () => {
    it('reports nothing inside a comment block', () => {
        expect(getDiagnostics('        .comment\n        lda undefined_thing\n        .endc\n        nop')).toEqual([]);
    });

    it('does not see a duplicate across a comment block', () => {
        expect(errors('        .comment\nstart   lda #0\n        .endc\nstart   lda #0')).toEqual([]);
    });

    it('still reports an unclosed comment block', () => {
        // The delimiting lines are not skipped, so the pairing check still runs.
        const reported = errors('        .comment\n        junk');
        expect(reported.map(d => d.code)).toContain('unclosed-block');
    });

    it('still reports outside the block', () => {
        const reported = warnings('        .comment\n        junk\n        .endc\n        lda undefined_thing');
        expect(reported).toHaveLength(1);
        expect(reported[0].range.start.line).toBe(3);
    });
});

describe('dict literals', () => {
    it('does not report dict keys as undefined macros or symbols', () => {
        // "{.MAP: last == 0}" names a key; it is neither a macro call nor a
        // reference to a symbol called MAP.
        expect(getDiagnostics('last = 1\nCOLORING = {.MAP: last == 0, .TILE: last == 1}')).toEqual([]);
    });

    it('still reports an undefined symbol used as a dict value', () => {
        const reported = warnings('d = {.A: nosuchthing}');
        expect(reported.map(d => d.message)).toEqual(["Undefined symbol 'nosuchthing'"]);
    });

    it('still reports an undefined macro outside a dict', () => {
        expect(warnings('        .nosuchmacro').map(d => d.code)).toContain('undefined-macro');
    });
});

describe('compound assignment', () => {
    it('does not report a duplicate when a local is appended to', () => {
        expect(errors('_items    := []\n_differences    ..= [1]')).toEqual([]);
    });
});

describe('symbol names the assembler will not accept', () => {
    const codesFor = (source: string) => getDiagnostics(source).map(d => d.code);
    const firstMessage = (source: string) => getDiagnostics(source)[0]?.message;

    // The manual: "Regular symbol names are starting with a letter and containing
    // letters, numbers and underscores." Anything else ends the name, so the rest
    // of the line is a syntax error - and a run of them all redefine the same
    // truncated name.
    it.each([
        ['pound', 'SYM_\u00a3 =  $30', '\u00a3'],
        ['right bracket', 'SYM_] =  $32', ']'],
        ['up arrow', 'SYM_\u2191 =  $36', '\u2191'],
        ['question mark', 'SYM_? =  $37', '?'],
        ['plus', 'SYM_+ =  $28', '+'],
        ['at sign', 'SYM_@ =  $2E', '@'],
        ['less than', 'SYM_< =  $2F', '<'],
    ])('reports a %s in a symbol name', (_name, line, character) => {
        expect(codesFor(line)).toContain('invalid-symbol-character');
        expect(firstMessage(line)).toBe(`'${character}' is not allowed in a symbol name`);
    });

    it('points at the offending character', () => {
        const source = '        SYM_] =  $32';
        const [diagnostic] = getDiagnostics(source);
        expect(source.slice(diagnostic.range.start.character, diagnostic.range.end.character)).toBe(']');
    });

    it('reports a name whose trailing character is the assignment operator', () => {
        // "SYM_= = $35" - the name ends at SYM_, leaving an assignment with no
        // expression, which is what the assembler complains about.
        expect(codesFor('SYM_= =  $35')).toContain('expression-expected');
    });

    it.each(['foo =', 'foo = = 5', 'a == 1'])('reports "%s" as missing an expression', (line) => {
        expect(codesFor(line)).toContain('expression-expected');
    });

    it.each([
        ['a plain name', 'SYM_X = $30'],
        ['digits in the name', 'SYM_5 = $10'],
        ['a local', '_local = 1'],
        ['a member assignment', '_obj.init = 1'],
        ['the program counter', '* = $1000'],
        ['a variable', 'v := 1'],
        ['a compound assignment', '_v ..= [1]'],
        ['a comparison in a condition', '        .if a == 1'],
        ['an inequality', '        .cerror len(a) != 2, "no"'],
    ])('accepts %s', (_name, line) => {
        expect(codesFor(line)).not.toContain('invalid-symbol-character');
        expect(codesFor(line)).not.toContain('expression-expected');
    });

    it('accepts a non-ASCII letter, which is valid under the -a flag', () => {
        // The extension cannot see the command line, so it stays lenient here:
        // a missed error without -a beats reporting good code with it. Verified:
        // "SYM_\u00e9 = $30" assembles with -a and not without.
        expect(codesFor('SYM_\u00e9 = $30')).not.toContain('invalid-symbol-character');
    });
});

describe('duplicate labels and dead branches', () => {
    // All four verified against the assembler.
    it('does not report a definition inside a branch that cannot be taken', () => {
        expect(errors('start\n        .if 0\n_speed = * + 1\n        .fi\n_speed = * + 1')).toEqual([]);
    });

    it('still reports one inside a branch that IS taken', () => {
        expect(errors('        .if 1\nfoo = 1\n        .fi\nfoo = 2')).toHaveLength(1);
    });

    it('still reports a plain duplicate', () => {
        expect(errors('foo = 1\nfoo = 2')).toHaveLength(1);
    });

    it('still ignores mutually exclusive branches', () => {
        expect(errors('        .if 1\nfoo = 1\n        .else\nfoo = 2\n        .fi')).toEqual([]);
    });

    it('does not let a dead definition suppress a later real duplicate', () => {
        // The dead one is ignored entirely, so the two live ones still collide.
        const reported = errors('        .if 0\nfoo = 1\n        .fi\nfoo = 2\nfoo = 3');
        expect(reported).toHaveLength(1);
        expect(reported[0].range.start.line).toBe(4);
    });
});

describe('duplicate label message', () => {
    it('says where the other definition is', () => {
        const [reported] = errors('foo = 1\nfoo = 2');
        expect(reported.message).toBe("Duplicate label 'foo', also defined on line 1");
    });

    it('links to it for the client to render', () => {
        const [reported] = errors('foo = 1\nfoo = 2');
        expect(reported.relatedInformation).toHaveLength(1);
        expect(reported.relatedInformation![0].location.range.start.line).toBe(0);
        expect(reported.relatedInformation![0].message).toBe('first defined here');
    });

    it('points at the nearest colliding definition, not a mutually exclusive one', () => {
        const source = '        .if 1\nfoo = 1\n        .else\nfoo = 2\n        .fi\nfoo = 3';
        const [reported] = errors(source);
        expect(reported.message).toContain('line 2');
    });
});

describe('openers that require a label', () => {
    // Verified: the assembler answers "label required" for these four and accepts
    // the others unnamed.
    it.each(['.proc', '.macro', '.function', '.segment'])('reports a bare %s', (directive) => {
        expect(errors(`        ${directive}`).map(d => d.code)).toContain('label-required');
    });

    it.each(['.block', '.struct', '.union', '.namespace'])('accepts a bare %s', (directive) => {
        expect(errors(`        ${directive}`).map(d => d.code)).not.toContain('label-required');
    });

    it('accepts them when they do have a label', () => {
        expect(errors('name    .proc\n        .pend').map(d => d.code)).not.toContain('label-required');
    });

    it('is not fooled by one inside a comment', () => {
        expect(errors('        nop     ; a .proc here').map(d => d.code)).not.toContain('label-required');
    });
});

describe('mnemonics the target CPU does not have', () => {
    // Every expectation here was checked against 64tass with --m6502: `bra lbl`
    // is "general syntax", while a lone `phx` is a legal label definition.
    function onCpu(source: string, cpu = '6502i') {
        const doc = createDoc('        .cpu "' + cpu + '"\n' + source);
        const index = parseDocument(doc, { cpu });
        const documentIndex = new Map<string, DocumentIndex>([[doc.uri, index]]);
        return validateDocument(doc, documentIndex)
            .filter(d => d.code === 'unsupported-mnemonic');
    }

    it('reports a mnemonic that belongs to another target', () => {
        const found = onCpu('lbl\n        bra lbl');
        expect(found).toHaveLength(1);
        expect(found[0].message).toBe("'bra' is not a 6502i instruction");
        expect(found[0].range.start.character).toBe(8);
    });

    it('reports it in the instruction slot after a label', () => {
        const found = onCpu('loop    bra loop');
        expect(found).toHaveLength(1);
        expect(found[0].range.start.character).toBe(8);
    });

    it('reports it after a label even with nothing following', () => {
        expect(onCpu('loop    bra')).toHaveLength(1);
    });

    it('accepts it as a label when nothing follows', () => {
        expect(onCpu('        phx\n        rts')).toHaveLength(0);
    });

    it('accepts it as a label followed by an instruction', () => {
        expect(onCpu('        bra nop')).toHaveLength(0);
    });

    it('accepts it as an assignment or data label', () => {
        expect(onCpu('        bra = 5')).toHaveLength(0);
        expect(onCpu('bra     .byte 1')).toHaveLength(0);
    });

    it('accepts it on a target that has it', () => {
        expect(onCpu('lbl\n        bra lbl', '65c02')).toHaveLength(0);
    });

    it('reports against the default target when a file declares none', () => {
        // Judged against the target in force. A project on a wider CPU says so
        // with a `.cpu` directive, a pragma or the setting - staying silent here
        // would mean saying nothing about most real sources.
        const doc = createDoc('lbl\n        bra lbl');
        const index = parseDocument(doc);
        const documentIndex = new Map<string, DocumentIndex>([[doc.uri, index]]);
        expect(validateDocument(doc, documentIndex)
            .filter(d => d.code === 'unsupported-mnemonic')).toHaveLength(1);
    });

    it('says nothing when a macro of that name exists', () => {
        // A macro makes the line a macro call, which assembles (verified).
        expect(onCpu('bra     .macro\n        .endm\n        bra lbl')).toHaveLength(0);
    });

    it('still checks the operand of a mnemonic the target lacks', () => {
        // The narrow gate used to stop treating the line as an instruction at all,
        // so one missing mnemonic disabled symbol checking for the whole line.
        const doc = createDoc('        bra nowhere');
        const index = parseDocument(doc);
        const documentIndex = new Map<string, DocumentIndex>([[doc.uri, index]]);
        expect(validateDocument(doc, documentIndex)
            .some(d => d.code === 'undefined-symbol' && d.message.includes('nowhere'))).toBe(true);
    });
});

describe('operands with no addressing mode', () => {
    function onCpu(source: string, cpu?: string) {
        const doc = createDoc(cpu ? '        .cpu "' + cpu + '"\n' + source : source);
        const index = parseDocument(doc, cpu ? { cpu } : {});
        const documentIndex = new Map<string, DocumentIndex>([[doc.uri, index]]);
        return validateDocument(doc, documentIndex).filter(d => d.code === 'no-addressing-mode');
    }

    it('reports an index the opcode has no mode for', () => {
        const found = onCpu('        ldx $10,x');
        expect(found).toHaveLength(1);
        expect(found[0].message).toBe("no x indexed addressing mode for opcode 'ldx'");
        // The range covers the operand, where 64tass points.
        expect(found[0].range.start.character).toBe(12);
        expect(found[0].range.end.character).toBe(17);
    });

    it('reports an index on the wrong side of the brackets', () => {
        expect(onCpu('        lda ($10),x')).toHaveLength(1);
    });

    it('accepts the forms that do assemble', () => {
        expect(onCpu('        lda ($10),y\n        lda ($10,x)\n        lda $1234,y')).toHaveLength(0);
    });

    it('reports an address too wide for the only form of its shape', () => {
        // `sty` has zeropage,x and no absolute,x, so the shape is right and the
        // width is not - verified: 64tass says "not a direct page address".
        const found = onCpu('        sty $c000,x');
        expect(found).toHaveLength(1);
        expect(found[0].message).toBe("not a direct page address '$c000'");
        expect(onCpu('        sty $10,x')).toHaveLength(0);
        expect(onCpu('        ldy $c000,x')).toHaveLength(0);
    });

    it('resolves the address before judging its width', () => {
        expect(onCpu('screen  = $c000\n        sty screen,x')).toHaveLength(1);
    });

    it('reads a parenthesised address as the assembler does', () => {
        // `sty ($100)/2,x` is $80, a direct page address, and assembles (verified).
        expect(onCpu('        sty ($100)/2,x')).toHaveLength(0);
    });

    it('says nothing about an address it cannot compute', () => {
        expect(onCpu('        sty elsewhere,x')).toHaveLength(0);
    });

    it('says nothing where the direct page can be moved', () => {
        // `.dpage $c000` makes `sty $c010,x` assemble on the 65816 (verified).
        expect(onCpu('        sty $c000,x', '65816')).toHaveLength(0);
    });

    it('reports a form another target has, judged against this one', () => {
        // `lda $10,s` is a 65816 mode and no 6502 one.
        expect(onCpu('        lda $10,s')).toHaveLength(1);
        expect(onCpu('        lda $10,s', '6502i')).toHaveLength(1);
        expect(onCpu('        lda $10,s', '65816')).toHaveLength(0);
    });
});

describe('immediates that do not fit', () => {
    function on(source: string, cpu?: string) {
        const doc = createDoc(source);
        const index = parseDocument(doc, cpu ? { cpu } : {});
        const documentIndex = new Map<string, DocumentIndex>([[doc.uri, index]]);
        return validateDocument(doc, documentIndex).filter(d => d.code === 'immediate-too-large');
    }

    // Every case checked against 64tass: #-1 assembles, #-129 does not.
    it('reports a value past the byte', () => {
        const found = on('        lda #$1234');
        expect(found).toHaveLength(1);
        expect(found[0].message).toBe('4660 does not fit in 8 bits');
    });

    it('accepts both readings of the byte', () => {
        expect(on('        lda #255')).toHaveLength(0);
        expect(on('        lda #-1')).toHaveLength(0);
        expect(on('        lda #256')).toHaveLength(1);
        expect(on('        lda #-129')).toHaveLength(1);
    });

    it('evaluates the expression rather than the literal', () => {
        expect(on('        lda #$ff+1')).toHaveLength(1);
        expect(on('LIMIT = $300\n        lda #LIMIT')).toHaveLength(1);
    });

    it('leaves the byte-extracting operators alone', () => {
        expect(on('        lda #<$1234')).toHaveLength(0);
        expect(on('        lda #>$1234')).toHaveLength(0);
    });

    it('says nothing about a value it cannot compute', () => {
        // A code label has no address here, so `#target` stays undecided.
        expect(on('target  nop\n        lda #target')).toHaveLength(0);
    });

    it('measures against the width the mnemonic actually has', () => {
        expect(on('        phw #$1234', '65ce02')).toHaveLength(0);
    });

    it('says nothing where the width is switchable', () => {
        // `.al` makes `lda #$1234` legal on the 65816, and this cannot see it.
        expect(on('        lda #$1234', '65816')).toHaveLength(0);
    });
});

describe('duplicates across an include', () => {
    // 64tass reports these at the later definition, with a note pointing back at
    // the include - verified, along with the fact that a different scope is fine.
    function withInclude(main: string, included: string) {
        const mainUri = 'file:///proj/main.asm';
        const incUri = 'file:///proj/sub.inc';
        const mainDoc = createDoc(main, mainUri);
        const incDoc = createDoc(included, incUri);
        const documentIndex = new Map<string, DocumentIndex>([
            [incUri, parseDocument(incDoc)],
            // The include list is wired by hand: parseDocument only records targets
            // it can resolve on disk, and these two files are not on it.
            [mainUri, { ...parseDocument(mainDoc), includes: [incUri] }],
        ]);
        const texts: Record<string, string> = { [mainUri]: main, [incUri]: included };
        return validateDocument(mainDoc, documentIndex, false, { getText: (uri: string) => texts[uri] ?? null })
            .filter(d => d.message.startsWith('Duplicate'));
    }

    it('reports a name defined in both files', () => {
        const found = withInclude('        .include "sub.inc"\ncounter = 1', 'counter = 2');
        expect(found).toHaveLength(1);
        expect(found[0].message).toBe("Duplicate label 'counter', also defined in sub.inc on line 1");
        expect(found[0].relatedInformation?.[0].location.uri).toBe('file:///proj/sub.inc');
    });

    it('points at the definition in the file being validated', () => {
        const found = withInclude('        .include "sub.inc"\ncounter = 1', 'counter = 2');
        expect(found[0].range.start.line).toBe(1);
    });

    it('leaves a weak definition on either side alone', () => {
        // The point of .weak is that the other file may override it (verified).
        expect(withInclude('        .include "sub.inc"\ncounter = 1',
            '        .weak\ncounter = 2\n        .endweak')).toHaveLength(0);
        expect(withInclude('        .include "sub.inc"\n        .weak\ncounter = 1\n        .endweak',
            'counter = 2')).toHaveLength(0);
    });

    it('leaves a same name in a different scope alone', () => {
        expect(withInclude(
            '        .include "sub.inc"\nouter   .block\ncounter = 1\n        .bend', 'counter = 2'))
            .toHaveLength(0);
    });

    it('leaves re-assignable variables alone', () => {
        expect(withInclude('        .include "sub.inc"\ncounter .var 1', 'counter .var 2')).toHaveLength(0);
    });

    it('ignores a definition the include never assembles', () => {
        expect(withInclude(
            '        .include "sub.inc"\ncounter = 1', '        .if 0\ncounter = 2\n        .endif'))
            .toHaveLength(0);
    });

    it('finds one two includes deep', () => {
        const mainUri = 'file:///proj/main.asm';
        const midUri = 'file:///proj/mid.inc';
        const leafUri = 'file:///proj/leaf.inc';
        const mainDoc = createDoc('        .include "mid.inc"\ncounter = 1', mainUri);
        const documentIndex = new Map<string, DocumentIndex>([
            [leafUri, parseDocument(createDoc('counter = 2', leafUri))],
            [midUri, { ...parseDocument(createDoc('        .include "leaf.inc"', midUri)), includes: [leafUri] }],
            [mainUri, { ...parseDocument(mainDoc), includes: [midUri] }],
        ]);
        expect(validateDocument(mainDoc, documentIndex).filter(d => d.message.startsWith('Duplicate')))
            .toHaveLength(1);
    });
});

describe('inactive code', () => {
    function inactive(source: string) {
        return getDiagnostics(source).filter(d => d.code === 'inactive-code');
    }

    it('covers the branch the condition rules out, as one region', () => {
        const found = inactive([
            'DEBUG   = 0',
            '        .if DEBUG',
            '        lda #1',
            '        sta $d020',
            '        .else',
            '        lda #2',
            '        .endif',
        ].join('\n'));
        expect(found).toHaveLength(1);
        expect(found[0].range.start.line).toBe(2);
        expect(found[0].range.end.line).toBe(3);
    });

    it('marks it as a hint the editor fades out', () => {
        const [first] = inactive('        .if 0\n        nop\n        .endif');
        expect(first.severity).toBe(DiagnosticSeverity.Hint);
        expect(first.tags).toEqual([DiagnosticTag.Unnecessary]);
    });

    it('leaves the directives themselves alone', () => {
        // The `.if` and `.endif` lines are assembled - only the branch is not.
        const [first] = inactive('        .if 0\n        nop\n        .endif');
        expect(first.range.start.line).toBe(1);
        expect(first.range.end.line).toBe(1);
    });

    it('says nothing about a branch that is taken', () => {
        expect(inactive('        .if 1\n        nop\n        .endif')).toEqual([]);
    });

    it('says nothing when the condition cannot be decided', () => {
        // The evaluator is conservative on purpose: it may never fade code that
        // might assemble.
        expect(inactive('        .if unknown_flag\n        nop\n        .endif')).toEqual([]);
        expect(inactive('        .if * > $1000\n        nop\n        .endif')).toEqual([]);
    });

    it('fades the dead half of a chain, not the live one', () => {
        const found = inactive([
            'MODE    = 2',
            '        .if MODE = 1',
            '        lda #1',
            '        .elsif MODE = 2',
            '        lda #2',
            '        .else',
            '        lda #3',
            '        .endif',
        ].join('\n'));
        expect(found.map(d => [d.range.start.line, d.range.end.line])).toEqual([[2, 2], [6, 6]]);
    });
});

describe('symbols from another program', () => {
    // Two files that are never assembled together: neither includes the other.
    const MINE = 'file:///proj/mine.asm';
    const OTHER = 'file:///elsewhere/other.asm';

    function setup(source: string) {
        const mineDoc = createDoc(source, MINE);
        const documentIndex = new Map<string, DocumentIndex>([
            [OTHER, parseDocument(createDoc('elsewhere = 1', OTHER))],
            [MINE, parseDocument(mineDoc)],
        ]);
        return { mineDoc, documentIndex };
    }

    it('reports a name that only exists in the other program', () => {
        const { mineDoc, documentIndex } = setup('        lda elsewhere');
        const found = validateDocument(mineDoc, documentIndex, false, { unit: new Set([MINE]) });
        expect(found.map(d => d.message)).toContain("Undefined symbol 'elsewhere'");
    });

    it('says nothing when no unit is given', () => {
        // Which is what the server does when the include graph might be incomplete.
        const { mineDoc, documentIndex } = setup('        lda elsewhere');
        expect(validateDocument(mineDoc, documentIndex, false)
            .filter(d => d.code === 'undefined-symbol')).toEqual([]);
    });

    it('accepts a name from a file in the same unit', () => {
        const { mineDoc, documentIndex } = setup('        lda elsewhere');
        expect(validateDocument(mineDoc, documentIndex, false, { unit: new Set([MINE, OTHER]) })
            .filter(d => d.code === 'undefined-symbol')).toEqual([]);
    });

    it('decides .if branches only on symbols the unit can see', () => {
        // `elsewhere` is 1 over there, but not here - so the condition is
        // undecidable and neither branch is faded.
        const { mineDoc, documentIndex } = setup('        .if elsewhere\n        nop\n        .endif');
        expect(validateDocument(mineDoc, documentIndex, false, { unit: new Set([MINE]) })
            .filter(d => d.code === 'inactive-code')).toEqual([]);
    });
});

describe('symbols passed to a macro or function', () => {
    // Every expectation checked against the assembler: `#SETPTR qwe,asd` reports
    // both names undefined, and an argument going to a parameter the body never
    // reads reports nothing at all - 64tass works an argument out only where it
    // is used.
    const DEFS = [
        '        *= $1000',
        'SETPTR  .function ptr, val',
        '        lda #<val',
        '        sta ptr',
        '.endf',
        'HALF    .macro kept, ignored',
        '        lda #kept',
        '        .endm',
        'known   = $10',
    ].join('\n');

    // Undefined symbols are warnings, so this looks at every diagnostic.
    const on = (call: string) => getDiagnostics(`${DEFS}\n${call}`)
        .filter(d => d.code === 'undefined-symbol')
        .map(d => d.message);

    it('reports an undefined argument', () => {
        expect(on('        #SETPTR qwe,asd')).toEqual([
            "Undefined symbol 'qwe'", "Undefined symbol 'asd'",
        ]);
    });

    it('points at the argument itself', () => {
        const [first] = getDiagnostics(`${DEFS}\n        #SETPTR qwe,asd`).filter(d => d.code === 'undefined-symbol');
        expect(first.range.start.character).toBe('        #SETPTR '.length);
    });

    it('covers every call form', () => {
        expect(on('        .SETPTR qwe, known')).toEqual(["Undefined symbol 'qwe'"]);
        expect(on('        SETPTR qwe, known')).toEqual(["Undefined symbol 'qwe'"]);
        expect(on('        lda #SETPTR(qwe, known)')).toEqual(["Undefined symbol 'qwe'"]);
    });

    it('accepts arguments that do resolve', () => {
        expect(on('        #SETPTR known, known')).toEqual([]);
    });

    it('says nothing about an argument the body never reads', () => {
        // `ignored` is declared and unused, so 64tass never evaluates it.
        expect(on('        #HALF qwe, asd')).toEqual(["Undefined symbol 'qwe'"]);
    });

    it('says nothing when the callee takes its arguments positionally', () => {
        // A macro with no declared parameters uses `\1`, which is text, not a value.
        const source = 'SETL    .macro\n\\1      = \\2\n        .endm\n        #SETL newthing, 5';
        expect(getDiagnostics(source).filter(d => d.code === 'undefined-symbol')).toEqual([]);
    });
});

describe('conditionals written in comment-block prose', () => {
    // A `.comment` block holds English, and English says things like "disabled
    // with .if 0". Read as a conditional it opened a chain that never closed, so
    // everything below was marked dead and every diagnostic suppressed - while
    // 64tass reports both errors here (verified).
    const SOURCE = [
        '        .comment',
        'disabled with .if 0',
        '        .endc',
        '*=$1000',
        '        sta undefined_here',
        'dup     = 1',
        'dup     = 2',
    ].join('\n');

    it('still reports what the assembler reports', () => {
        const found = getDiagnostics(SOURCE).map(d => d.message);
        expect(found).toContain("Undefined symbol 'undefined_here'");
        expect(found.some(m => m.startsWith("Duplicate label 'dup'"))).toBe(true);
    });

    it('greys nothing out', () => {
        expect(getDiagnostics(SOURCE).filter(d => d.code === 'inactive-code')).toEqual([]);
    });

    it('still decides a real conditional', () => {
        const real = '        .if 0\n        sta undefined_here\n        .endif';
        expect(getDiagnostics(real).filter(d => d.code === 'inactive-code')).toHaveLength(1);
    });
});

describe('symbols in a directive operand', () => {
    // Undefined-symbol checking used to cover opcodes and fifteen data
    // directives; every position below is one the assembler resolves and fails
    // on (each verified).
    const on = (line: string) => getDiagnostics(`        *= $1000\n${line}`)
        .filter(d => d.code === 'undefined-symbol').map(d => d.message);

    it.each([
        ['        .align undefined_sym'],
        ['        .if undefined_sym\n        .endif'],
        ['        .for i = 0, i < undefined_sym, i = i + 1\n        .next'],
        ['        .rept undefined_sym\n        .next'],
        ['        .cerror undefined_sym > 3, "x"'],
        ['        .check undefined_sym, 2'],
        ['        .logical undefined_sym\n        .here'],
        ['        *= undefined_sym'],
    ])('reports one in %j', (line) => {
        expect(on(line)).toEqual(["Undefined symbol 'undefined_sym'"]);
    });

    it('leaves the operands that name something else alone', () => {
        // `.section` names a section, `.macro` DECLARES parameters, and a
        // `.dstruct`s extra arguments are lazy - all verified silent.
        expect(on('        .section mysec')).toEqual([]);
        expect(on('shout   .macro a, b\n        .endm')).toEqual([]);
    });

    it('does not read a for-in loop\'s `in` as a symbol', () => {
        // `in` is an operator (`1 in [1,2]` assembles), though it is a legal name.
        expect(on('list    = [1, 2]\n        .for i in list\n        .next')).toEqual([]);
    });

    it('does not read a macro argument substitution as a symbol', () => {
        // `\name` substitutes the argument as text; the name is the parameter.
        expect(on('        .cerror 1 != 2, "x", (\\name), "y"')).toEqual([]);
    });

    it('checks the right-hand side of a dotted assignment', () => {
        expect(on('outer   .block\n        .bend\nouter.extra = undefined_sym'))
            .toEqual(["Undefined symbol 'undefined_sym'"]);
    });
});

describe('a .for loop variable written with :=', () => {
    it('is not reported undefined', () => {
        // The manual's current spelling; it assembles, and every use of `i` used
        // to be a warning, the three in the header included.
        expect(getDiagnostics('        *= $1000\n        .for i := 0, i < 3, i += 1\n        .byte i\n        .next'))
            .toEqual([]);
    });
});

describe('assignments written without spaces', () => {
    // All six assemble (verified). The name was captured as "everything before
    // the `=`", so the operator was swallowed and reported as an illegal
    // character in the symbol name - and every test for that check spaced its
    // operators, so none of these was ever seen.
    it.each(['v := 1', 'v+=1', 'v-=1', 'v*=2', 'v<<=1', 'v:=5', 'v..=[1]'])('accepts %j', (line) => {
        expect(getDiagnostics(line)).toEqual([]);
    });

    it('still catches a character that cannot be in a name', () => {
        expect(getDiagnostics('CODE_£ = $30').map(d => d.message))
            .toEqual(["'£' is not allowed in a symbol name"]);
    });

    it('still catches an assignment with no expression', () => {
        expect(getDiagnostics('CODE_= = $35').map(d => d.message)).toEqual(['An expression is expected']);
        expect(getDiagnostics('a == 1').map(d => d.message)).toEqual(['An expression is expected']);
    });
});

describe('references to a label on a bare call line', () => {
    it('resolve', () => {
        const source = 'mac     .macro\n        .byte 1\n        .endm\n'
            + '        *= $1000\nlbl     mac 5\n        jmp lbl';
        expect(getDiagnostics(source).filter(d => d.code === 'undefined-symbol')).toEqual([]);
    });
});

describe('labels across .switch branches', () => {
    // A .switch assembles at most one .case, so same-named labels in two of them
    // never coexist - all three verified against the assembler.
    const SWITCH = (body: string) => `        *= $1000\n        .switch 1\n${body}\n        .endswitch`;
    const duplicates = (source: string) =>
        getDiagnostics(source).filter(d => d.message.startsWith('Duplicate')).map(d => d.message);

    it('are not duplicates in different cases', () => {
        expect(duplicates(SWITCH('        .case 1\nlbl     .byte 1\n        .default\nlbl     .byte 2')))
            .toEqual([]);
    });

    it('are duplicates twice in one case', () => {
        expect(duplicates(SWITCH('        .case 1\nlbl     .byte 1\nlbl     .byte 3'))).toHaveLength(1);
    });

    it('are duplicates across the end of the switch', () => {
        expect(duplicates(`${SWITCH('        .case 1\nlbl     .byte 1')}\nlbl     .byte 2`)).toHaveLength(1);
    });
});

describe('labels inside a .bfor body', () => {
    // The body is a scope of its own, verified both ways: the same name outside
    // is not a duplicate, and a reference to the inner one from outside is
    // "not defined symbol" to the assembler.
    const LOOP = 'inner   .byte 0\n        .bfor i in 0, 1\ninner   .byte i\n        .next';

    it('are not duplicates of one outside it', () => {
        expect(getDiagnostics(`        *= $1000\n${LOOP}`).filter(d => d.message.startsWith('Duplicate'))).toEqual([]);
    });

    it('are still duplicates within the body', () => {
        const source = '        *= $1000\n        .bfor i in 0, 1\ninner   .byte i\ninner   .byte i\n        .next';
        expect(getDiagnostics(source).filter(d => d.message.startsWith('Duplicate'))).toHaveLength(1);
    });

    it('do not resolve from outside the loop', () => {
        const source = `        *= $1000\n        .bfor i in 0, 1\nhidden  .byte i\n        .next\n        lda hidden`;
        expect(getDiagnostics(source).filter(d => d.code === 'undefined-symbol')).toHaveLength(1);
    });
});

describe('a branch on a reassigned .var', () => {
    it('is not greyed out', () => {
        // The assembler assembles the .else here (v is 2 by then); marking it
        // dead from the first definition hid the branch that is actually built.
        const source = ['        *= $1000', 'v       .var 1', 'v       .var 2',
            '        .if v == 1', '        lda #1', '        .else', '        lda #2', '        .endif'].join('\n');
        expect(getDiagnostics(source).filter(d => d.message.includes('never taken'))).toEqual([]);
    });
});

describe('machine-code checks inside a dead branch', () => {
    // Nothing in a branch that cannot be taken is assembled, and the assembler
    // reports none of these there (verified with all three inside one `.if 0`).
    const inDeadBranch = (line: string) =>
        getDiagnostics(`        *= $1000\n        .if 0\n${line}\n        .endif`)
            .filter(d => d.severity === DiagnosticSeverity.Error);

    it('says nothing about another CPU\'s mnemonic', () => {
        expect(inDeadBranch('        bra $1000')).toEqual([]);
        expect(getDiagnostics('        *= $1000\n        bra $1000')
            .filter(d => d.code === 'unsupported-mnemonic')).toHaveLength(1);
    });

    it('says nothing about an oversized immediate', () => {
        expect(inDeadBranch('        lda #$1234')).toEqual([]);
        expect(getDiagnostics('        *= $1000\n        lda #$1234')
            .filter(d => d.code === 'immediate-too-large')).toHaveLength(1);
    });

    it('says nothing about a shape with no addressing mode', () => {
        expect(inDeadBranch('        ldx $10,x')).toEqual([]);
        expect(getDiagnostics('        *= $1000\n        ldx $10,x')
            .filter(d => d.code === 'no-addressing-mode')).toHaveLength(1);
    });
});

describe('a #name macro call', () => {
    // `#nosuch 1, 2` is "not defined symbol 'nosuch'" to the assembler, at the
    // name rather than the `#` (verified); `.nosuch` was reported already.
    const macros = (source: string) => getDiagnostics(source).filter(d => d.code === 'undefined-macro');

    it('is reported when nothing defines it', () => {
        const found = macros('        *= $1000\n        #nosuch 1, 2');
        expect(found).toHaveLength(1);
        expect(found[0].range.start.character).toBe(9);
    });

    it('is reported behind a label too', () => {
        expect(macros('        *= $1000\nlbl     #nosuch 1')).toHaveLength(1);
    });

    it('is silent when the macro exists', () => {
        expect(macros('mac     .macro\n        .byte 1\n        .endm\n        *= $1000\n        #mac')).toEqual([]);
    });

    it('does not read an immediate operand as one', () => {
        expect(macros('        *= $1000\nknown   = 1\n        lda #known')).toEqual([]);
    });
});

describe('a line with trailing whitespace', () => {
    // The opcode pattern allows a label in front of the mnemonic, and on
    // `jsr foo  ` that alternative matched - `foo` as the mnemonic, a space as
    // its operand - so nothing on the line was checked at all. Only an operand
    // of exactly three letters could do it, which is why it went unnoticed.
    it('still has its symbols checked', () => {
        expect(getDiagnostics('        *= $1000\n        jsr foo  ')
            .filter(d => d.code === 'undefined-symbol')).toHaveLength(1);
    });

    it('reports the symbol where it is written', () => {
        const [found] = getDiagnostics('        *= $1000\n        jsr foo   ')
            .filter(d => d.code === 'undefined-symbol');
        expect([found.range.start.character, found.range.end.character]).toEqual([12, 15]);
    });
});

describe('a document with CRLF line endings', () => {
    // Every line of such a file ended in `\r`, which is not the end of a line to a
    // pattern anchored with `$` - so `.fi\r` was no conditional at all, the chain
    // never closed, and one real project reported 28 diagnostics it should not
    // have: labels in the two halves of a chain as duplicates, and dead branches
    // checked as live code.
    const CHAIN = ['        *= $1000', '        .if 1', 'foo     nop', '        .else',
        'foo     lda #1', '        jmp nowhere', '        .fi'];

    it('does not read the two halves of a chain as duplicates', () => {
        expect(getDiagnostics(CHAIN.join('\r\n')).filter(d => d.message.startsWith('Duplicate'))).toEqual([]);
    });

    it('still skips the branch that cannot be taken', () => {
        const codes = getDiagnostics(CHAIN.join('\r\n')).map(d => d.code);
        expect(codes).not.toContain('undefined-symbol');
        expect(codes).toContain('inactive-code');
    });

    it('reports what it does find at the right line', () => {
        const [found] = getDiagnostics('        *= $1000\r\n        jmp nowhere\r\n')
            .filter(d => d.code === 'undefined-symbol');
        expect([found.range.start.line, found.range.start.character]).toEqual([1, 12]);
    });
});

describe('a built-in written with capitals while case sensitivity is on', () => {
    // `-C` makes 64tass match instruction and directive names exactly, and it has
    // no capitalised names at all: `LDA #1` is "wrong type", `JMP lbl` and
    // `start RTS` are "general syntax", `.BYTE` is "not defined symbol 'BYTE'".
    // A lone `RTS` is none of those - it defines a symbol called RTS and
    // assembles, as do `LDA = 5`, `LDA:` and `LDA .byte 1` (all verified).
    const miscased = (source: string) =>
        getDiagnostics(source, { caseSensitive: true }).filter(d => d.code === 'miscased-builtin');

    it('is reported in the instruction slot', () => {
        expect(miscased('        *= $1000\n        LDA #1')).toHaveLength(1);
        expect(miscased('        *= $1000\nlbl     nop\n        JMP lbl')).toHaveLength(1);
        expect(miscased('        *= $1000\nstart   RTS')).toHaveLength(1);
    });

    it('is reported for a directive, even alone', () => {
        expect(miscased('        *= $1000\n        .BYTE 1')).toHaveLength(1);
        expect(miscased('        *= $1000\n        .Byte')).toHaveLength(1);
    });

    it('points at the word, so the fix is to lowercase it', () => {
        const [found] = miscased('        *= $1000\n        LDA #1');
        expect([found.range.start.character, found.range.end.character]).toEqual([8, 11]);
        expect(found.message).toContain("'lda'");
    });

    it('is not reported where the name is a symbol after all', () => {
        expect(miscased('        *= $1000\n        RTS')).toEqual([]);
        expect(miscased('        *= $1000\nLDA     = 5\n        lda #LDA')).toEqual([]);
        expect(miscased('        *= $1000\nLDA:    nop')).toEqual([]);
        expect(miscased('        *= $1000\nLDA     .byte 1')).toEqual([]);
    });

    it('is not reported with case sensitivity off', () => {
        expect(getDiagnostics('        *= $1000\n        LDA #1').filter(d => d.code === 'miscased-builtin'))
            .toEqual([]);
    });

    it('leaves the rest of such a line alone', () => {
        // Reading LDA as the instruction made `.byte 1` its operand, reported as
        // two values in a row - on a line the assembler takes.
        expect(getDiagnostics('        *= $1000\nLDA     .byte 1', { caseSensitive: true })
            .filter(d => d.severity === DiagnosticSeverity.Error)).toEqual([]);
    });
});

describe('a bracket left open at the end of a line', () => {
    // 64tass continues a line in no way at all, a trailing backslash included: a
    // tuple split over two lines is "an expression is expected" and then "general
    // syntax", and `lda (1` is "')' expected" (all verified). The shape is a real
    // project's 36-entry tuple written across seven lines.
    const unclosed = (source: string) => getDiagnostics(source).filter(d => d.code === 'unclosed-bracket');

    it('is reported where it opened', () => {
        const [found] = unclosed('        *= $1000\nvals    = (aa,bb,\n        cc) - 1');
        expect(found.severity).toBe(DiagnosticSeverity.Error);
        expect(found.range.start).toEqual({ line: 1, character: 10 });
    });

    it('is reported in an operand too', () => {
        expect(unclosed('        *= $1000\n        lda (1')).toHaveLength(1);
        expect(unclosed('        *= $1000\nlist    = [1,')).toHaveLength(1);
        expect(unclosed('        *= $1000\nd       = {.k: 1,')).toHaveLength(1);
    });

    it('says nothing about a line whose brackets close', () => {
        expect(unclosed('        *= $1000\n        lda ($10),y\n        .byte <(start+1)\nstart   nop')).toEqual([]);
        expect(unclosed("        *= $1000\nd       = {.k: 1}\n        .text \"((\"\n        nop ; (")).toEqual([]);
    });

    it('says nothing inside a branch that is not assembled', () => {
        // Verified: the assembler does not parse such a branch at all.
        expect(unclosed('        *= $1000\n        .if 0\n        lda (1\n        .endif')).toEqual([]);
    });
});

describe('an .if on a .for loop variable', () => {
    // Verified from the bytes: `.for i = 0, i < 3, ...` around `.if i == 0` puts
    // $01 once and $02 twice in the output, so both branches are assembled and
    // neither may be greyed out or skipped.
    const LOOP = ['        *= $1000', '        .for i = 0, i < 3, i = i + 1', '        .if i == 0',
        '        .byte undefined_one', '        .else', '        .byte undefined_two',
        '        .endif', '        .next'].join('\n');

    it('greys out neither branch', () => {
        expect(getDiagnostics(LOOP).filter(d => d.code === 'inactive-code')).toEqual([]);
    });

    it('checks the symbols of both', () => {
        expect(getDiagnostics(LOOP).filter(d => d.code === 'undefined-symbol')).toHaveLength(2);
    });
});

describe('a label named after another target\'s mnemonic', () => {
    // Recognition uses the union of every CPU's mnemonics, since a flag this
    // extension cannot see may select any target - which is why `bra nowhere`
    // still has its operand checked. A directive after the word settles it the
    // other way: `map .fill 8` is a label and a fill on a 6502 (verified clean),
    // and reading MAP as the 45gs02 instruction made `.fill 8` its operand.
    const source = '        *= $1000\nmap     .fill 8\nneg     .byte 1\n        lda map\n        lda neg';

    it('is not read as an instruction when a directive follows', () => {
        expect(getDiagnostics(source)).toEqual([]);
    });

    it('resolves where it is used', () => {
        expect(getDiagnostics(source).filter(d => d.code === 'undefined-symbol')).toEqual([]);
    });

    it('still checks the operand where the word could be the instruction', () => {
        // Nothing settles `bra nowhere`: on a 65c02 it is a branch, on a 6502 a
        // label and a call, so the operand stays checked.
        expect(getDiagnostics('        *= $1000\n        bra nowhere')
            .some(d => d.code === 'undefined-symbol')).toBe(true);
    });
});

describe('definitions inside a .weak region', () => {
    // The manual calls a weak symbol one that "can be overridden by stronger
    // symbols in the same scope from outside" - 64tass's stand-in for .ifdef.
    // Verified: strong-then-weak and weak-then-strong both assemble, while two
    // weak definitions of one name are a duplicate like any other.
    const duplicates = (source: string) =>
        getDiagnostics(source).filter(d => d.message.startsWith('Duplicate'));

    it('do not collide with a stronger one before them', () => {
        expect(duplicates('        *= $1000\nsymbol  = 1\n        .weak\nsymbol  = 0\n        .endweak')).toEqual([]);
    });

    it('do not collide with a stronger one after them', () => {
        expect(duplicates('        *= $1000\n        .weak\nsymbol  = 0\n        .endweak\nsymbol  = 1')).toEqual([]);
    });

    it('still collide with each other', () => {
        expect(duplicates('        *= $1000\n        .weak\nsymbol  = 0\nsymbol  = 2\n        .endweak')).toHaveLength(1);
        expect(duplicates('        *= $1000\n        .weak\nsymbol  = 0\n        .endweak\n'
            + '        .weak\nsymbol  = 3\n        .endweak')).toHaveLength(1);
    });

    it('leave an ordinary duplicate alone', () => {
        expect(duplicates('        *= $1000\nlbl     nop\nlbl     nop')).toHaveLength(1);
    });
});

describe('a member reached through an index', () => {
    // The manual's `.brept` array idiom, verified clean: `sprites[2].x` indexes
    // the run and picks a field of that element. The dot after `]` was read as a
    // macro-call prefix, and the field as a symbol of its own.
    const ARRAY = ['        *= $1000', 'sprites .brept 4', 'x       .byte ?', 'color   .byte ?',
        '        .endrept'].join('\n');

    it('is neither a macro call nor a bare symbol', () => {
        expect(getDiagnostics(`${ARRAY}\n        lda sprites[2].x`)).toEqual([]);
        expect(getDiagnostics(`${ARRAY}\n        lda sprites[0].color,y`)).toEqual([]);
    });

    it('still reports a macro call that is one', () => {
        expect(getDiagnostics('        *= $1000\n        .nosuchmacro 1')
            .filter(d => d.code === 'undefined-macro')).toHaveLength(1);
    });

    it('still reports an undefined symbol beside one', () => {
        expect(getDiagnostics(`${ARRAY}\n        lda sprites[2].x + nowhere`)
            .filter(d => d.code === 'undefined-symbol').map(d => d.message))
            .toEqual(["Undefined symbol 'nowhere'"]);
    });
});

describe('a multi-symbol lookup', () => {
    // The manual: "More than one symbol may be looked up at the same time and the
    // result will be a list or tuple", written `colors.(red, green, blue)`. The
    // names belong to `colors`; they were looked for in the scope at the cursor.
    const SCOPE = ['colors  .namespace', 'red     = 2', 'green   = 3', '        .endnamespace',
        '        *= $1000'].join('\n');

    it('resolves the names against the scope in front of the dot', () => {
        expect(getDiagnostics(`${SCOPE}\n        .byte colors.(red, green)`)).toEqual([]);
    });

    it('still reports a name that scope does not have', () => {
        expect(getDiagnostics(`${SCOPE}\n        .byte colors.(red, nosuch)`)
            .filter(d => d.code === 'undefined-symbol').map(d => d.message))
            .toEqual(["Undefined symbol 'nosuch'"]);
    });

    it('leaves a keyed list alone, which names nothing', () => {
        // `dict(.(red, green), range(2))` builds keys, not references (verified).
        expect(getDiagnostics(`${SCOPE}\nd       = dict(.(red, green), range(2))`)).toEqual([]);
    });

    it('still resolves an ordinary dotted reference', () => {
        expect(getDiagnostics(`${SCOPE}\n        lda #colors.nosuch`)
            .filter(d => d.code === 'undefined-symbol')).toHaveLength(1);
    });
});

describe('numbers written with digit separators', () => {
    it('are values, not two things in a row', () => {
        expect(getDiagnostics('        *= $1000\n        .word 1_000\n        .word $ff_ff\n'
            + '        .byte %1010_1010\n        .byte 1_0.5')).toEqual([]);
    });
});

describe('a byte string', () => {
    it('is one value, prefix included', () => {
        expect(getDiagnostics('        *= $1000\nraw     = b"oeU"\n        .text s"p1"\n'
            + '        .text x"fce2"\n        .byte len(raw)')).toEqual([]);
    });

    it('still reports a letter that is not a prefix', () => {
        // `q"abc"` is "an operator is expected" to the assembler as well.
        expect(getDiagnostics('        *= $1000\n        .text q"abc"').length).toBeGreaterThan(0);
    });
});

describe('address length forcing', () => {
    // `@b`, `@w` and `@l` pin the addressing mode of the expression after them
    // (verified: all three assemble). The letter was read as a symbol.
    it('is not a symbol reference', () => {
        expect(getDiagnostics('        *= $1000\n        lda @w $0000\n        bne @b lbl\n'
            + '        lda @w #$00\nlbl     nop')).toEqual([])
        ;
    });

    it('still checks what follows it', () => {
        expect(getDiagnostics('        *= $1000\n        lda @w nowhere')
            .filter(d => d.code === 'undefined-symbol').map(d => d.message))
            .toEqual(["Undefined symbol 'nowhere'"]);
    });

    it('leaves a bare w or b alone as a symbol', () => {
        expect(getDiagnostics('        *= $1000\n        lda w')
            .filter(d => d.code === 'undefined-symbol')).toHaveLength(1);
    });
});
