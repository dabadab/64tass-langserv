; Symbols referenced in provably-dead .if branches, plus the define pragma
; standing in for a -D flag. Compile this with: -D linking=0
; 64tass-langserv: define linking = 0
        * = $1000

debug = 0

        .if 0
        jsr never_defined_at_all
        .endif

        .if debug
        jsr also_never_defined
        .else
        nop
        .endif

        .if linking = 1
        jsr link_load_next_raw
        .endif

; A loop variable decides nothing: both branches below are assembled, the first
; on the first pass and the second on the other two.
        .for i = 0, i < 3, i = i + 1
        .if i == 0
        .byte $01
        .else
        .byte $02
        .endif
        .next

        rts
