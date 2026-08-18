; Directive names inside string literals must not be read as block markers (C6)
        * = $1000

        .text "text with .proc inside"
        .text "and a .pend here"
        .text "a .macro b"
msg:    .text "{grn} .kOd. .gfx."
        rts
