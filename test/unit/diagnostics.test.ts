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
