; "More than one symbol may be looked up at the same time and the result will be
; a list or tuple" - the names in the parentheses belong to the scope in front of
; the dot, not to the one the line sits in. A `.(` with nothing in front of it
; builds a list of keys instead.
        * = $1000

colors  .namespace
red     = 2
green   = 3
blue    = 6
        .endnamespace

ctable  .byte colors.(red, green, blue)
        .byte colors.(red, green)[1]

index   = dict(colors.(red, green, blue), range(3))
        .byte index[colors.green]

        lda ctable
        rts
