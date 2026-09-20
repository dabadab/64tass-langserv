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

; Labels named after mnemonics of OTHER targets. Recognition uses the union of
; every CPU's opcodes, since the target may be set by a flag nobody here sees -
; but `map` and `neg` are the 45gs02's and the 4510's, not this file's, and a
; directive after the word settles it.
map     .fill 8
neg     .byte 1
        lda map
        lda neg
