; Re-assignable variables (C3) and .for loop variables (C5), including a
; labelled loop, which the first C5 fix missed.
        * = $1000

v       .var 1
v       .var 2
w       := 10
w       := 20

        lda #v
        lda #w

squarelo .for i = 0, i < 8, i = i + 1
        .byte <(i * i)
        .next

        .for j = 0, j < 4, j = j + 1
        .byte j
        .next

        lda squarelo
        rts
