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
        rts
