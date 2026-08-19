import { describe, it, expect } from 'vitest';
import {
    OPCODES,
    SCOPE_OPENERS,
    OPENER_TO_CLOSERS,
    CLOSING_DIRECTIVES,
    FOLDING_PAIRS,
    BUILTINS,
    BUILTIN_DIRECTIVES_PATTERN,
    ALL_DIRECTIVES,
    opcodesForCpu,
    registerModesForCpu,
    CPU_NAMES,
    DEFAULT_CPU,
    isCpuName
} from '../../src/server/constants';

describe('OPCODES', () => {
    it('contains standard 6502 opcodes', () => {
        const standard = ['lda', 'sta', 'jmp', 'jsr', 'rts', 'rti', 'brk', 'nop',
            'adc', 'sbc', 'and', 'ora', 'eor', 'cmp', 'cpx', 'cpy',
            'inc', 'dec', 'inx', 'dex', 'iny', 'dey',
            'tax', 'tay', 'txa', 'tya', 'tsx', 'txs',
            'pha', 'pla', 'php', 'plp',
            'bcc', 'bcs', 'beq', 'bne', 'bmi', 'bpl', 'bvc', 'bvs',
            'clc', 'sec', 'cli', 'sei', 'cld', 'sed', 'clv',
            'asl', 'lsr', 'rol', 'ror', 'bit', 'ldx', 'ldy', 'stx', 'sty'];
        for (const op of standard) {
            expect(OPCODES.has(op), `missing opcode: ${op}`).toBe(true);
        }
    });

    it('contains undocumented opcodes', () => {
        const undocumented = ['lax', 'sax', 'dcp', 'isb', 'slo', 'sre', 'rla', 'rra'];
        for (const op of undocumented) {
            expect(OPCODES.has(op), `missing undocumented opcode: ${op}`).toBe(true);
        }
    });

    it('stores all opcodes in lowercase', () => {
        for (const op of OPCODES) {
            expect(op).toBe(op.toLowerCase());
        }
    });
});

describe('SCOPE_OPENERS', () => {
    it('contains all scope-creating directives', () => {
        const expected = ['.proc', '.block', '.macro', '.function', '.struct', '.union', '.namespace'];
        expect(Object.keys(SCOPE_OPENERS).sort()).toEqual(expected.sort());
    });

    it('every opener has an entry in OPENER_TO_CLOSERS', () => {
        for (const open of Object.keys(SCOPE_OPENERS)) {
            expect(OPENER_TO_CLOSERS[open], `${open} missing from OPENER_TO_CLOSERS`).toBeDefined();
        }
    });
});

describe('CLOSING_DIRECTIVES', () => {
    it('is consistent reverse of OPENER_TO_CLOSERS', () => {
        for (const [open, closers] of Object.entries(OPENER_TO_CLOSERS)) {
            for (const close of closers) {
                expect(CLOSING_DIRECTIVES[close], `${close} missing from CLOSING_DIRECTIVES`).toBeDefined();
                expect(CLOSING_DIRECTIVES[close]).toContain(open);
            }
        }
    });
});

describe('FOLDING_PAIRS', () => {
    it('maps each opener to its first closer', () => {
        for (const [open, closers] of Object.entries(OPENER_TO_CLOSERS)) {
            expect(FOLDING_PAIRS[open]).toBe(closers[0]);
        }
    });
});

describe('BUILTINS', () => {
    it('contains registers', () => {
        expect(BUILTINS.has('a')).toBe(true);
        expect(BUILTINS.has('x')).toBe(true);
        expect(BUILTINS.has('y')).toBe(true);
    });

    it('contains common built-in functions', () => {
        const fns = ['abs', 'len', 'sin', 'cos', 'sqrt', 'format', 'range'];
        for (const fn of fns) {
            expect(BUILTINS.has(fn), `missing builtin: ${fn}`).toBe(true);
        }
    });

    it('overlaps OPCODES only where the assembler genuinely has both', () => {
        // `str` is both a reserved mnemonic and the string type - verified: a line
        // `str $10` is read as an instruction, while `.warn str` prints
        // <type 'str'>. Context decides, so both memberships are correct and this
        // is the one name allowed in both sets.
        expect([...BUILTINS].filter(b => OPCODES.has(b))).toEqual(['str']);
    });
});

describe('BUILTIN_DIRECTIVES_PATTERN', () => {
    it('matches common directives', () => {
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.byte')).toBe(true);
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.word')).toBe(true);
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.text')).toBe(true);
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.include')).toBe(true);
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.org')).toBe(true);
    });

    it('does not match user macros', () => {
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.mymacro')).toBe(false);
        expect(BUILTIN_DIRECTIVES_PATTERN.test('.custom')).toBe(false);
    });
});

describe('ALL_DIRECTIVES', () => {
    it('includes scope openers and closers', () => {
        expect(ALL_DIRECTIVES).toContain('proc');
        expect(ALL_DIRECTIVES).toContain('pend');
        expect(ALL_DIRECTIVES).toContain('macro');
        expect(ALL_DIRECTIVES).toContain('endm');
    });

    it('includes non-scope-creating directives', () => {
        expect(ALL_DIRECTIVES).toContain('byte');
        expect(ALL_DIRECTIVES).toContain('include');
        expect(ALL_DIRECTIVES).toContain('binary');
    });

    it('has no duplicates', () => {
        expect(new Set(ALL_DIRECTIVES).size).toBe(ALL_DIRECTIVES.length);
    });

    it('stores names without a leading dot', () => {
        for (const d of ALL_DIRECTIVES) {
            expect(d.startsWith('.')).toBe(false);
        }
    });
});

describe('OPCODES - CPUs beyond the default target', () => {
    // 64tass targets 11 CPUs; the table previously held only the default one, so a
    // 65816 or 4510 source produced no labels and therefore no navigation at all.
    it.each([
        ['65C02', ['bra', 'stz', 'trb', 'tsb', 'phx', 'phy', 'plx', 'ply']],
        ['65816', ['rep', 'sep', 'jsl', 'rtl', 'jml', 'pea', 'pei', 'per', 'brl', 'cop',
                   'mvn', 'mvp', 'tcd', 'tdc', 'tcs', 'tsc', 'txy', 'tyx', 'xba', 'wdm',
                   'phb', 'phd', 'phk', 'plb', 'pld', 'xce']],
        ['65CE02', ['asw', 'bsr', 'cle', 'cpz', 'dew', 'inw', 'ldz', 'neg', 'phz', 'plz', 'tab', 'taz']],
        ['4510', ['map', 'eom', 'rtn', 'row', 'tys', 'tza']],
        ['45GS02', ['adq', 'ldq', 'stq', 'deq', 'inq', 'orq', 'sbq', 'cpq']],
        ['W65C02', ['bbr', 'bbs', 'rmb', 'smb', 'wai', 'stp']],
        ['65EL02', ['mul', 'div', 'mmu', 'nxt', 'rha', 'swa', 'zea']],
    ])('includes %s mnemonics', (_cpu, mnemonics) => {
        for (const m of mnemonics) {
            expect(OPCODES.has(m), `missing mnemonic: ${m}`).toBe(true);
        }
    });

    it('stores every mnemonic lowercase', () => {
        for (const op of OPCODES) expect(op).toBe(op.toLowerCase());
    });

    it('still contains the original 6502 and undocumented sets', () => {
        for (const op of ['lda', 'sta', 'jmp', 'rts', 'nop', 'lax', 'sax', 'dcp', 'slo']) {
            expect(OPCODES.has(op), op).toBe(true);
        }
    });
});

describe('opcodesForCpu', () => {
    it('returns the base set plus that CPU\'s additions', () => {
        const base = opcodesForCpu('unknown-cpu');
        const c816 = opcodesForCpu('65816');
        expect(c816.size).toBeGreaterThan(base.size);
        // base mnemonics are present everywhere
        expect(base.has('lda')).toBe(true);
        expect(c816.has('lda')).toBe(true);
    });

    it('narrows: a 65816 mnemonic is absent from the base target', () => {
        expect(opcodesForCpu('65816').has('rtl')).toBe(true);
        expect(opcodesForCpu('unknown-cpu').has('rtl')).toBe(false);
        expect(opcodesForCpu('65c02').has('rtl')).toBe(false);
    });

    it('is case-insensitive about the CPU name', () => {
        expect(opcodesForCpu('65C02').has('stz')).toBe(true);
    });

    it('never returns more than the union', () => {
        for (const cpu of ['65c02', '65816', '4510', '45gs02', '65ce02', '65el02', '65dtv02']) {
            for (const op of opcodesForCpu(cpu)) expect(OPCODES.has(op), `${cpu}: ${op}`).toBe(true);
        }
    });
});

describe('CPU targets', () => {
    it('lists exactly the names the .cpu directive accepts', () => {
        // Verified against the assembler: these are accepted, and "6510" is not
        expect([...CPU_NAMES].sort()).toEqual([
            '4510', '45gs02', '6502', '6502i', '65816', '65c02', '65ce02',
            '65dtv02', '65el02', 'default', 'r65c02', 'w65c02'
        ]);
        expect(isCpuName('6510')).toBe(false);
    });

    it('defaults to the NMOS set including the undocumented opcodes', () => {
        // Deliberately wider than 64tass's own default: label detection gates on
        // the opcode table, so a C64 source using `lax` would index to no labels
        // at all on a narrower target.
        expect(DEFAULT_CPU).toBe('6502i');
        expect(opcodesForCpu(DEFAULT_CPU).has('lax')).toBe(true);
    });

    it('keeps the undocumented opcodes to 6502i, not 6502', () => {
        // `.cpu "6502"` is the documented set only - the same target as
        // `default` (--m65xx). The undocumented opcodes are `6502i` (--m6502).
        for (const undocumented of ['lax', 'sax', 'dcp', 'slo', 'anc']) {
            expect(opcodesForCpu('6502').has(undocumented), `6502 ${undocumented}`).toBe(false);
            expect(opcodesForCpu('default').has(undocumented), `default ${undocumented}`).toBe(false);
            expect(opcodesForCpu('6502i').has(undocumented), `6502i ${undocumented}`).toBe(true);
        }
    });

    it('treats 6502 and default as the same opcode set', () => {
        expect([...opcodesForCpu('6502')].sort()).toEqual([...opcodesForCpu('default')].sort());
    });

    it('recognises a name case-insensitively', () => {
        expect(isCpuName('65C02')).toBe(true);
        expect(isCpuName('nonsense')).toBe(false);
    });

    it('narrows opcodes to the target', () => {
        expect(opcodesForCpu('6502').has('xba')).toBe(false);   // 65816 only
        expect(opcodesForCpu('65816').has('xba')).toBe(true);
        expect(opcodesForCpu('6502').has('map')).toBe(false);   // 4510 only
        expect(opcodesForCpu('4510').has('map')).toBe(true);
    });

    it('narrows register modes to the target', () => {
        // The 65C02 added accumulator DEC/INC ("dec a"); the NMOS 6502 has neither
        expect(registerModesForCpu('65c02').dec).toContain('a');
        expect(registerModesForCpu('6502').dec ?? []).not.toContain('a');
        // 'z' is an operand only on the CPUs that have a Z register
        expect(registerModesForCpu('4510').dec).toContain('z');
        expect(registerModesForCpu('6502').dec ?? []).not.toContain('z');
        // ...while the plain transfers exist everywhere
        expect(registerModesForCpu('6502').ldx).toContain('s');   // TSX
        expect(registerModesForCpu('65816').lda).toContain('x');  // TXA
    });

    it('falls back to the default for an unknown CPU name', () => {
        expect(registerModesForCpu('nonsense')).toEqual(registerModesForCpu(DEFAULT_CPU));
        expect(opcodesForCpu('nonsense').has('lda')).toBe(true);
    });
});

describe('BUILTINS', () => {
    it('includes the type objects real sources use as conversions', () => {
        // These were all missing from the hand-written list, so every use of one
        // was reported as an undefined symbol.
        for (const name of ['int', 'bool', 'str', 'bytes', 'list', 'dict', 'tuple', 'float', 'bits', 'code', 'gap', 'type', 'address', 'register', 'symbol', 'namespace']) {
            expect(BUILTINS.has(name), name).toBe(true);
        }
    });

    it('includes pi', () => {
        expect(BUILTINS.has('pi')).toBe(true);
    });

    it('keeps the numeric and list functions', () => {
        for (const name of ['abs', 'len', 'range', 'random', 'sort', 'format', 'sqrt', 'round']) {
            expect(BUILTINS.has(name), name).toBe(true);
        }
    });

    it('does not contain names the assembler rejects', () => {
        // Verified against the assembler: these do not resolve, so treating them
        // as built-ins would silence a real undefined-symbol report.
        for (const name of ['none', 'label', 'anonymous', 'struct', 'union', 'macro', 'function']) {
            expect(BUILTINS.has(name), name).toBe(false);
        }
    });
});
