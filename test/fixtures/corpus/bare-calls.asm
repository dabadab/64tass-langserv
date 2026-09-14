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
