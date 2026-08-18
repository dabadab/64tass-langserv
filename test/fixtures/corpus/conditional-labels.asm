; The same label defined in different branches of a chain is not a duplicate:
; the assembler assembles at most one branch. Verified - this compiles cleanly.
        * = $1000

        .if 1
handler nop
        .else
handler lda #1
        .endif

        .if 0
mode    .byte 0
        .elsif 1
mode    .byte 1
        .else
mode    .byte 2
        .endif

        .if 1
        .if 1
nested  nop
        .endif
        .else
nested  lda #2
        .endif

        jsr handler
        lda mode
        jmp nested
