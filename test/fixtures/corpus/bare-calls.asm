; Macros and functions called without the `#` or `.` prefix, with a label in
; front - the form whole projects are written in, and one 64tass accepts with a
; -Wmacro-prefix warning at most.
        *= $1000

emit    .macro value
        .byte \value
        .endm

twice   .function n
        .byte n, n
.endf

start   emit 1          ; label, then a bare macro call
next:   emit 2          ; the same with a colon
        emit 3          ; no label at all
tbl     twice 4         ; a function called the same way

        jmp start
        jsr next
        .byte <tbl

; A call is not a label, so the `_local`s after one still belong to the code
; label above it: both are reached from before the calls. Argument and no
; argument, since the parser takes the first word of either for a label.
pad     .macro
        nop
        .endm
five    = 5

owner   beq _after_call
        beq _after_pad
        twice five
_after_call
        pad
_after_pad
        rts
