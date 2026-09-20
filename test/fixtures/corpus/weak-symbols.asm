; .weak is 64tass's stand-in for .ifdef: a definition inside one is overridden by
; a stronger one in the same scope, whichever comes first, so neither pairing is
; a duplicate. Two WEAK definitions of one name still are, which is why this file
; has only one of each.
        * = $1000

override = 1            ; the stronger definition
        .weak
override = 0            ; the default, dropped in favour of the line above
        .endweak

        .weak
fallback = 7            ; nothing stronger exists, so this one stands
        .endweak

        .weak
later   = 2             ; the stronger definition comes after this time
        .endweak
later   = 9

        lda #override
        lda #fallback
        lda #later
        rts
