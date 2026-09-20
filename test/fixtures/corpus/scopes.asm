; Nested and indented named scopes (C1), including colon-terminated openers.
; Everything here is referenced so the .proc bodies really are assembled.
        * = $1000

start
        jsr outer.inner.helper
        lda #outer.inner.val
        lda outer.table
        jsr flat
        rts

outer   .proc
    inner: .proc
val = 5
helper
        rts
    .pend

table:  .byte 1, 2, 3
        .pend

flat:   .block
        rts
        .bend

; `.namespace <expression>` activates the scope it names instead of creating
; one, which is how definitions in different files land in the same scope.
colors  .namespace
red     = 2
        .endnamespace

        .namespace colors
blue    = 6
        .endnamespace

        lda #colors.red
        lda #colors.blue
