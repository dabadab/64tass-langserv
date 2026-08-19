; .virtual lays out labels without emitting bytes. It is closed by .endv or
; .endvirtual - NOT by .here, which closes .logical only.

        * = $1000

        .virtual $c000
zp_ptr  .word 0
zp_tmp  .byte 0
counter .byte 0
        .endv

        .virtual $c100
alt_a   .byte 0
alt_b   .byte 0
        .endvirtual

        lda zp_tmp
        sta counter
        lda alt_a
        sta alt_b
        rts
