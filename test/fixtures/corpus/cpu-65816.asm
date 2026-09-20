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

; The size directives of this target: .autsiz follows the sep/rep above, .mansiz
; hands the width back to .as/.al and .xs/.xl, and .databank/.dpage say what the
; assembler may assume about the bank and direct page registers.
        .autsiz
        lda #$12
        .mansiz
        .al
        .xl
        lda #$1234
        ldx #$1234
        .as
        .xs
        .databank $01
        .dpage $1200
        lda $1234
        rtl
