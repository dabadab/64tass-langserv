; Macro definition, call, and function definition
; This file should compile cleanly with 64tass

        * = $1000

load .macro value
        lda #\value
        .endm

add2 .function a, b
        .endf a + b

main
        .load $42
        lda #add2(1, 2)
        rts
