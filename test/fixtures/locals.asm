; Local symbols under different code labels
; This file should compile cleanly with 64tass

        * = $1000

first
_tmp    = $10
        lda #_tmp
        rts

second
_tmp    = $20
        lda #_tmp
        rts

third
_count  = $05
_addr   = $30
        ldx #_count
        stx _addr
        rts
