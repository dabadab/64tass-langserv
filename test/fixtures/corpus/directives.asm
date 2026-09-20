; Directives with real semantics that no other fixture exercises: custom
; encodings, page and alignment checks, the output-offset and option controls,
; the loop escapes, and the conditional forms that test a value's sign.
        * = $1000

; A custom encoding, defined with .cdef / .edef / .tdef and used in a block.
screen  .encode
        .cdef "az", $01
        .cdef "AZ", $01
        .edef "{cr}", $0d
        .tdef " ", $20
        .endencode

        .encode screen
msg     .text "hello world"
        .endencode

; .page checks that what it holds does not cross a page boundary.
        .page
tbl     .byte 1, 2, 3, 4
        .endpage

; .alignblk aligns the block it holds.
        .alignblk $10
aligned .byte 1
        .endalignblk

; .offs shifts the output address, .option sets an assembly option, and the
; listing controls turn the list file off and on again.
        .offs 0
        .option allow_branch_across_page = 1
        .proff
        .byte 0
        .pron

; The loop escapes, and the conditional forms that test a sign.
        .for i = 0, i < 8, i = i + 1
        .breakif i > 5
        .if i == 2
        .continue
        .endif
        .byte i
        .endfor

        .ifne 1
        .byte $01
        .endif
        .ifmi -1
        .byte $02
        .endif
        .ifpl 1
        .byte $03
        .endif

; .eor and .seed change how bytes come out and where randomness starts.
        .eor $ff
        .byte 1, 2
        .eor 0
        .seed 1234
        .byte random(0, 255) >= 0

; The data directives handled by the generic machinery.
        .addr tbl
        .dint $12345678
        .shiftl "ab"
        rts
