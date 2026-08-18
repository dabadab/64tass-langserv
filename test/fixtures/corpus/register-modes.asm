; 64tass accepts registers as operands, assembling them to the matching transfer
; or accumulator instruction. Verified: this assembles cleanly.
        * = $1000

table   .byte 1, 2, 3

start   lda x           ; TXA
        lda y           ; TYA
        ldx a           ; TAX
        ldy a           ; TAY
        ldx s           ; TSX
        stx s           ; TXS
        asl a           ; accumulator mode
        lsr a
        rol a
        ror a
        psh a           ; PHA
        pul a           ; PLA
        psh p           ; PHP
        pul p           ; PLP

        lda table,x
        lda table,y
        lda $10,b       ; bank suffix - forces absolute
        lda $10,d       ; direct-page suffix
        rts
