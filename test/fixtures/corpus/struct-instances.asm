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

; An UNNAMED .struct or .union puts its members in the enclosing scope: this is
; the zeropage-layout idiom, two alternative sets of fields over one area, each
; field reached unqualified. An unnamed .block hides its own, which is why the
; two cannot be treated alike.
        * = $02
        .union
        .struct
initlo  .byte ?
inithi  .byte ?
        .ends
        .struct
frame   .word ?
        .ends
        .endu

        * = $1100
        lda initlo
        lda inithi
        lda frame
        rts
