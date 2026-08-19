/**
 * Mnemonics for every CPU 64tass can target, used to recognise "label OPCODE"
 * lines (and to keep opcodes out of symbol completion and semantic tokens).
 *
 * Derived by probing 64tass V1.60.3243 itself with every three-letter
 * combination under each of its CPU selection flags, rather than transcribed by
 * hand - the previous list covered only the default target, so a 65816 or 4510
 * source produced no labels at all and therefore no navigation.
 *
 * OPCODES is the union: recognition must not depend on knowing which CPU a file
 * targets, since a project may set it with .cpu or a command-line flag we cannot
 * see. The per-CPU breakdown is kept so a future setting could narrow it.
 */
// Mnemonics accepted by the default target (--m65xx).
const OPCODES_BASE = [
    'adc', 'and', 'asl', 'bcc', 'bcs', 'beq', 'bge', 'bit', 'blt', 'bmi', 'bne', 'bpl', 'brk',
    'bvc', 'bvs', 'clc', 'cld', 'cli', 'clv', 'cmp', 'cpa', 'cpx', 'cpy', 'dec', 'dex', 'dey',
    'eor', 'gcc', 'gcs', 'geq', 'gge', 'glt', 'gmi', 'gne', 'gpl', 'gvc', 'gvs', 'inc', 'inx',
    'iny', 'jmp', 'jsr', 'lda', 'ldr', 'ldx', 'ldy', 'lsr', 'nop', 'ora', 'orr', 'pha', 'php',
    'pla', 'plp', 'psh', 'pul', 'rol', 'ror', 'rti', 'rts', 'sbc', 'sec', 'sed', 'sei', 'shl',
    'shr', 'sta', 'str', 'stx', 'sty', 'tax', 'tay', 'tsx', 'txa', 'txs', 'tya'
];

// Additions per target CPU, relative to the base set above. 64tass supports all of
// these via its CPU selection flags and the .cpu directive.
const OPCODES_BY_CPU: Record<string, string[]> = {
    // CMOS 65C02
    '65c02': [
        'bra', 'clr', 'dea', 'gra', 'ina', 'phx', 'phy', 'plx', 'ply', 'stz', 'trb', 'tsb'
    ],
    // R65C02
    'r65c02': [
        'bbr', 'bbs', 'bra', 'clr', 'dea', 'gra', 'ina', 'phx', 'phy', 'plx', 'ply', 'rmb', 'smb',
        'stz', 'trb', 'tsb'
    ],
    // W65C02
    'w65c02': [
        'bbr', 'bbs', 'bra', 'clr', 'dea', 'gra', 'hlt', 'ina', 'phx', 'phy', 'plx', 'ply', 'rmb',
        'smb', 'stp', 'stz', 'trb', 'tsb', 'wai'
    ],
    // CSG 65CE02
    '65ce02': [
        'asr', 'asw', 'bbr', 'bbs', 'bra', 'bsr', 'cle', 'cpz', 'dea', 'dew', 'dez', 'gra', 'ina',
        'inw', 'inz', 'ldz', 'neg', 'phw', 'phx', 'phy', 'phz', 'plx', 'ply', 'plz', 'rlw', 'rmb',
        'row', 'rtn', 'see', 'smb', 'stz', 'tab', 'tad', 'taz', 'tba', 'tda', 'trb', 'tsb', 'tsy',
        'tys', 'tza'
    ],
    // 65EL02
    '65el02': [
        'bra', 'clp', 'clr', 'dea', 'div', 'ent', 'gra', 'hlt', 'ina', 'mmu', 'mul', 'nxa', 'nxt',
        'pea', 'pei', 'per', 'phd', 'phx', 'phy', 'pld', 'plx', 'ply', 'rea', 'rei', 'rep', 'rer',
        'rha', 'rhi', 'rhx', 'rhy', 'rla', 'rli', 'rlx', 'rly', 'rsh', 'rul', 'sea', 'sep', 'stp',
        'stz', 'swa', 'tad', 'tda', 'tix', 'trb', 'trx', 'tsb', 'txi', 'txr', 'txy', 'tyx', 'wai',
        'xba', 'xce', 'zea'
    ],
    // W65C816
    '65816': [
        'bra', 'brl', 'clp', 'clr', 'cop', 'csp', 'dea', 'gra', 'hlt', 'ina', 'jml', 'jsl', 'mvn',
        'mvp', 'pea', 'pei', 'per', 'phb', 'phd', 'phk', 'phx', 'phy', 'plb', 'pld', 'plx', 'ply',
        'rep', 'rtl', 'sep', 'stp', 'stz', 'swa', 'tad', 'tas', 'tcd', 'tcs', 'tda', 'tdc', 'trb',
        'tsa', 'tsb', 'tsc', 'txy', 'tyx', 'wai', 'wdm', 'xba', 'xce'
    ],
    // 65DTV02
    '65dtv02': [
        'alr', 'ane', 'arr', 'asr', 'bra', 'dcm', 'dcp', 'gra', 'ins', 'isb', 'isc', 'lax', 'lxa',
        'rla', 'rra', 'sac', 'sax', 'sir', 'slo', 'sre', 'xaa'
    ],
    // CSG 4510
    '4510': [
        'asr', 'asw', 'bbr', 'bbs', 'bra', 'bsr', 'cle', 'cpz', 'dea', 'dew', 'dez', 'eom', 'gra',
        'ina', 'inw', 'inz', 'ldz', 'map', 'neg', 'phw', 'phx', 'phy', 'phz', 'plx', 'ply', 'plz',
        'rlw', 'rmb', 'row', 'rtn', 'see', 'smb', 'stz', 'tab', 'tad', 'taz', 'tba', 'tda', 'trb',
        'tsb', 'tsy', 'tys', 'tza'
    ],
    // 45GS02
    '45gs02': [
        'adq', 'anq', 'ard', 'asd', 'asr', 'asw', 'bbr', 'bbs', 'bra', 'bsr', 'btq', 'cle', 'cpq',
        'cpz', 'dea', 'ded', 'deq', 'dew', 'dez', 'eom', 'eoq', 'gra', 'ina', 'ind', 'inq', 'inw',
        'inz', 'ldq', 'ldz', 'lsd', 'map', 'neg', 'orq', 'phw', 'phx', 'phy', 'phz', 'plx', 'ply',
        'plz', 'rld', 'rlw', 'rmb', 'row', 'rrd', 'rtn', 'sbq', 'see', 'smb', 'stq', 'stz', 'tab',
        'tad', 'taz', 'tba', 'tda', 'trb', 'tsb', 'tsy', 'tys', 'tza'
    ],
    // NMOS 65xx (the -i / --m6502 flag), which adds the undocumented opcodes.
    // Note this is `6502i`, NOT `6502`: `.cpu "6502"` selects the standard set
    // and is identical to `default` (verified - both are --m65xx, and both
    // reject `lax`). Getting these two the wrong way round made every
    // undocumented mnemonic look valid on a plain 6502 target.
    '6502i': [
        'ahx', 'alr', 'anc', 'ane', 'arr', 'asr', 'axs', 'dcm', 'dcp', 'ins', 'isb', 'isc', 'jam',
        'lae', 'las', 'lax', 'lds', 'lxa', 'rla', 'rra', 'sax', 'sbx', 'sha', 'shs', 'shx', 'shy',
        'slo', 'sre', 'tas', 'xaa'
    ],
};

export const OPCODES: ReadonlySet<string> = new Set<string>([
    ...OPCODES_BASE,
    ...Object.values(OPCODES_BY_CPU).flat()
]);

/** Mnemonics for one CPU target, for a future per-CPU narrowing of OPCODES. */
export function opcodesForCpu(cpu: string): ReadonlySet<string> {
    return new Set([...OPCODES_BASE, ...(OPCODES_BY_CPU[cpu.toLowerCase()] ?? [])]);
}

/**
 * CPU targets 64tass accepts, exactly as spelled in the `.cpu` directive.
 *
 * There is no "6510": the C64's CPU is spelled `6502i` here, the NMOS set that
 * includes the undocumented opcodes. Plain `6502` is the documented set only and
 * is the same target as `default` (both --m65xx).
 */
export const CPU_NAMES = [
    'default', '6502', '6502i', '65c02', '65ce02', '65dtv02', '65el02',
    '65816', 'r65c02', 'w65c02', '4510', '45gs02'
] as const;

export type CpuName = typeof CPU_NAMES[number];

/**
 * CPU assumed when a file says nothing, matching 64tass's own default target
 * (--m65xx, which `.cpu` spells as both `default` and `6502` - they are the same
 * set). A C64 source that uses the undocumented opcodes needs `6502i`, set
 * through the `64tass.cpu` setting, a `.cpu` directive or the cpu pragma.
 */
export const DEFAULT_CPU: CpuName = '6502';

export function isCpuName(name: string): name is CpuName {
    return (CPU_NAMES as readonly string[]).includes(name.toLowerCase());
}

/**
 * Register and addressing-keyword operands.
 *
 * 64tass accepts a register where an address would normally go, assembling it to
 * the corresponding transfer or accumulator instruction: `lda x` is TXA, `ldx s`
 * is TSX, `asl a` is accumulator-mode ASL, `psh p` is PHP. These are NOT symbol
 * references, so they must not be reported as undefined symbols.
 *
 * Probed from 64tass V1.60.3243 for every CPU target, over the whole alphabet
 * rather than a hand-picked set of letters - a curated list silently omitted
 * 45gs02's `q` and 65el02's `i`, which then read as undefined symbols.
 */
/**
 * Valid register operands per opcode, for each CPU 64tass can target.
 * Probed from the assembler across every target; see REGISTER_MODES above.
 */
const REGISTER_MODES_BY_CPU: Record<string, Record<string, readonly string[]>> = {
    '4510': {
        asl: ['a'],
        asr: ['a'],
        dec: ['a', 'x', 'y', 'z'],
        inc: ['a', 'x', 'y', 'z'],
        lda: ['d', 'x', 'y', 'z'],
        ldx: ['a', 's'],
        ldy: ['a', 's'],
        ldz: ['a'],
        lsr: ['a'],
        neg: ['a'],
        psh: ['a', 'p', 'x', 'y', 'z'],
        pul: ['a', 'p', 'x', 'y', 'z'],
        rol: ['a'],
        ror: ['a'],
        shl: ['a'],
        shr: ['a'],
        sta: ['a', 'd'],
        stx: ['s', 'x'],
        sty: ['s', 'y'],
        stz: ['z'],
    },
    '6502': {
        asl: ['a'],
        dec: ['x', 'y'],
        inc: ['x', 'y'],
        lda: ['x', 'y'],
        ldx: ['a', 's'],
        ldy: ['a'],
        lsr: ['a'],
        psh: ['a', 'p'],
        pul: ['a', 'p'],
        rol: ['a'],
        ror: ['a'],
        shl: ['a'],
        shr: ['a'],
        sta: ['a'],
        stx: ['s', 'x'],
        sty: ['y'],
    },
    '65816': {
        asl: ['a'],
        dec: ['a', 'x', 'y'],
        inc: ['a', 'x', 'y'],
        lda: ['d', 's', 'x', 'y'],
        ldx: ['a', 's', 'y'],
        ldy: ['a', 'x'],
        lsr: ['a'],
        psh: ['a', 'b', 'd', 'k', 'p', 'x', 'y'],
        pul: ['a', 'b', 'd', 'p', 'x', 'y'],
        rol: ['a'],
        ror: ['a'],
        shl: ['a'],
        shr: ['a'],
        sta: ['a', 's'],
        stx: ['s', 'x'],
        sty: ['y'],
        stz: ['z'],
    },
    'default': {
        asl: ['a'],
        dec: ['x', 'y'],
        inc: ['x', 'y'],
        lda: ['x', 'y'],
        ldx: ['a', 's'],
        ldy: ['a'],
        lsr: ['a'],
        psh: ['a', 'p'],
        pul: ['a', 'p'],
        rol: ['a'],
        ror: ['a'],
        shl: ['a'],
        shr: ['a'],
        sta: ['a'],
        stx: ['s', 'x'],
        sty: ['y'],
    },
    '6502i': {
        asl: ['a'],
        dec: ['x', 'y'],
        inc: ['x', 'y'],
        lda: ['x', 'y'],
        ldx: ['a', 's'],
        ldy: ['a'],
        lsr: ['a'],
        psh: ['a', 'p'],
        pul: ['a', 'p'],
        rol: ['a'],
        ror: ['a'],
        shl: ['a'],
        shr: ['a'],
        sta: ['a'],
        stx: ['s', 'x'],
        sty: ['y'],
    },
    '65c02': {
        asl: ['a'],
        dec: ['a', 'x', 'y'],
        inc: ['a', 'x', 'y'],
        lda: ['x', 'y'],
        ldx: ['a', 's'],
        ldy: ['a'],
        lsr: ['a'],
        psh: ['a', 'p', 'x', 'y'],
        pul: ['a', 'p', 'x', 'y'],
        rol: ['a'],
        ror: ['a'],
        shl: ['a'],
        shr: ['a'],
        sta: ['a'],
        stx: ['s', 'x'],
        sty: ['y'],
        stz: ['z'],
    },
    '65ce02': {
        asl: ['a'],
        asr: ['a'],
        dec: ['a', 'x', 'y', 'z'],
        inc: ['a', 'x', 'y', 'z'],
        lda: ['d', 'x', 'y', 'z'],
        ldx: ['a', 's'],
        ldy: ['a', 's'],
        ldz: ['a'],
        lsr: ['a'],
        neg: ['a'],
        psh: ['a', 'p', 'x', 'y', 'z'],
        pul: ['a', 'p', 'x', 'y', 'z'],
        rol: ['a'],
        ror: ['a'],
        shl: ['a'],
        shr: ['a'],
        sta: ['a', 'd'],
        stx: ['s', 'x'],
        sty: ['s', 'y'],
        stz: ['z'],
    },
    '65dtv02': {
        asl: ['a'],
        dec: ['x', 'y'],
        inc: ['x', 'y'],
        lda: ['x', 'y'],
        ldx: ['a', 's'],
        ldy: ['a'],
        lsr: ['a'],
        psh: ['a', 'p'],
        pul: ['a', 'p'],
        rol: ['a'],
        ror: ['a'],
        shl: ['a'],
        shr: ['a'],
        sta: ['a'],
        stx: ['s', 'x'],
        sty: ['y'],
    },
    '65el02': {
        asl: ['a'],
        dec: ['a', 'x', 'y'],
        inc: ['a', 'x', 'y'],
        lda: ['d', 'x', 'y'],
        ldx: ['a', 'i', 'r', 's', 'y'],
        ldy: ['a', 'x'],
        lsr: ['a'],
        psh: ['a', 'd', 'p', 'x', 'y'],
        pul: ['a', 'd', 'p', 'x', 'y'],
        rol: ['a'],
        ror: ['a'],
        rsh: ['a', 'i', 'x', 'y'],
        rul: ['a', 'i', 'x', 'y'],
        shl: ['a'],
        shr: ['a'],
        sta: ['a'],
        stx: ['s', 'x'],
        sty: ['y'],
        stz: ['z'],
    },
    'r65c02': {
        asl: ['a'],
        dec: ['a', 'x', 'y'],
        inc: ['a', 'x', 'y'],
        lda: ['x', 'y'],
        ldx: ['a', 's'],
        ldy: ['a'],
        lsr: ['a'],
        psh: ['a', 'p', 'x', 'y'],
        pul: ['a', 'p', 'x', 'y'],
        rol: ['a'],
        ror: ['a'],
        shl: ['a'],
        shr: ['a'],
        sta: ['a'],
        stx: ['s', 'x'],
        sty: ['y'],
        stz: ['z'],
    },
    'w65c02': {
        asl: ['a'],
        dec: ['a', 'x', 'y'],
        inc: ['a', 'x', 'y'],
        lda: ['x', 'y'],
        ldx: ['a', 's'],
        ldy: ['a'],
        lsr: ['a'],
        psh: ['a', 'p', 'x', 'y'],
        pul: ['a', 'p', 'x', 'y'],
        rol: ['a'],
        ror: ['a'],
        shl: ['a'],
        shr: ['a'],
        sta: ['a'],
        stx: ['s', 'x'],
        sty: ['y'],
        stz: ['z'],
    },
    '45gs02': {
        ard: ['q'],
        asd: ['q'],
        asl: ['a', 'q'],
        asr: ['a', 'q'],
        dec: ['a', 'q', 'x', 'y', 'z'],
        ded: ['q'],
        inc: ['a', 'q', 'x', 'y', 'z'],
        ind: ['q'],
        lda: ['d', 'x', 'y', 'z'],
        ldx: ['a', 's'],
        ldy: ['a', 's'],
        ldz: ['a'],
        lsd: ['q'],
        lsr: ['a', 'q'],
        neg: ['a'],
        psh: ['a', 'p', 'x', 'y', 'z'],
        pul: ['a', 'p', 'x', 'y', 'z'],
        rld: ['q'],
        rol: ['a', 'q'],
        ror: ['a', 'q'],
        rrd: ['q'],
        shl: ['a', 'q'],
        shr: ['a', 'q'],
        sta: ['a', 'd'],
        stx: ['s', 'x'],
        sty: ['s', 'y'],
        stz: ['z'],
    },
};

/** Valid register operands for one CPU, falling back to the default target. */
export function registerModesForCpu(cpu: string): Record<string, readonly string[]> {
    return REGISTER_MODES_BY_CPU[cpu.toLowerCase()] ?? REGISTER_MODES_BY_CPU[DEFAULT_CPU];
}

/** Union across all CPUs, for callers that do not know the target. */
export const REGISTER_MODES: Record<string, readonly string[]> = (() => {
    const merged: Record<string, Set<string>> = {};
    for (const modes of Object.values(REGISTER_MODES_BY_CPU)) {
        for (const [opcode, regs] of Object.entries(modes)) {
            merged[opcode] ??= new Set();
            for (const r of regs) merged[opcode].add(r);
        }
    }
    return Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, [...v].sort()]));
})();

/**
 * Names valid immediately after a comma in an operand: the index registers
 * (`lda tbl,x`, 65816 stack-relative `lda $01,s`) and the addressing-size / bank
 * suffixes (`,b` forces absolute, `,d` forces direct page, `,k` program bank,
 * `,r` data stack). Also not symbol references.
 */
export const INDEX_REGISTERS: ReadonlySet<string> = new Set(['b', 'd', 'k', 'r', 's', 'x', 'y', 'z']);

// Directives that create new scopes (opener -> primary closer)
export const SCOPE_OPENERS: Record<string, string> = {
    '.proc': '.pend',
    '.block': '.bend',
    '.macro': '.endm',
    '.function': '.endf',
    '.struct': '.ends',
    '.union': '.endu',
    '.namespace': '.endn'
};

// All valid closers for each opener
// Loops can be closed by .next OR their specific .end* directive
export const OPENER_TO_CLOSERS: Record<string, string[]> = {
    '.proc': ['.pend', '.endproc'],
    '.block': ['.bend', '.endblock'],
    '.macro': ['.endm', '.endmacro'],
    '.function': ['.endf', '.endfunction'],
    '.struct': ['.ends', '.endstruct'],
    '.union': ['.endu', '.endunion'],
    '.if': ['.endif', '.fi'],
    '.ifeq': ['.endif', '.fi'],
    '.ifne': ['.endif', '.fi'],
    '.ifmi': ['.endif', '.fi'],
    '.ifpl': ['.endif', '.fi'],
    '.for': ['.next', '.endfor'],
    '.bfor': ['.next', '.endfor'],
    '.rept': ['.next', '.endrept'],
    '.brept': ['.next', '.endrept'],
    '.while': ['.next', '.endwhile'],
    '.bwhile': ['.next', '.endwhile'],
    '.switch': ['.endswitch'],
    '.comment': ['.endc', '.endcomment'],
    '.weak': ['.endweak'],
    '.with': ['.endwith'],
    '.encode': ['.endencode'],
    '.alignblk': ['.endalignblk'],
    '.page': ['.endp', '.endpage'],
    // .here closes .logical only - the assembler rejects .virtual ... .here
    // with "opening directive '.logical' not found" (verified)
    '.logical': ['.endlogical', '.here'],
    '.virtual': ['.endv', '.endvirtual'],
    '.namespace': ['.endn', '.endnamespace'],
    '.section': ['.send', '.endsection'],
    '.segment': ['.endsegment']
};

// Reverse mapping: closer -> list of openers it can close
export const CLOSING_DIRECTIVES: Record<string, string[]> = {};
for (const [open, closers] of Object.entries(OPENER_TO_CLOSERS)) {
    for (const close of closers) {
        if (!CLOSING_DIRECTIVES[close]) {
            CLOSING_DIRECTIVES[close] = [];
        }
        if (!CLOSING_DIRECTIVES[close].includes(open)) {
            CLOSING_DIRECTIVES[close].push(open);
        }
    }
}

// For compatibility: FOLDING_PAIRS maps opener to primary closer
export const FOLDING_PAIRS: Record<string, string> = {};
for (const [open, closers] of Object.entries(OPENER_TO_CLOSERS)) {
    FOLDING_PAIRS[open] = closers[0];
}

// Built-in names to ignore when checking for undefined symbols
export const BUILTINS = new Set([
    // Registers
    'a', 'x', 'y',
    // Boolean/null literals
    'true', 'false',
    // Built-in functions (can be shadowed by user definitions)
    'abs', 'acos', 'addr', 'all', 'any', 'asin', 'atan', 'atan2', 'binary',
    'byte', 'cbrt', 'ceil', 'char', 'cos', 'cosh', 'deg', 'dint', 'dword',
    'exp', 'floor', 'format', 'frac', 'hypot', 'len', 'lint', 'log', 'log10',
    'long', 'pow', 'rad', 'random', 'range', 'repr', 'round', 'rta', 'sign',
    'sin', 'sinh', 'sint', 'size', 'sort', 'sqrt', 'tan', 'tanh', 'trunc', 'word',
]);

// Built-in directives regex pattern for validation
export const BUILTIN_DIRECTIVES_PATTERN = /^\.(byte|word|long|dword|addr|rta|text|ptext|null|fill|align|binary|include|binclude|org|cpu|enc|cdef|edef|assert|error|warn|cerror|cwarn|var|let|const|here|as|option|eor|seed|else|elsif|elif|case|default|shift|shiftl|proff|pron|hidemac|showmac|continue|break|breakif|continueif|sfunction|lbl|goto|databank|dpage|autsiz|mansiz|char|dint|lint|sint|dsection|dstruct|dunion|offs|tdef|al|alignind|alignpageind|check|from|xl|xs|end)$/i;

// Canonical list of all directive names (without the leading dot), for completion.
// Derived from the other directive sources above so there's a single source of
// truth instead of a separately hand-maintained list that could drift out of sync.
const BUILTIN_DIRECTIVE_NAMES: string[] = (() => {
    const match = BUILTIN_DIRECTIVES_PATTERN.source.match(/^\^\\\.\((.+)\)\$$/);
    return match ? match[1].split('|') : [];
})();

// Directives whose argument is a name from a fixed vocabulary (encoding name, CPU
// name, compiler option), never a user-defined symbol - so symbol completion
// should not fire for their arguments. Names without the leading dot.
export const NON_SYMBOL_ARG_DIRECTIVES = new Set(['enc', 'cpu', 'option', 'encode']);

export const ALL_DIRECTIVES: string[] = Array.from(new Set([
    ...Object.keys(SCOPE_OPENERS).map(d => d.slice(1)),
    ...Object.keys(OPENER_TO_CLOSERS).map(d => d.slice(1)),
    ...Object.values(OPENER_TO_CLOSERS).flat().map(d => d.slice(1)),
    ...BUILTIN_DIRECTIVE_NAMES
])).sort();
