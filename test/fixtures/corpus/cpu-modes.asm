; The CPU target decides which mnemonics and register modes exist. This file
; declares 65816 with a .cpu directive; without it, none of these would be
; recognised as opcodes and the labels would not be indexed.
        .cpu "65816"
        * = $1000

start   rep #$30
        sep #$30
        xba
        tcd
        phb
        plb
        lda x           ; TXA - a register operand
        ldx s           ; TSX
        pea $1234
loop    brl loop
        rtl
