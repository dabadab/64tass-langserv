; .logical is closed by .here or .endlogical; .virtual by .endv/.endvirtual.
; Verified: this assembles cleanly.
        * = $1000

        .logical $2000
relocated
        nop
        .here

        .logical $3000
        nop
        .endlogical

        .virtual $c000
scratch .byte ?
        .endv

        lda scratch
        jmp relocated
