; Included by main.asm, and broken on purpose too - its error must be reported
; against THIS file, not against the file that assembles it.
helper  lda ($10),x
        rts
