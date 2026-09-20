; The manual's array idiom: .brept repeats a body, and a label in front of it
; names the whole run, whose elements are reached with an index and a member.
        * = $1000

sprites .brept 4
x       .byte ?
y       .byte ?
color   .byte ?
        .endrept

        ldy #0
        lda sprites[2].x
        lda sprites[0].color,y
        sta sprites[1].y
        rts
