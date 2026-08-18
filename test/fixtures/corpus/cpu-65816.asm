; 65816 source: none of these mnemonics exist on the default target, so before the
; opcode tables were completed this file produced no labels at all.
        .cpu "65816"
        * = $1000

start   sep #$30
        rep #$30
        pea $1234
        phb
        plb
        phk
        xba
        tcd
        tdc
        tcs
        tsc
        txy
        tyx
        jsl faraway
        brl skip
loop    bra loop
skip    wai
        rtl

faraway rtl

table   .byte 1, 2, 3
        lda table
