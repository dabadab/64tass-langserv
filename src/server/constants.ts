// 6502 opcodes for detecting code labels (scope boundaries for local symbols)
export const OPCODES = new Set([
    // Standard 6502 opcodes
    'adc', 'and', 'asl', 'bcc', 'bcs', 'beq', 'bit', 'bmi', 'bne', 'bpl',
    'brk', 'bvc', 'bvs', 'clc', 'cld', 'cli', 'clv', 'cmp', 'cpx', 'cpy',
    'dec', 'dex', 'dey', 'eor', 'inc', 'inx', 'iny', 'jmp', 'jsr', 'lda',
    'ldx', 'ldy', 'lsr', 'nop', 'ora', 'pha', 'php', 'pla', 'plp', 'rol',
    'ror', 'rti', 'rts', 'sbc', 'sec', 'sed', 'sei', 'sta', 'stx', 'sty',
    'tax', 'tay', 'tsx', 'txa', 'txs', 'tya',
    // Undocumented 6502 opcodes (as used by 64tass)
    'ane', 'arr', 'asr', 'dcp', 'isb', 'jam', 'lax', 'lds', 'rla', 'rra',
    'sax', 'sbx', 'sha', 'shs', 'shx', 'shy', 'slo', 'sre', 'ahx', 'alr',
    'axs', 'dcm', 'ins', 'isc', 'lae', 'las', 'lxa', 'tas', 'xaa'
]);

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
