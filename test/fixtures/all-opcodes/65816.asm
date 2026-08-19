; Exhaustive opcode/addressing-mode exercise for CPU "65816"
; Auto-generated from opcodes.c data - one line per addressing mode
	.cpu "65816"
	* = $1000
	adc #$12
	adc $102030
	adc $1234
	adc $10
	adc $102030,x
	adc $1234,x
	adc $10,x
	adc ($10,x)
	adc $10,s
	adc ($10,s),y
	adc $1234,y
	adc ($10),y
	adc ($10)
	adc [$10],y
	adc [$10]
	and #$12
	and $102030
	and $1234
	and $10
	and $102030,x
	and $1234,x
	and $10,x
	and ($10,x)
	and $10,s
	and ($10,s),y
	and $1234,y
	and ($10),y
	and ($10)
	and [$10],y
	and [$10]
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
	brl -
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
	cmp $102030
	cmp $1234
	cmp $10
	cmp $102030,x
	cmp $1234,x
	cmp $10,x
	cmp ($10,x)
	cmp $10,s
	cmp ($10,s),y
	cmp $1234,y
	cmp ($10),y
	cmp ($10)
	cmp [$10],y
	cmp [$10]
	cop
	cop #$12
	cpa #$12
	cpa $102030
	cpa $1234
	cpa $10
	cpa $102030,x
	cpa $1234,x
	cpa $10,x
	cpa ($10,x)
	cpa $10,s
	cpa ($10,s),y
	cpa $1234,y
	cpa ($10),y
	cpa ($10)
	cpa [$10],y
	cpa [$10]
	cpx #$12
	cpx $1234
	cpx $10
	cpy #$12
	cpy $1234
	cpy $10
	csp
	csp #$12
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
	eor #$12
	eor $102030
	eor $1234
	eor $10
	eor $102030,x
	eor $1234,x
	eor $10,x
	eor ($10,x)
	eor $10,s
	eor ($10,s),y
	eor $1234,y
	eor ($10),y
	eor ($10)
	eor [$10],y
	eor [$10]
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
	jml $102030
	jml [$1234]
	jmp ($1234,x)
	jmp [$1234]
	jmp ($1234)
	jmp $1234
	jsl $102030
	jsr ($1234,x)
	jsr $1234
	lda x
	lda y
	lda s
	lda d
	lda #$12
	lda $102030
	lda $1234
	lda $10
	lda $102030,x
	lda $1234,x
	lda $10,x
	lda ($10,x)
	lda $10,s
	lda ($10,s),y
	lda $1234,y
	lda ($10),y
	lda ($10)
	lda [$10],y
	lda [$10]
	ldx a
	ldx y
	ldx s
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
	mvn $12,$34
	mvp $12,$34
	nop
	ora #$12
	ora $102030
	ora $1234
	ora $10
	ora $102030,x
	ora $1234,x
	ora $10,x
	ora ($10,x)
	ora $10,s
	ora ($10,s),y
	ora $1234,y
	ora ($10),y
	ora ($10)
	ora [$10],y
	ora [$10]
	pea #$12
	pea $1234
	pei $10
	pei ($10)
-
	per -
	pha
	phb
	phd
	phk
	php
	phx
	phy
	pla
	plb
	pld
	plp
	plx
	ply
	psh a
	psh x
	psh y
	psh d
	psh b
	psh k
	psh p
	psh #$12
	psh $10
	pul a
	pul x
	pul y
	pul d
	pul b
	pul p
	rep #$12
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
	rtl
	rts
	sbc #$12
	sbc $102030
	sbc $1234
	sbc $10
	sbc $102030,x
	sbc $1234,x
	sbc $10,x
	sbc ($10,x)
	sbc $10,s
	sbc ($10,s),y
	sbc $1234,y
	sbc ($10),y
	sbc ($10)
	sbc [$10],y
	sbc [$10]
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
	sta s
	sta $102030
	sta $1234
	sta $10
	sta $102030,x
	sta $1234,x
	sta $10,x
	sta ($10,x)
	sta $10,s
	sta ($10,s),y
	sta $1234,y
	sta ($10),y
	sta ($10)
	sta [$10],y
	sta [$10]
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
	tas
	tax
	tay
	tcd
	tcs
	tda
	tdc
	trb $1234
	trb $10
	tsa
	tsb $1234
	tsb $10
	tsc
	tsx
	txa
	txs
	txy
	tya
	tyx
	wai
	wdm #$12
	xba
	xce
