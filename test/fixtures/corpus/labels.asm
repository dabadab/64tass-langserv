; Colon-terminated labels in every position, with and without a space (C7 +
; the colon gap), and operands that must still be validated after them.
        * = $1000

value = $42

table:.byte 1, 2, 3
msg:.text "hi"
word_:.word $1234
loop:inx
        lda value
spaced: .byte value
derived = value + 1
derived2 := value + 2
        lda #derived
        lda #derived2
        bne loop
        rts
