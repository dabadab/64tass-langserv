; Main file that includes a dependency
; This file should compile cleanly with 64tass

        * = $1000

        .include "includes-dep.asm"

main
        lda #depval
        rts
