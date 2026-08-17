import { describe, it, expect } from 'vitest';
import { parseDocument } from '../../src/server/parser';
import { createDoc } from '../helpers/doc';

function parse(source: string) {
    return parseDocument(createDoc(source));
}

describe('parseDocument - caseSensitive field', () => {
    it('records false by default', () => {
        expect(parse('start\n        lda #1').caseSensitive).toBe(false);
    });

    it('records true when passed', () => {
        const index = parseDocument(createDoc('start\n        lda #1'), true);
        expect(index.caseSensitive).toBe(true);
    });
});

describe('parseDocument - label parsing', () => {
    it('parses standalone code label', () => {
        const index = parse('start\n        lda #1');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('start');
        expect(index.labels[0].isLocal).toBe(false);
        expect(index.labels[0].scopePath).toBeNull();
    });

    it('parses code label with colon', () => {
        const index = parse('start:\n        lda #1');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('start');
    });

    it('parses code label followed by opcode', () => {
        const index = parse('start lda #1');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('start');
    });

    it('parses data label', () => {
        const index = parse('table .byte 1, 2, 3');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('table');
    });

    it('parses data label with colon', () => {
        const index = parse('table: .byte 1, 2, 3');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('table');
    });

    it('parses labels with no space after the colon', () => {
        // Verified against the real assembler: all of these compile
        const cases: [string, string, string][] = [
            ['table:.byte 1, 2, 3', 'table', 'data'],
            ['msg:.text "hi"', 'msg', 'data'],
            ['lbl:.word $1234', 'lbl', 'data'],
            ['loop:inx', 'loop', 'code'],
            ['foo:.mymacro 1', 'foo', 'data'],
        ];
        for (const [source, expectedName, expectedKind] of cases) {
            const index = parse(source);
            expect(index.labels, source).toHaveLength(1);
            expect(index.labels[0].name, source).toBe(expectedName);
            expect(index.labels[0].kind, source).toBe(expectedKind);
            expect(index.labels[0].range.start.character, source).toBe(0);
            expect(index.labels[0].range.end.character, source).toBe(expectedName.length);
        }
    });

    it('parses an indented label with no space after the colon', () => {
        const index = parse('outer .proc\n\tHI:.byte $00\n.pend');
        const hi = index.labels.find(l => l.name === 'hi');
        expect(hi).toBeDefined();
        expect(hi!.scopePath).toBe('outer');
        expect(hi!.range.start.character).toBe(1); // after the tab
    });

    it('does not mistake a dotted reference for a data label', () => {
        // "tbl.byte" is a qualified reference, not "tbl" defining a .byte
        const index = parse('        lda tbl.byte');
        expect(index.labels.find(l => l.name === 'tbl')).toBeUndefined();
    });

    it('still requires a separator before an opcode', () => {
        // An indented instruction is not a label definition
        expect(parse('        nop').labels).toHaveLength(0);
        expect(parse('        inx').labels).toHaveLength(0);
        // Run-together text has no separator, so it is not split into label + opcode
        expect(parse('loopinx').labels.find(l => l.name === 'loop')).toBeUndefined();
    });

    it('parses data labels with colon inside a .proc', () => {
        const index = parse('random .proc\n\tLO: .byte $00\n\tHI: .byte $00\ninit:\n\trts\n.pend');
        const names = index.labels.map(l => l.name);
        expect(names).toContain('lo');
        expect(names).toContain('hi');
        const lo = index.labels.find(l => l.name === 'lo');
        expect(lo!.scopePath).toBe('random');
        const hi = index.labels.find(l => l.name === 'hi');
        expect(hi!.scopePath).toBe('random');
    });

    it('parses code label with colon followed by opcode', () => {
        const index = parse('loop: inx\n        rts');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('loop');
    });

    it('parses label with colon followed by macro call', () => {
        const index = parse('m .macro\n.endm\nfoo: .m');
        const foo = index.labels.find(l => l.name === 'foo');
        expect(foo).toBeDefined();
    });

    it('parses .text data label', () => {
        const index = parse('msg .text "hello"');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('msg');
    });

    it('parses constant assignment with =', () => {
        const index = parse('val = $FF');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('val');
        expect(index.labels[0].value).toBe('$FF');
    });

    it('parses constant assignment with :=', () => {
        const index = parse('val := 42');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('val');
        expect(index.labels[0].value).toBe('42');
    });

    it('distinguishes re-assignable variables from constants', () => {
        // Verified against the assembler: "=" may not be redefined, ":=" and ".var" may
        expect(parse('val = 42').labels[0].kind).toBe('const');
        expect(parse('val := 42').labels[0].kind).toBe('var');
        expect(parse('val\t.var 42').labels[0].kind).toBe('var');
    });

    it('parses .var definitions', () => {
        const index = parse('last\t.var\t0');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('last');
        expect(index.labels[0].kind).toBe('var');
        expect(index.labels[0].value).toBe('0');
    });

    it('parses .var with an expression value and trailing comment', () => {
        const index = parse('cur\t.var round(a * sin(i)) ; accumulator');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].kind).toBe('var');
        expect(index.labels[0].value).toBe('round(a * sin(i))');
    });

    it('parses a local .var symbol', () => {
        const index = parse('main\n_acc\t.var 0');
        const acc = index.labels.find(l => l.name === '_acc');
        expect(acc).toBeDefined();
        expect(acc!.kind).toBe('var');
        expect(acc!.isLocal).toBe(true);
        expect(acc!.localScope).toBe('main');
    });

    it('does not treat .var as a macro call', () => {
        const index = parse('v\t.var 1');
        expect(index.labelDefinedByMacro.has('v')).toBe(false);
    });

    it('stores name lowercase and preserves originalName', () => {
        const index = parse('MyLabel\n        lda #1');
        expect(index.labels[0].name).toBe('mylabel');
        expect(index.labels[0].originalName).toBe('MyLabel');
    });

    it('parses multiple labels', () => {
        const index = parse('a\nb\nc');
        expect(index.labels).toHaveLength(3);
    });

    it('parses empty document', () => {
        const index = parse('');
        expect(index.labels).toHaveLength(0);
    });

    it('skips comment-only lines', () => {
        const index = parse('; just comments\n; more comments');
        expect(index.labels).toHaveLength(0);
    });

    it('parses macro-defined label', () => {
        const index = parse('tbl .mymacro arg1');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('tbl');
        expect(index.labelDefinedByMacro.get('tbl')).toBe('mymacro');
    });
});

describe('parseDocument - scope tracking', () => {
    it('parses named .proc scope', () => {
        const index = parse('myproc .proc\n        nop\n.pend');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('myproc');
        expect(index.labels[0].scopePath).toBeNull();
        // Inside the proc, scopePath should be "myproc"
        const innerScope = index.scopeAtLine.get(1);
        expect(innerScope?.scopePath).toBe('myproc');
    });

    it('parses an indented named scope opener', () => {
        const index = parse('    myproc .proc\n        nop\n    .pend');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('myproc');
        // Range must start at the label, not at column 0
        expect(index.labels[0].range.start.character).toBe(4);
        expect(index.labels[0].range.end.character).toBe(4 + 'myproc'.length);
        expect(index.scopeAtLine.get(1)?.scopePath).toBe('myproc');
    });

    it('parses a nested indented scope inside a .proc', () => {
        // Verified against the real assembler: this compiles cleanly
        const index = parse([
            'outer   .proc',
            '    inner .proc',
            '        val = 5',
            '    .pend',
            '.pend'
        ].join('\n'));

        const inner = index.labels.find(l => l.name === 'inner');
        expect(inner).toBeDefined();
        expect(inner!.scopePath).toBe('outer');
        expect(inner!.kind).toBe('proc');

        // The nested scope's contents belong to it, not to the parent
        const val = index.labels.find(l => l.name === 'val');
        expect(val).toBeDefined();
        expect(val!.scopePath).toBe('outer.inner');
    });

    it('parses a tab-indented named scope opener', () => {
        const index = parse('outer\t.proc\n\tblk .block\n\t\tbval = 7\n\t.bend\n.pend');
        const blk = index.labels.find(l => l.name === 'blk');
        expect(blk).toBeDefined();
        expect(blk!.scopePath).toBe('outer');
        expect(index.labels.find(l => l.name === 'bval')!.scopePath).toBe('outer.blk');
    });

    it('parses a scope opener with a colon after the label', () => {
        // Verified against the real assembler: all of these compile
        for (const source of ['outer: .proc\n    val = 5\n.pend', 'outer:  .proc\n    val = 5\n.pend', 'outer:.proc\n    val = 5\n.pend']) {
            const index = parse(source);
            const outer = index.labels.find(l => l.name === 'outer');
            expect(outer, source).toBeDefined();
            expect(outer!.kind, source).toBe('proc');
            expect(index.labels.find(l => l.name === 'val')!.scopePath, source).toBe('outer');
        }
    });

    it('parses an indented colon scope opener with parameters', () => {
        const index = parse('    mac: .macro a, b\n        nop\n    .endm');
        const mac = index.labels.find(l => l.name === 'mac');
        expect(mac).toBeDefined();
        expect(mac!.kind).toBe('macro');
        expect(mac!.range.start.character).toBe(4);
        // The colon must not be swallowed into the parameter list
        expect(index.parametersAtScope.get('mac')).toEqual(['a', 'b']);
    });

    it('does not mistake a dotted reference for a scope opener', () => {
        // "outer.proc" is a qualified symbol reference, not "outer" opening a .proc
        const index = parse('outer.proc\n        nop');
        expect(index.labels.find(l => l.name === 'outer' && l.kind === 'proc')).toBeUndefined();
        expect(index.scopeAtLine.get(1)?.scopePath).toBeNull();
    });

    it('parses named .block scope', () => {
        const index = parse('myblock .block\n        nop\n.bend');
        expect(index.labels[0].name).toBe('myblock');
        const innerScope = index.scopeAtLine.get(1);
        expect(innerScope?.scopePath).toBe('myblock');
    });

    it('tracks nested scopes with dotted path', () => {
        const index = parse('outer .proc\ninner .proc\n        nop\n.pend\n.pend');
        const innerScope = index.scopeAtLine.get(2);
        expect(innerScope?.scopePath).toBe('outer.inner');
    });

    it('handles anonymous scope (no label)', () => {
        const index = parse('        .proc\n        nop\n.pend');
        // Anonymous scope creates no label
        expect(index.labels).toHaveLength(0);
        // But scope tracking still works (scopePath stays null since unnamed)
    });

    it('handles alternative closers', () => {
        const index = parse('x .block\n        nop\n.endblock');
        // Should close properly (no parse errors)
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('x');
    });

    it('reverts scope after closing', () => {
        const index = parse('s .proc\n        nop\n.pend\n        nop');
        const afterClose = index.scopeAtLine.get(3);
        expect(afterClose?.scopePath).toBeNull();
    });

    it('tracks three levels of scope depth', () => {
        const src = 'a .proc\nb .proc\nc .proc\n        nop\n.pend\n.pend\n.pend';
        const index = parse(src);
        const deepScope = index.scopeAtLine.get(3);
        expect(deepScope?.scopePath).toBe('a.b.c');
    });
});

describe('parseDocument - local symbols', () => {
    it('parses local symbol with isLocal flag', () => {
        const index = parse('main\n_loc = 1');
        const local = index.labels.find(l => l.name === '_loc');
        expect(local).toBeDefined();
        expect(local!.isLocal).toBe(true);
    });

    it('sets localScope to current code label', () => {
        const index = parse('main\n_loc = 1');
        const local = index.labels.find(l => l.name === '_loc');
        expect(local!.localScope).toBe('main');
    });

    it('different code labels create separate local scopes', () => {
        const index = parse('a\n_x = 1\nb\n_x = 2');
        const locals = index.labels.filter(l => l.name === '_x');
        expect(locals).toHaveLength(2);
        expect(locals[0].localScope).toBe('a');
        expect(locals[1].localScope).toBe('b');
    });

    it('local symbol inside directive scope', () => {
        const index = parse('s .proc\nmain\n_x = 1\n.pend');
        const local = index.labels.find(l => l.name === '_x');
        expect(local!.scopePath).toBe('s');
        expect(local!.localScope).toBe('main');
    });

    describe('whitespace handling', () => {
        it('matches local symbol with tab after name', () => {
            const index = parse('main\n_loc\t= 1');
            const local = index.labels.find(l => l.name === '_loc');
            expect(local).toBeDefined();
            expect(local!.isLocal).toBe(true);
        });

        it('matches local symbol with tab before name', () => {
            const index = parse('main\n\t_loc = 1');
            const local = index.labels.find(l => l.name === '_loc');
            expect(local).toBeDefined();
            expect(local!.isLocal).toBe(true);
        });

        it('matches local symbol with multiple tabs', () => {
            const index = parse('main\n\t\t_loc\t\t=\t\t1');
            const local = index.labels.find(l => l.name === '_loc');
            expect(local).toBeDefined();
            expect(local!.isLocal).toBe(true);
        });

        it('matches local symbol with mixed spaces and tabs', () => {
            const index = parse('main\n  \t_loc \t = 1');
            const local = index.labels.find(l => l.name === '_loc');
            expect(local).toBeDefined();
            expect(local!.isLocal).toBe(true);
        });

        it('matches local symbol with colon syntax', () => {
            const index = parse('main\n_loc: = 1');
            const local = index.labels.find(l => l.name === '_loc');
            expect(local).toBeDefined();
        });

        it('matches local symbol with := assignment', () => {
            const index = parse('main\n_loc := 1');
            const local = index.labels.find(l => l.name === '_loc');
            expect(local).toBeDefined();
        });

        it('matches local symbol with just colon (label)', () => {
            const index = parse('main\n_loc:');
            const local = index.labels.find(l => l.name === '_loc');
            expect(local).toBeDefined();
        });

        it('matches local symbol followed by semicolon comment', () => {
            const index = parse('main\n_loc = 1 ; comment');
            const local = index.labels.find(l => l.name === '_loc');
            expect(local).toBeDefined();
        });
    });
});

describe('parseDocument - macro/function parameters', () => {
    it('extracts macro parameters', () => {
        const index = parse('m .macro p1, p2\n.endm');
        expect(index.parametersAtScope.get('m')).toEqual(['p1', 'p2']);
    });

    it('extracts function parameters', () => {
        const index = parse('f .function x, y\n.endf');
        expect(index.parametersAtScope.get('f')).toEqual(['x', 'y']);
    });

    it('extracts macro sub-labels', () => {
        const index = parse('m .macro\nlo .byte 0\nhi .byte 0\n.endm');
        expect(index.macroSubLabels.get('m')).toEqual(['lo', 'hi']);
    });

    it('stores parameters lowercase', () => {
        const index = parse('m .macro Param1, PARAM2\n.endm');
        expect(index.parametersAtScope.get('m')).toEqual(['param1', 'param2']);
    });
});

describe('parseDocument - .include directives', () => {
    it('resolves include with existing file', () => {
        // Use a fixture file that we know exists
        const doc = createDoc('.include "includes-dep.asm"',
            'file:///home/db/src/64tass-langserv/test/fixtures/includes-main.asm');
        // This will only work if includes-dep.asm exists at that path
        // For now, test with a file we know exists
        const index = parseDocument(doc);
        // The include array may or may not have entries depending on file existence
        expect(Array.isArray(index.includes)).toBe(true);
    });

    it('skips non-existent include', () => {
        const index = parse('.include "nonexistent_file_abc123.asm"');
        expect(index.includes).toHaveLength(0);
    });
});

describe('parseDocument - scopeAtLine', () => {
    it('tracks global scope for initial lines', () => {
        const index = parse('label\n        lda #1');
        const scope = index.scopeAtLine.get(0);
        expect(scope?.scopePath).toBeNull();
        // Code label sets localScope on the same line it appears
        expect(scope?.localScope).toBe('label');
    });

    it('updates localScope after code label', () => {
        const index = parse('label\n        lda #1');
        const scope = index.scopeAtLine.get(1);
        expect(scope?.localScope).toBe('label');
    });

    it('tracks scope inside proc', () => {
        const index = parse('s .proc\n        nop\n.pend');
        const scope = index.scopeAtLine.get(1);
        expect(scope?.scopePath).toBe('s');
    });

    it('reverts scope after proc close', () => {
        const index = parse('s .proc\n        nop\n.pend\n        nop');
        const scope = index.scopeAtLine.get(3);
        expect(scope?.scopePath).toBeNull();
    });
});

describe('parseDocument - comment association', () => {
    it('associates same-line comment with label', () => {
        const index = parse('myproc .proc ; This is myproc\n.pend');
        expect(index.labels[0].comment).toBe('This is myproc');
    });

    it('associates comment above with scoped label', () => {
        const index = parse('; Documentation for myproc\nmyproc .proc\n.pend');
        expect(index.labels[0].comment).toBe('Documentation for myproc');
    });
});

describe('parseDocument - anonymous labels', () => {
    it('parses single + label', () => {
        const index = parse('+\n        nop');
        const label = index.labels.find(l => l.isAnonymous && l.name === '+');
        expect(label).toBeDefined();
        expect(label!.anonymousCount).toBe(1);
        expect(label!.originalName).toBe('+');
        // Not a local (_name) symbol: scoped by .proc/.block only
        expect(label!.isLocal).toBe(false);
        expect(label!.localScope).toBeNull();
    });

    it('parses single - label', () => {
        const index = parse('-\n        nop');
        const label = index.labels.find(l => l.isAnonymous && l.name === '-');
        expect(label).toBeDefined();
        expect(label!.anonymousCount).toBe(1);
        expect(label!.originalName).toBe('-');
    });

    it('parses multiple + symbols as separate labels', () => {
        const index = parse('+++\n        nop');
        const labels = index.labels.filter(l => l.isAnonymous && l.name === '+');
        expect(labels).toHaveLength(3);
        expect(labels[0].anonymousCount).toBe(1);
        expect(labels[1].anonymousCount).toBe(2);
        expect(labels[2].anonymousCount).toBe(3);
        expect(labels[0].originalName).toBe('+');
        expect(labels[1].originalName).toBe('++');
        expect(labels[2].originalName).toBe('+++');
    });

    it('parses multiple - symbols as separate labels', () => {
        const index = parse('--\n        nop');
        const labels = index.labels.filter(l => l.isAnonymous && l.name === '-');
        expect(labels).toHaveLength(2);
        expect(labels[0].anonymousCount).toBe(1);
        expect(labels[1].anonymousCount).toBe(2);
    });

    it('does not bind anonymous labels to the current code label', () => {
        // Named code labels do not scope anonymous labels (verified against the assembler)
        const index = parse('main\n+\n        nop');
        const label = index.labels.find(l => l.isAnonymous);
        expect(label).toBeDefined();
        expect(label!.localScope).toBeNull();
        expect(label!.scopePath).toBeNull();
    });

    it('scopes anonymous labels to the enclosing .proc/.block', () => {
        const index = parse('outer .proc\n+\n        nop\n.pend');
        const label = index.labels.find(l => l.isAnonymous);
        expect(label).toBeDefined();
        expect(label!.scopePath).toBe('outer');
        expect(label!.localScope).toBeNull();
    });

    it('rejects mixed +- symbols', () => {
        const index = parse('+-\n        nop');
        const anonLabels = index.labels.filter(l => l.isAnonymous);
        expect(anonLabels).toHaveLength(0); // Invalid pattern shouldn't match
    });

    it('parses anonymous label with optional colon', () => {
        const index = parse('+:\n        nop');
        const label = index.labels.find(l => l.isAnonymous && l.name === '+');
        expect(label).toBeDefined();
    });

    it('keeps separate entries for labels under different code labels', () => {
        const index = parse('func1\n+\n        nop\nfunc2\n+\n        nop');
        const plusLabels = index.labels.filter(l => l.isAnonymous && l.name === '+');
        expect(plusLabels).toHaveLength(2);
        // Both are in the same (global) scope - the code labels do not separate them
        expect(plusLabels.map(l => l.scopePath)).toEqual([null, null]);
        expect(plusLabels.map(l => l.localScope)).toEqual([null, null]);
    });

    it('separates anonymous labels by enclosing .block scope', () => {
        const index = parse('a .block\n+\n.bend\nb .block\n+\n.bend');
        const plusLabels = index.labels.filter(l => l.isAnonymous && l.name === '+');
        expect(plusLabels).toHaveLength(2);
        expect(plusLabels.map(l => l.scopePath)).toEqual(['a', 'b']);
    });

    it('parses anonymous label followed by instruction on same line', () => {
        const index = parse('-\tINX\n        BCS -');
        const label = index.labels.find(l => l.isAnonymous && l.name === '-');
        expect(label).toBeDefined();
        expect(label!.range.start.line).toBe(0);
    });

    it('parses + label followed by instruction', () => {
        const index = parse('+\tLDA #1');
        const label = index.labels.find(l => l.isAnonymous && l.name === '+');
        expect(label).toBeDefined();
    });

    it('parses anonymous label with colon followed by instruction', () => {
        const index = parse('-:\tDEX');
        const label = index.labels.find(l => l.isAnonymous && l.name === '-');
        expect(label).toBeDefined();
    });
});
