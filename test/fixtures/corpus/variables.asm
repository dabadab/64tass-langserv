; Re-assignable variables (C3) and .for loop variables (C5), including a
; labelled loop, which the first C5 fix missed.
        * = $1000

v       .var 1
v       .var 2
w       := 10
w       := 20
w       ::= 30          ; reassigns an existing variable; it must exist already

        lda #v
        lda #w

squarelo .for i = 0, i < 8, i = i + 1
        .byte <(i * i)
        .next

        .for j = 0, j < 4, j = j + 1
        .byte j
        .next

; A .bfor scopes its body, so the `entry` inside it is not the one above the
; loop (verified: without the .b that is a duplicate definition).
entry   .byte 0

table   .bfor k in 1, 2
entry   .byte k
        .next

        lda squarelo
        lda table
        rts
