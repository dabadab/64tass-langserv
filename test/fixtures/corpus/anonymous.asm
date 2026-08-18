; Anonymous labels resolving across named code labels (C2)
        * = $1000

first   inx
-       iny
second  dey
        bne -
        beq +
third   nop
+       rts
