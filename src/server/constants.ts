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
    // NMOS 65xx (-i), which adds the undocumented opcodes
    '6502': [
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
    '.logical': ['.endlogical'],
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
