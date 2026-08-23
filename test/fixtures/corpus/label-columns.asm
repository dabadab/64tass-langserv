; Labels and instructions in awkward columns.
;
; The first TOKEN decides which is which, never the column: an indented word is
; still a label definition, and "jsr rts" at column 0 defines nothing - jsr is the
; instruction and rts its operand. Reading the column instead lost every indented
; label and invented one for every "jsr rts".
        *= $1000

start   lda #$00
        sta counter
        jsr indented_sub
        jsr rts_holder
        rts

    indented_sub
        inx
    _after_indent
        dex
        rts

; A three-letter symbol as an operand, at both columns.
rts_holder
        jsr rts_target
        rts
rts_target
        nop
        rts

; A colon makes a label of a word that is otherwise an instruction.
nop:
        rts

counter .byte 0
