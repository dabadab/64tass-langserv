; A .dstruct/.dunion instance exposes its type's members. Verified: compiles cleanly.
        * = $1000

point   .struct
posx    .byte ?
posy    .byte ?
        .ends

colour  .union
packed  .word ?
        .endu

p1      .dstruct point, 1, 2
p2      .dstruct point, 3, 4
c1      .dunion colour

        lda p1.posx
        lda p1.posy
        lda p2.posx
        lda point.posx
        lda c1.packed
        rts
