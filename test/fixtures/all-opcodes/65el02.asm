; Exhaustive opcode/addressing-mode exercise for CPU "65el02"
; Auto-generated from opcodes.c data - one line per addressing mode
	.cpu "65el02"
	* = $1000
	adc #$12
	adc $1234
	adc $10
	adc $1234,x
	adc $10,x
	adc ($10,x)
	adc $10,s
	adc ($10,s),y
	adc $1234,y
	adc ($10),y
	adc ($10)
	adc ($10,r),y
	adc $10,r
	and #$12
	and $1234
	and $10
	and $1234,x
	and $10,x
	and ($10,x)
	and $10,s
	and ($10,s),y
	and $1234,y
	and ($10),y
	and ($10)
	and ($10,r),y
	and $10,r
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
	bit #$12
	bit $1234
	bit $10
	bit $1234,x
	bit $10,x
-
	blt -
-
	bmi -
-
	bne -
-
	bpl -
-
	bra -
	brk
	brk #$12
-
	bvc -
-
	bvs -
	clc
	cld
	cli
	clp #$12
	clr $1234
	clr $10
	clr $1234,x
	clr $10,x
	clv
	cmp #$12
	cmp $1234
	cmp $10
	cmp $1234,x
	cmp $10,x
	cmp ($10,x)
	cmp $10,s
	cmp ($10,s),y
	cmp $1234,y
	cmp ($10),y
	cmp ($10)
	cmp ($10,r),y
	cmp $10,r
	cpa #$12
	cpa $1234
	cpa $10
	cpa $1234,x
	cpa $10,x
	cpa ($10,x)
	cpa $10,s
	cpa ($10,s),y
	cpa $1234,y
	cpa ($10),y
	cpa ($10)
	cpa ($10,r),y
	cpa $10,r
	cpx #$12
	cpx $1234
	cpx $10
	cpy #$12
	cpy $1234
	cpy $10
	dea
	dec a
	dec x
	dec y
	dec $1234
	dec $10
	dec $1234,x
	dec $10,x
	dex
	dey
	div $1234
	div $10
	div $1234,x
	div $10,x
	ent
	eor #$12
	eor $1234
	eor $10
	eor $1234,x
	eor $10,x
	eor ($10,x)
	eor $10,s
	eor ($10,s),y
	eor $1234,y
	eor ($10),y
	eor ($10)
	eor ($10,r),y
	eor $10,r
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
	gra $1234
-
	gra -
	gvc $1234
-
	gvc -
	gvs $1234
-
	gvs -
	hlt
	ina
	inc a
	inc x
	inc y
	inc $1234
	inc $10
	inc $1234,x
	inc $10,x
	inx
	iny
	jmp ($1234,x)
	jmp ($1234)
	jmp $1234
	jsr ($1234,x)
	jsr $1234
	lda x
	lda y
	lda d
	lda #$12
	lda $1234
	lda $10
	lda $1234,x
	lda $10,x
	lda ($10,x)
	lda $10,s
	lda ($10,s),y
	lda $1234,y
	lda ($10),y
	lda ($10)
	lda ($10,r),y
	lda $10,r
	ldx a
	ldx y
	ldx s
	ldx r
	ldx i
	ldx #$12
	ldx $1234
	ldx $10
	ldx $1234,y
	ldx $10,y
	ldy a
	ldy x
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
	mmu #$12
	mul $1234
	mul $10
	mul $1234,x
	mul $10,x
	nop
	nxa
	nxt
	ora #$12
	ora $1234
	ora $10
	ora $1234,x
	ora $10,x
	ora ($10,x)
	ora $10,s
	ora ($10,s),y
	ora $1234,y
	ora ($10),y
	ora ($10)
	ora ($10,r),y
	ora $10,r
	pea #$12
	pea $1234
	pei $10
	pei ($10)
-
	per -
	pha
	phd
	php
	phx
	phy
	pla
	pld
	plp
	plx
	ply
	psh a
	psh x
	psh y
	psh d
	psh p
	psh #$12
	psh $10
	pul a
	pul x
	pul y
	pul d
	pul p
	rea #$12
	rea $1234
	rei $10
	rei ($10)
	rep #$12
-
	rer -
	rha
	rhi
	rhx
	rhy
	rla
	rli
	rlx
	rly
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
	rsh a
	rsh x
	rsh y
	rsh i
	rsh #$12
	rsh $10
	rti
	rts
	rul a
	rul x
	rul y
	rul i
	sbc #$12
	sbc $1234
	sbc $10
	sbc $1234,x
	sbc $10,x
	sbc ($10,x)
	sbc $10,s
	sbc ($10,s),y
	sbc $1234,y
	sbc ($10),y
	sbc ($10)
	sbc ($10,r),y
	sbc $10,r
	sea
	sec
	sed
	sei
	sep #$12
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
	sta $10,s
	sta ($10,s),y
	sta $1234,y
	sta ($10),y
	sta ($10)
	sta ($10,r),y
	sta $10,r
	stp
	stx s
	stx $1234
	stx $10
	stx $10,y
	sty $1234
	sty $10
	sty $10,x
	stz $1234
	stz $10
	stz $1234,x
	stz $10,x
	swa
	tad
	tax
	tay
	tda
	tix
	trb $1234
	trb $10
	trx
	tsb $1234
	tsb $10
	tsx
	txa
	txi
	txr
	txs
	txy
	tya
	tyx
	wai
	xba
	xce
	zea
