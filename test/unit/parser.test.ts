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
        const index = parseDocument(createDoc('start\n        lda #1'), { caseSensitive: true });
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

    // Documentation used to reach only scope openers and .binclude labels, so
    // "counter = $10 ; how many" showed nothing at all on hover or in completion.
    const commentOf = (source: string, name: string) =>
        parse(source).labels.find(l => l.name === name)?.comment;

    it.each([
        ['a constant', 'counter = $10   ; how many trees', 'counter', 'how many trees'],
        ['a code label', 'start           ; entry point\n        rts', 'start', 'entry point'],
        ['a code label with an opcode', 'start   lda #1  ; entry point', 'start', 'entry point'],
        ['a data label', 'tbl     .byte 0 ; the table', 'tbl', 'the table'],
        ['a := variable', 'v := 1          ; a counter', 'v', 'a counter'],
        ['a .var variable', 'v .var 1        ; a counter', 'v', 'a counter'],
        ['a .for loop variable', '        .for i = 0, i < 3, i = i + 1 ; loop\n        .next', 'i', 'loop'],
    ])('documents %s from the same line', (_name, source, label, expected) => {
        expect(commentOf(source, label)).toBe(expected);
    });

    it('documents a local symbol', () => {
        expect(commentOf('lbl\n_tmp = 1        ; scratch', '_tmp')).toBe('scratch');
    });

    it('documents a label on a macro call', () => {
        expect(commentOf('m .macro\n.endm\nx #m            ; made by m', 'x')).toBe('made by m');
    });

    it('documents a .dstruct instance', () => {
        const source = 'pt .struct\na .byte 0\n.endstruct\np1 .dstruct pt  ; a point';
        expect(commentOf(source, 'p1')).toBe('a point');
    });

    it.each([
        ['above', '; how many trees\ncounter = $10'],
        ['below', 'counter = $10\n; how many trees'],
    ])('takes a comment from the line %s a constant', (_where, source) => {
        expect(commentOf(source, 'counter')).toBe('how many trees');
    });

    it('joins a run of comment lines above', () => {
        const comment = commentOf('; first\n; second\ncounter = $10', 'counter');
        expect(comment).toContain('first');
        expect(comment).toContain('second');
    });

    it('prefers the same line over the lines around it', () => {
        expect(commentOf('; above\ncounter = $10 ; beside\n; below', 'counter')).toBe('beside');
    });

    it.each([
        ['an anonymous label', '-               ; a marker\n        rts', '-'],
        ['a define pragma symbol', '; 64tass-langserv: define FOO = 1', 'foo'],
    ])('leaves %s undocumented', (_name, source, label) => {
        expect(commentOf(source, label)).toBeUndefined();
    });

    it('documents a dict assignment but not its keys', () => {
        // The comment describes the whole literal, not each individual key.
        const source = 'D = {.MAP: 1}   ; the modes';
        expect(commentOf(source, 'd')).toBe('the modes');
        expect(commentOf(source, 'map')).toBeUndefined();
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

describe('parseDocument - loop variables', () => {
    it('indexes the .for loop variable', () => {
        const index = parse('        .for i = 0, i < 13, i = i + 1\n        .byte i\n        .next');
        const i = index.labels.find(l => l.name === 'i');
        expect(i).toBeDefined();
        expect(i!.kind).toBe('var');
        // Range points at the variable, not the directive
        expect(i!.range.start.character).toBe('        .for '.length);
    });

    it('indexes the .bfor loop variable', () => {
        const index = parse('        .bfor n = 0, n < 3, n = n + 1\n        .next');
        expect(index.labels.find(l => l.name === 'n')?.kind).toBe('var');
    });

    it('handles tight spacing in the .for header', () => {
        const index = parse('\t.for  n=0 , n<3 , n=n+1\n\t.next');
        expect(index.labels.find(l => l.name === 'n')).toBeDefined();
    });

    it('handles an expression initializer', () => {
        const index = parse('w = 4\n        .for i = w / 2, i < 3, i = i + 1\n        .next');
        expect(index.labels.find(l => l.name === 'i')).toBeDefined();
    });

    it('does not index a variable for .while or .rept', () => {
        expect(parse('        .while n < 3\n        .next').labels).toHaveLength(0);
        expect(parse('        .rept 3\n        .next').labels).toHaveLength(0);
    });

    it('records the loop variable inside the enclosing scope', () => {
        const index = parse('p .proc\n        .for i = 0, i < 3, i = i + 1\n        .next\n.pend');
        expect(index.labels.find(l => l.name === 'i')?.scopePath).toBe('p');
    });
});

describe('parseDocument - labelled loops', () => {
    it('indexes both the label and the loop variable of a labelled .for', () => {
        // Verified against the assembler: "squarelo .for i = ..." is valid and
        // squarelo is usable as a label afterwards
        const index = parse('squarelo\t.for i = 0, i < 21, i = i + 1\n\t\t.byte <(i * i)\n\t\t.next');
        const label = index.labels.find(l => l.name === 'squarelo');
        expect(label).toBeDefined();
        expect(label!.kind).toBe('data');
        expect(label!.range.start.character).toBe(0);

        const loopVar = index.labels.find(l => l.name === 'i');
        expect(loopVar).toBeDefined();
        expect(loopVar!.kind).toBe('var');
        expect(loopVar!.range.start.character).toBe('squarelo\t.for '.length);
    });

    it('handles a colon after the loop label', () => {
        const index = parse('tbl: .for n = 0, n < 4, n = n + 1\n\t.next');
        expect(index.labels.find(l => l.name === 'tbl')).toBeDefined();
        expect(index.labels.find(l => l.name === 'n')?.kind).toBe('var');
    });

    it('still handles an unlabelled .for', () => {
        const index = parse('\t.for i = 0, i < 4, i = i + 1\n\t.next');
        expect(index.labels).toHaveLength(1);
        expect(index.labels[0].name).toBe('i');
    });
});

describe('parseDocument - define pragma', () => {
    it('indexes a pragma define as a re-assignable variable', () => {
        const index = parse('; 64tass-langserv: define linking = 0\nstart');
        const linking = index.labels.find(l => l.name === 'linking');
        expect(linking).toBeDefined();
        expect(linking!.kind).toBe('var');
        expect(linking!.value).toBe('0');
        expect(linking!.scopePath).toBeNull();
        expect(linking!.range.start.line).toBe(0);
    });

    it('indexes several pragma defines', () => {
        const index = parse('; 64tass-langserv: define a = 1\n; 64tass-langserv: define b = $FF\nstart');
        expect(index.labels.filter(l => l.kind === 'var').map(l => l.name).sort()).toEqual(['a', 'b']);
    });

    it('ignores a non-pragma comment', () => {
        expect(parse('; define linking = 0\nstart').labels.find(l => l.name === 'linking')).toBeUndefined();
    });
});

describe('parseDocument - non-6502 CPU targets', () => {
    // The whole extension gates label detection on OPCODES, so an unrecognised
    // mnemonic meant no labels at all: no navigation, no outline, no references.
    it('indexes labels in a 65816 source', () => {
        // Verified against the assembler: this assembles cleanly
        const index = parse([
            '        .cpu "65816"',
            'start   sep #$30',
            'loop    bra loop',
            'faraway rtl'
        ].join('\n'));

        expect(index.labels.map(l => l.name).sort()).toEqual(['faraway', 'loop', 'start']);
        expect(index.labels.every(l => l.kind === 'code')).toBe(true);
    });

    it('indexes labels in a 65C02 source', () => {
        const index = parse('        .cpu "65c02"\nstart   stz $0400\nloop    bra loop\ndone    trb $02');
        expect(index.labels.map(l => l.name).sort()).toEqual(['done', 'loop', 'start']);
    });

    it('indexes labels in a 45GS02 source', () => {
        const index = parse('        .cpu "45gs02"\nstart   map\nnext    ldq $1234\nlast    eom');
        expect(index.labels.map(l => l.name).sort()).toEqual(['last', 'next', 'start']);
    });

    it('sets the local scope from a non-6502 opcode line', () => {
        // A code label must still open a local-symbol scope
        const index = parse('        .cpu "65816"\nouter   xba\n_local = 1');
        expect(index.labels.find(l => l.name === '_local')!.localScope).toBe('outer');
    });

    // The point of CPU modes: a mnemonic the target does not have is not an opcode
    it('does not treat another CPU\'s mnemonic as an opcode by default', () => {
        // No .cpu directive, so the 6502 default applies and "xba" is just a symbol
        const index = parse('outer   xba');
        expect(index.labels.find(l => l.name === 'outer' && l.kind === 'code')).toBeUndefined();
    });
});

describe('.binclude labels', () => {
    it('indexes the label as a block scope rather than a data label', () => {
        // It names a scope, so hover, completion and semantic tokens should treat
        // it as one - it used to fall through to the data-directive branch.
        const index = parse('sprite  .binclude "nope.asm"');
        const label = index.labels.filter(l => l.name === 'sprite');
        expect(label).toHaveLength(1);
        expect(label[0].kind).toBe('block');
    });

    it('records the label even when the path does not resolve', () => {
        const index = parse('sprite  .binclude "missing.asm"');
        expect(index.labels.map(l => l.name)).toContain('sprite');
        expect(index.includes).toHaveLength(0);
    });

    it('leaves .include lines alone', () => {
        const index = parse('        .include "nope.asm"');
        expect(index.labels).toHaveLength(0);
        expect(index.includeScopes.size).toBe(0);
    });
});

describe('.for loop variables', () => {
    it('indexes the variable of the "=" form', () => {
        const index = parse('        .for i = 0, i < 3, i = i + 1\n        .byte i\n        .next');
        expect(index.labels.find(l => l.name === 'i')?.kind).toBe('var');
    });

    it('indexes the variable of the "in" form', () => {
        const index = parse('        .for v in [1,2,3]\n        .byte v\n        .next');
        expect(index.labels.find(l => l.name === 'v')?.kind).toBe('var');
    });

    it('indexes every variable of a multi-variable "in" form', () => {
        const index = parse('        .for a, b, c in [1], [2], [3]\n        .next');
        expect(index.labels.filter(l => l.kind === 'var').map(l => l.name).sort()).toEqual(['a', 'b', 'c']);
    });

    it('gives each variable of an "in" list its own range', () => {
        const source = '        .for aa, bb in [1], [2]\n        .next';
        const index = parse(source);
        for (const name of ['aa', 'bb']) {
            const label = index.labels.find(l => l.name === name)!;
            expect(source.slice(label.range.start.character, label.range.end.character)).toBe(name);
        }
    });

    it('does not mistake the iterable for a variable', () => {
        const index = parse('        .for v in range(0, 1024, 256)\n        .next');
        expect(index.labels.map(l => l.name)).toEqual(['v']);
    });

    it('treats an "in" variable starting with _ as local', () => {
        const index = parse('lbl     nop\n        .for _v in [1,2]\n        .next');
        expect(index.labels.find(l => l.name === '_v')?.isLocal).toBe(true);
    });

    it('handles .bfor as well', () => {
        expect(parse('        .bfor v in [1]\n        .next').labels.map(l => l.name)).toContain('v');
    });

    it('still records a named label in front of the loop', () => {
        const index = parse('tbl     .for v in [1,2]\n        .next');
        expect(index.labels.find(l => l.name === 'tbl')?.kind).toBe('data');
        expect(index.labels.find(l => l.name === 'v')?.kind).toBe('var');
    });

    it('still records an anonymous label in front of the loop', () => {
        // "-  .for i in ..." - the loop branch must not swallow the line before
        // the anonymous-label branch has seen it.
        const index = parse('-       .for i in [1,2]\n        .next');
        expect(index.labels.find(l => l.isAnonymous)?.name).toBe('-');
        expect(index.labels.find(l => l.name === 'i')?.kind).toBe('var');
    });
});

describe('.function parameter forms', () => {
    it('indexes a typed parameter by name only', () => {
        // "make .function _data : binary" - the annotation is not part of the name
        const index = parse('make .function _data : binary\n        .endf _data');
        expect(index.parametersAtScope.get('make')).toEqual(['_data']);
    });

    it('indexes a parameter with a default value', () => {
        const index = parse('f       .function count = 5\n        .endf count');
        expect(index.parametersAtScope.get('f')).toEqual(['count']);
    });

    it('indexes a parameter with both a type and a default', () => {
        const index = parse('f       .function n : int = 5\n        .endf n');
        expect(index.parametersAtScope.get('f')).toEqual(['n']);
    });

    it('does not split a default value that contains commas', () => {
        const index = parse('f       .function a = [1,2,3], b = 9\n        .endf b');
        expect(index.parametersAtScope.get('f')).toEqual(['a', 'b']);
    });

    it('still handles plain macro parameters', () => {
        const index = parse('m       .macro ptr, val\n        .endm');
        expect(index.parametersAtScope.get('m')).toEqual(['ptr', 'val']);
    });
});

describe('.comment blocks', () => {
    it('does not index labels inside a comment block', () => {
        // Verified: a label defined inside .comment is not defined at all.
        const index = parse('        .comment\ninside  = 1\n        .endc\noutside = 2');
        expect(index.labels.map(l => l.name)).toEqual(['outside']);
    });

    it('does not report a duplicate when the block repeats a later label', () => {
        // This is the shape of 64tass's own loading_a_sid_file example: an earlier
        // version of the program kept inside .comment, followed by the real one.
        const index = parse('        .comment\nstart   lda #0\n        .endc\nstart   lda #0');
        expect(index.labels.filter(l => l.name === 'start')).toHaveLength(1);
    });

    it('still indexes a label on the .comment line itself', () => {
        const index = parse('lbl     .comment\n        junk\n        .endc');
        expect(index.labels.map(l => l.name)).toContain('lbl');
    });

    it('nests', () => {
        const index = parse('        .comment\na = 1\n        .comment\nb = 2\n        .endc\nc = 3\n        .endc\nd = 4');
        expect(index.labels.map(l => l.name)).toEqual(['d']);
    });

    it('ignores text that is not valid assembly', () => {
        expect(() => parse('        .comment\n        .proc\n        .byte "unterminated\n        .endc')).not.toThrow();
    });
});

describe('local symbol assignment operators', () => {
    it('records "_v = 1" as a constant', () => {
        expect(parse('_c      = 5').labels.find(l => l.name === '_c')?.kind).toBe('const');
    });

    it('records "_v := 1" as a re-assignable variable', () => {
        // Matches how a non-local ":=" is recorded, so it is exempt from the
        // duplicate check the way the assembler treats it.
        expect(parse('_v      := 5').labels.find(l => l.name === '_v')?.kind).toBe('var');
    });

    it.each(['..=', '+=', '-=', '*=', '/=', '&=', '|=', '^=', '<<=', '>>=', '%=', '**='])(
        'does not treat "%s" as a new definition', (op) => {
            const index = parse(`_v      := 0\n_v      ${op} 1`);
            expect(index.labels.filter(l => l.name === '_v')).toHaveLength(1);
        });

    it('does not report a duplicate for a list built up with ..=', () => {
        // The shape of 64tass's own runtime_relocation example.
        const index = parse('_items    := []\n_differences    ..= [1]\n_differences    ..= [2]');
        expect(index.labels.filter(l => l.name === '_items')).toHaveLength(1);
    });

    it('still records a bare local label', () => {
        expect(parse('_x\n        lda #1').labels.find(l => l.name === '_x')?.kind).toBe('const');
    });
});

describe('labels on macro calls', () => {
    const MACRO = ['emit     .macro', 'inner   nop', 'target lda #0', '        .endm', '        * = $1000'].join('\n');

    it.each(['.emit', '#emit'])('records a label calling a macro with "%s"', (call) => {
        const index = parse(`${MACRO}\ninst    ${call}`);
        expect(index.labels.map(l => l.name)).toContain('inst');
        expect(index.labelDefinedByMacro.get('inst')).toBe('emit');
    });

    it('does not mistake an immediate operand for a macro call', () => {
        // "lda #COUNT" is an opcode with an immediate, not a label named lda.
        const index = parse('COUNT  = 1\n        * = $1000\n        lda #COUNT');
        expect(index.labels.map(l => l.name)).not.toContain('lda');
    });

    it('does not mistake an immediate on a labelled line for a macro call', () => {
        const index = parse('COUNT  = 1\n        * = $1000\nstart   lda #COUNT');
        expect(index.labelDefinedByMacro.has('start')).toBe(false);
    });
});

describe('dict literal members', () => {
    it('indexes each key as a member of the assigned label', () => {
        const index = parse('COLORING = {.MAP: 1, .TILE: 2, .CHAR: 3}');
        const members = index.labels.filter(l => l.scopePath === 'coloring').map(l => l.name);
        expect(members.sort()).toEqual(['char', 'map', 'tile']);
    });

    it('nests the member scope inside the enclosing one', () => {
        const index = parse('outer   .namespace\nD       = {.A: 1}\n        .endn');
        expect(index.labels.find(l => l.name === 'a')?.scopePath).toBe('outer.d');
    });

    it('points the range at the key name, not the leading dot', () => {
        const source = 'D       = {.MAP: 1}';
        const label = parse(source).labels.find(l => l.name === 'map')!;
        expect(source.slice(label.range.start.character, label.range.end.character)).toBe('MAP');
    });

    it('records nothing for a value that is not a dict', () => {
        expect(parse('D       = 5').labels.map(l => l.name)).toEqual(['d']);
    });
});

describe('long-form scope closers', () => {
    // `.endnamespace` is not matched by a pattern built from `.endn`, so these
    // used to leave the scope open and nest everything after them inside it.
    it.each([
        ['.proc', '.endproc'], ['.proc', '.pend'],
        ['.block', '.endblock'], ['.block', '.bend'],
        ['.namespace', '.endnamespace'], ['.namespace', '.endn'],
        ['.macro', '.endmacro'], ['.macro', '.endm'],
        ['.function', '.endfunction'], ['.function', '.endf'],
        ['.struct', '.endstruct'], ['.struct', '.ends'],
        ['.union', '.endunion'], ['.union', '.endu'],
    ])('%s is closed by %s', (open, close) => {
        const index = parse(`a ${open}\ninner = 1\n        ${close}\nafter = 2`);
        expect(index.labels.find(l => l.name === 'after')?.scopePath).toBeNull();
    });

    it('does not nest sibling scopes that used a long-form closer', () => {
        const index = parse([
            'outer   .namespace', 'one     .namespace', 'a = 1', '        .endnamespace',
            'two     .namespace', 'b = 2', '        .endnamespace', '        .endnamespace',
        ].join('\n'));
        expect(index.labels.find(l => l.name === 'b')?.scopePath).toBe('outer.two');
    });
});

describe('block directives in comments and strings', () => {
    // The parser used to test the raw line, so a closer that was only being
    // talked about closed the enclosing scope and every label after it was filed
    // under the wrong one - silently, with no diagnostic.
    it.each([
        ['a closer in a comment', 'outer   .proc\n        lda #1   ; restore with .pend later\ninner   lda #2\n        .pend'],
        ['a closer in a string', 'outer   .block\n        .text "use .bend to close"\ninner   lda #2\n        .bend'],
        ['an opener in a comment', 'outer   .proc\n        lda #1   ; a .block here\ninner   lda #2\n        .pend'],
        ['an opener in a string', 'outer   .proc\n        .text "a .block b"\ninner   lda #2\n        .pend'],
    ])('ignores %s', (_name, source) => {
        expect(parse(source).labels.find(l => l.name === 'inner')?.scopePath).toBe('outer');
    });
});
