; Exhaustive opcode/addressing-mode exercise for CPU "6502"
; Auto-generated from opcodes.c data - one line per addressing mode
	.cpu "6502"
	* = $1000
	adc #$12
	adc $1234
	adc $10
	adc $1234,x
	adc $10,x
	adc ($10,x)
	adc $1234,y
	adc ($10),y
	and #$12
	and $1234
	and $10
	and $1234,x
	and $10,x
	and ($10,x)
	and $1234,y
	and ($10),y
	asl a
	asl
	asl $1234
	asl $10
	asl $1234,x
	asl $10,x
-
	bcc -
-
	bcs -
-
	beq -
-
	bge -
	bit $1234
	bit $10
-
	blt -
-
	bmi -
-
	bne -
-
	bpl -
	brk
	brk #$12
-
	bvc -
-
	bvs -
	clc
	cld
	cli
	clv
	cmp #$12
	cmp $1234
	cmp $10
	cmp $1234,x
	cmp $10,x
	cmp ($10,x)
	cmp $1234,y
	cmp ($10),y
	cpa #$12
	cpa $1234
	cpa $10
	cpa $1234,x
	cpa $10,x
	cpa ($10,x)
	cpa $1234,y
	cpa ($10),y
	cpx #$12
	cpx $1234
	cpx $10
	cpy #$12
	cpy $1234
	cpy $10
	dec x
	dec y
	dec $1234
	dec $10
	dec $1234,x
	dec $10,x
	dex
	dey
	eor #$12
	eor $1234
	eor $10
	eor $1234,x
	eor $10,x
	eor ($10,x)
	eor $1234,y
	eor ($10),y
	gcc $1234
-
	gcc -
	gcs $1234
-
	gcs -
	geq $1234
-
	geq -
	gge $1234
-
	gge -
	glt $1234
-
	glt -
	gmi $1234
-
	gmi -
	gne $1234
-
	gne -
	gpl $1234
-
	gpl -
	gvc $1234
-
	gvc -
	gvs $1234
-
	gvs -
	inc x
	inc y
	inc $1234
	inc $10
	inc $1234,x
	inc $10,x
	inx
	iny
	jmp ($1234)
	jmp $1234
	jsr $1234
	lda x
	lda y
	lda #$12
	lda $1234
	lda $10
	lda $1234,x
	lda $10,x
	lda ($10,x)
	lda $1234,y
	lda ($10),y
	ldx a
	ldx s
	ldx #$12
	ldx $1234
	ldx $10
	ldx $1234,y
	ldx $10,y
	ldy a
	ldy #$12
	ldy $1234
	ldy $10
	ldy $1234,x
	ldy $10,x
	lsr a
	lsr
	lsr $1234
	lsr $10
	lsr $1234,x
	lsr $10,x
	nop
	ora #$12
	ora $1234
	ora $10
	ora $1234,x
	ora $10,x
	ora ($10,x)
	ora $1234,y
	ora ($10),y
	pha
	php
	pla
	plp
	psh a
	psh p
	pul a
	pul p
	rol a
	rol
	rol $1234
	rol $10
	rol $1234,x
	rol $10,x
	ror a
	ror
	ror $1234
	ror $10
	ror $1234,x
	ror $10,x
	rti
	rts
	sbc #$12
	sbc $1234
	sbc $10
	sbc $1234,x
	sbc $10,x
	sbc ($10,x)
	sbc $1234,y
	sbc ($10),y
	sec
	sed
	sei
	shl a
	shl
	shl $1234
	shl $10
	shl $1234,x
	shl $10,x
	shr a
	shr
	shr $1234
	shr $10
	shr $1234,x
	shr $10,x
	sta $1234
	sta $10
	sta $1234,x
	sta $10,x
	sta ($10,x)
	sta $1234,y
	sta ($10),y
	stx s
	stx $1234
	stx $10
	stx $10,y
	sty $1234
	sty $10
	sty $10,x
	tax
	tay
	tsx
	txa
	txs
	tya
