; Exhaustive opcode/addressing-mode exercise for CPU "45gs02"
; Auto-generated from opcodes.c data - one line per addressing mode
	.cpu "45gs02"
	* = $1000
	adc #$12
	adc $1234
	adc $10
	adc $1234,x
	adc $10,x
	adc ($10,x)
	adc $1234,y
	adc ($10),y
	adc ($10),z
	adc [$10],z
	adq $1234
	adq $10
	adq ($10)
	adq [$10]
	and #$12
	and $1234
	and $10
	and $1234,x
	and $10,x
	and ($10,x)
	and $1234,y
	and ($10),y
	and ($10),z
	and [$10],z
	anq $1234
	anq $10
	anq ($10)
	anq [$10]
	ard q
	ard $10
	ard $10,x
	asd q
	asd $1234
	asd $10
	asd $1234,x
	asd $10,x
	asl a
	asl q
	asl
	asl $1234
	asl $10
	asl $1234,x
	asl $10,x
	asr a
	asr q
	asr
	asr $10
	asr $10,x
	asw $1234
-
	bbr 3,$10,-
-
	bbs 3,$10,-
-
	bcc -
-
	bcc -
-
	bcs -
-
	bcs -
-
	beq -
-
	beq -
-
	bge -
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
	blt -
-
	bmi -
-
	bmi -
-
	bne -
-
	bne -
-
	bpl -
-
	bpl -
-
	bra -
-
	bra -
	brk
	brk #$12
-
	bsr -
	btq $1234
	btq $10
-
	bvc -
-
	bvc -
-
	bvs -
-
	bvs -
	clc
	cld
	cle
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
	cmp ($10),z
	cmp [$10],z
	cpa #$12
	cpa $1234
	cpa $10
	cpa $1234,x
	cpa $10,x
	cpa ($10,x)
	cpa $1234,y
	cpa ($10),y
	cpa ($10),z
	cpa [$10],z
	cpq $1234
	cpq $10
	cpq ($10)
	cpq [$10]
	cpx #$12
	cpx $1234
	cpx $10
	cpy #$12
	cpy $1234
	cpy $10
	cpz #$12
	cpz $1234
	cpz $10
	dea
	dec a
	dec x
	dec y
	dec z
	dec q
	dec $1234
	dec $10
	dec $1234,x
	dec $10,x
	ded q
	ded $1234
	ded $10
	ded $1234,x
	ded $10,x
	deq
	dew $10
	dex
	dey
	dez
	eom
	eoq $1234
	eoq $10
	eoq ($10)
	eoq [$10]
	eor #$12
	eor $1234
	eor $10
	eor $1234,x
	eor $10,x
	eor ($10,x)
	eor $1234,y
	eor ($10),y
	eor ($10),z
	eor [$10],z
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
	ina
	inc a
	inc x
	inc y
	inc z
	inc q
	inc $1234
	inc $10
	inc $1234,x
	inc $10,x
	ind q
	ind $1234
	ind $10
	ind $1234,x
	ind $10,x
	inq
	inw $10
	inx
	iny
	inz
	jmp ($1234,x)
	jmp ($1234)
	jmp $1234
	jsr ($1234,x)
	jsr ($1234)
	jsr $1234
	lda x
	lda y
	lda d
	lda z
	lda #$12
	lda $1234
	lda $10
	lda $1234,x
	lda $10,x
	lda ($10,x)
	lda ($10,s),y
	lda $1234,y
	lda ($10),y
	lda ($10),z
	lda [$10],z
	ldq $1234
	ldq $10
	ldq ($10),z
	ldq [$10],z
	ldx a
	ldx s
	ldx #$12
	ldx $1234
	ldx $10
	ldx $1234,y
	ldx $10,y
	ldy a
	ldy s
	ldy #$12
	ldy $1234
	ldy $10
	ldy $1234,x
	ldy $10,x
	ldz a
	ldz #$12
	ldz $1234
	ldz $1234,x
	lsd q
	lsd $1234
	lsd $10
	lsd $1234,x
	lsd $10,x
	lsr a
	lsr q
	lsr
	lsr $1234
	lsr $10
	lsr $1234,x
	lsr $10,x
	map
	neg a
	neg
	nop
	ora #$12
	ora $1234
	ora $10
	ora $1234,x
	ora $10,x
	ora ($10,x)
	ora $1234,y
	ora ($10),y
	ora ($10),z
	ora [$10],z
	orq $1234
	orq $10
	orq ($10)
	orq [$10]
	pha
	php
	phw #$12
	phw $1234
	phx
	phy
	phz
	pla
	plp
	plx
	ply
	plz
	psh a
	psh x
	psh y
	psh z
	psh p
	psh #$12
	psh $1234
	pul a
	pul x
	pul y
	pul z
	pul p
	rld q
	rld $1234
	rld $10
	rld $1234,x
	rld $10,x
	rlw $1234
	rmb 3,$10
	rol a
	rol q
	rol
	rol $1234
	rol $10
	rol $1234,x
	rol $10,x
	ror a
	ror q
	ror
	ror $1234
	ror $10
	ror $1234,x
	ror $10,x
	row $1234
	rrd q
	rrd $1234
	rrd $10
	rrd $1234,x
	rrd $10,x
	rti
	rtn #$12
	rts
	rts #$12
	sbc #$12
	sbc $1234
	sbc $10
	sbc $1234,x
	sbc $10,x
	sbc ($10,x)
	sbc $1234,y
	sbc ($10),y
	sbc ($10),z
	sbc [$10],z
	sbq $1234
	sbq $10
	sbq ($10)
	sbq [$10]
	sec
	sed
	see
	sei
	shl a
	shl q
	shl
	shl $1234
	shl $10
	shl $1234,x
	shl $10,x
	shr a
	shr q
	shr
	shr $1234
	shr $10
	shr $1234,x
	shr $10,x
	smb 3,$10
	sta d
	sta $1234
	sta $10
	sta $1234,x
	sta $10,x
	sta ($10,x)
	sta ($10,s),y
	sta $1234,y
	sta ($10),y
	sta ($10),z
	sta [$10],z
	stq $1234
	stq $10
	stq ($10)
	stq [$10]
	stx s
	stx $1234
	stx $10
	stx $1234,y
	stx $10,y
	sty s
	sty $1234
	sty $10
	sty $1234,x
	sty $10,x
	stz $1234
	stz $10
	stz $1234,x
	stz $10,x
	tab
	tad
	tax
	tay
	taz
	tba
	tda
	trb $1234
	trb $10
	tsb $1234
	tsb $10
	tsx
	tsy
	txa
	txs
	tya
	tys
	tza
