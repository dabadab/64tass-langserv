; .binclude wraps a file in a named block scope, unlike the textual .include.

        * = $1000

start
        jsr sprite.setup
        lda sprite.ptr
        lda #sprite.count
        lda #<sprite.setup.origin
        rts

sprite  .binclude "binclude-lib.asm"

; The same file bincluded twice gets two independent scopes in the assembler.
; The index keeps one entry per URI, so only the first scope is modelled - see
; includeScopes in parser.ts.
