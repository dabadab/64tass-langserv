; Assembles only with -C: without it the two names are one symbol, and the
; second definition is a duplicate.
        *= $1000
Flag    = 1
flag    = 2
        lda #Flag
        ldx #flag
        rts
