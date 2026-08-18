; Library reached through .binclude - its symbols land in the includer's block
; scope, so they are `sprite.setup` and not `setup` from the outside.
; Assembles standalone too, which is what the corpus test does with it.

setup   .block
origin  = $0400
        lda #<origin
        sta ptr
        rts
        .bend

ptr     .word 0

; A plain .include from inside a .binclude'd file stays in the same scope.
count   = 8
