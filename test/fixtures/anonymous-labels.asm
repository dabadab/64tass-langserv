        * = $1000

; Test forward references
start
        ldy #4
-       ldx #0
        txa
        cmp #3
        bcc +           ; Forward to next +
        adc #44
+       sta $400,x
        inx
        bne -           ; Backward to previous -
        dey
        bne --          ; Backward two levels

; Test backward references
loop
-       dec $d020
-       inc $d021
        lda $dc01
        cmp #$ff
        beq -           ; Back to second -
        jmp --          ; Back to first -

; Test scope isolation
func1
+       nop
        jmp +           ; References next + in same scope
+       rts

func2
+       nop             ; Different scope, separate + namespace
        jmp +           ; Should reference this func2's + only
+       rts

; Test multiple symbols
multi
+++     nop             ; Three anonymous labels at same line
        bne +++         ; Jump forward 3 labels
+
+
+       rts
