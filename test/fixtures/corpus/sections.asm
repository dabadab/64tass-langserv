; .dsection reserves a section, .section fills it. Labels defined inside a
; section belong to the enclosing scope, not to a scope named after the section.

        * = $1000

        .dsection code
        .dsection data

        .section code
entry   lda table
        jsr routine
        rts

routine lda #1
        rts
        .send

        .section data
table   .byte 1, 2, 3, 4
        .send

; Reachable unqualified from outside the section.
        lda table
        jsr routine
        jsr entry
