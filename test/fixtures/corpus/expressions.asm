; Float literals, exponents and dotted references in operands (C4)
        * = $1000

tbl     .block
lo      .byte 1
hi      .byte 2
        .bend

        .word tbl.lo, tbl.hi
        .byte <(3 * sin(rad(360.0 / 8)))
        .byte 1 + .5
        .byte 1e2 / 100

; "An underscore can be used between digits as a separator for better
; readability of long numbers" - in every numeric form.
        .word 1_000
        .word $ff_ff
        .byte %1010_1010
        .byte <(1_0.5e1)
        rts
