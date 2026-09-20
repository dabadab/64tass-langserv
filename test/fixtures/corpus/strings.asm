; Directive names inside string literals must not be read as block markers (C6)
        * = $1000

        .text "text with .proc inside"
        .text "and a .pend here"
        .text "a .macro b"
msg:    .text "{grn} .kOd. .gfx."

; Byte string prefixes: the letter belongs to the literal. All seven are
; documented - x is hex entry, z is z85, and b'..' takes either quote.
raw     = b"oeU"
        .text s"p1"
        .text x"fce2"
        .text z"FiUj*2M$hf"
        .text n"abc"
        .text l"abc"
        .text p"abc"
        .byte len(raw)
        rts
