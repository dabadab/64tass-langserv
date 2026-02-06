; Nested .proc/.block scopes and cross-scope references
; This file should compile cleanly with 64tass

        * = $1000

outer .proc
        nop
inner .proc
        lda #$01
        rts
        .pend
        jsr inner
        rts
        .pend

myblock .block
        lda #$02
        sta $10
        .bend

main
        jsr outer
        jsr outer.inner
        rts
