; Basic labels, opcodes, constants, and data directives
; This file should compile cleanly with 64tass

        * = $1000

start
        lda #$00
        sta $02
        jmp loop

val     = $FF
count   := 42

table   .byte 1, 2, 3, 4, 5
msg     .text "hello"
ptr     .word start

loop
        ldx #$00
        inx
        cpx #$05
        bne loop
        rts
