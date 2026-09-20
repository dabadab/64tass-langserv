; Anonymous labels resolving across named code labels (C2)
        * = $1000

first   inx
-       iny
second  dey
        bne -
        beq +
third   nop
+       rts

; An anonymous label may also stand where a scope opener's name goes. It names
; the address, so `jsr +` reaches it from here, while the block still hides what
; it holds - the manual's .from example is written this way.
shared  = 1
        jsr +
+       .block
shared  rts             ; a different symbol from the one above
        .bend
        rts
