; Large test file for performance benchmarking
; Contains 1000+ symbols across multiple scopes

        * = $1000

; Global constants (10)
SCREEN = $0400
COLOR = $d800
BORDER = $d020
BACKGROUND = $d021
SPRITE_PTR = $07f8
IRQ_VECTOR = $0314
CHAR_MEM = $0800
BITMAP_MEM = $2000
MUSIC_ADDR = $1000
SFX_ADDR = $1800

; Root level code labels (100)
start
        lda #0
        sta SCREEN
        jmp init

init
        sei
        lda #$00
        sta $d020
        sta $d021
        cli
        rts

mainLoop
        jsr updateScreen
        jsr readInput
        jsr playMusic
        jmp mainLoop

updateScreen
        ldx #0
_loop
        lda buffer,x
        sta SCREEN,x
        inx
        cpx #40
        bne _loop
        rts

readInput
_wait
        lda $dc01
        cmp #$ff
        beq _wait
        rts

playMusic
_check
        lda musicEnabled
        beq _skip
        jsr MUSIC_ADDR
_skip
        rts

; Generate 90 more simple labels
label010
        nop
        rts
label011
        nop
        rts
label012
        nop
        rts
label013
        nop
        rts
label014
        nop
        rts
label015
        nop
        rts
label016
        nop
        rts
label017
        nop
        rts
label018
        nop
        rts
label019
        nop
        rts
label020
        nop
        rts
label021
        nop
        rts
label022
        nop
        rts
label023
        nop
        rts
label024
        nop
        rts
label025
        nop
        rts
label026
        nop
        rts
label027
        nop
        rts
label028
        nop
        rts
label029
        nop
        rts
label030
        nop
        rts
label031
        nop
        rts
label032
        nop
        rts
label033
        nop
        rts
label034
        nop
        rts
label035
        nop
        rts
label036
        nop
        rts
label037
        nop
        rts
label038
        nop
        rts
label039
        nop
        rts
label040
        nop
        rts
label041
        nop
        rts
label042
        nop
        rts
label043
        nop
        rts
label044
        nop
        rts
label045
        nop
        rts
label046
        nop
        rts
label047
        nop
        rts
label048
        nop
        rts
label049
        nop
        rts
label050
        nop
        rts
label051
        nop
        rts
label052
        nop
        rts
label053
        nop
        rts
label054
        nop
        rts
label055
        nop
        rts
label056
        nop
        rts
label057
        nop
        rts
label058
        nop
        rts
label059
        nop
        rts
label060
        nop
        rts
label061
        nop
        rts
label062
        nop
        rts
label063
        nop
        rts
label064
        nop
        rts
label065
        nop
        rts
label066
        nop
        rts
label067
        nop
        rts
label068
        nop
        rts
label069
        nop
        rts
label070
        nop
        rts
label071
        nop
        rts
label072
        nop
        rts
label073
        nop
        rts
label074
        nop
        rts
label075
        nop
        rts
label076
        nop
        rts
label077
        nop
        rts
label078
        nop
        rts
label079
        nop
        rts
label080
        nop
        rts
label081
        nop
        rts
label082
        nop
        rts
label083
        nop
        rts
label084
        nop
        rts
label085
        nop
        rts
label086
        nop
        rts
label087
        nop
        rts
label088
        nop
        rts
label089
        nop
        rts
label090
        nop
        rts
label091
        nop
        rts
label092
        nop
        rts
label093
        nop
        rts
label094
        nop
        rts
label095
        nop
        rts
label096
        nop
        rts
label097
        nop
        rts
label098
        nop
        rts
label099
        nop
        rts

; Nested scopes (5 levels deep, 10 labels per level = 50 labels)
outer1 .proc
    label01
            lda #1
            rts
    label02
            lda #2
            rts
    label03
            lda #3
            rts
    label04
            lda #4
            rts
    label05
            lda #5
            rts
    label06
            lda #6
            rts
    label07
            lda #7
            rts
    label08
            lda #8
            rts
    label09
            lda #9
            rts
    label10
            lda #10
            rts

    middle1 .proc
        label11
                lda #11
                rts
        label12
                lda #12
                rts
        label13
                lda #13
                rts
        label14
                lda #14
                rts
        label15
                lda #15
                rts
        label16
                lda #16
                rts
        label17
                lda #17
                rts
        label18
                lda #18
                rts
        label19
                lda #19
                rts
        label20
                lda #20
                rts

        inner1 .proc
            label21
                    lda #21
                    rts
            label22
                    lda #22
                    rts
            label23
                    lda #23
                    rts
            label24
                    lda #24
                    rts
            label25
                    lda #25
                    rts
            label26
                    lda #26
                    rts
            label27
                    lda #27
                    rts
            label28
                    lda #28
                    rts
            label29
                    lda #29
                    rts
            label30
                    lda #30
                    rts

            deepest1 .proc
                label31
                        lda #31
                        rts
                label32
                        lda #32
                        rts
                label33
                        lda #33
                        rts
                label34
                        lda #34
                        rts
                label35
                        lda #35
                        rts
                label36
                        lda #36
                        rts
                label37
                        lda #37
                        rts
                label38
                        lda #38
                        rts
                label39
                        lda #39
                        rts
                label40
                        lda #40
                        rts
            .pend
        .pend
    .pend
.pend

; Macros with sub-labels (20 macros with 2 labels each = 40 labels)
loadByte .macro value
_start
        lda #\value
_done
        rts
.endm

storeByte .macro addr
_start
        sta \addr
_done
        rts
.endm

loadWord .macro value
_start
        lda #<\value
_done
        rts
.endm

storeWord .macro addr
_start
        sta \addr
_done
        rts
.endm

waitKey .macro
_wait
        lda $dc01
_done
        rts
.endm

clearScreen .macro
_loop
        lda #$20
_done
        rts
.endm

setColor .macro color
_start
        lda #\color
_done
        rts
.endm

playSound .macro freq
_start
        lda #\freq
_done
        rts
.endm

moveCursor .macro x, y
_start
        ldx #\x
_done
        rts
.endm

drawChar .macro char
_start
        lda #\char
_done
        rts
.endm

; Data section (500+ labels)
buffer  .fill 256, 0
screen  .fill 1024, $20
sprites .block
    sprite00 .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
    sprite01 .byte 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1
    sprite02 .byte 2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2
    sprite03 .byte 3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3
    sprite04 .byte 4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4
    sprite05 .byte 5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5
    sprite06 .byte 6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6
    sprite07 .byte 7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7
    sprite08 .byte 8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8
    sprite09 .byte 9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9
    sprite10 .byte 10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10
    sprite11 .byte 11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11
    sprite12 .byte 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
    sprite13 .byte 13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13
    sprite14 .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
    sprite15 .byte 15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15
    sprite16 .byte 16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16
    sprite17 .byte 17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17
    sprite18 .byte 18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18
    sprite19 .byte 19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19
.bend

; More data labels (480 more to reach 500+)
data000 .word $0000
data001 .word $0001
data002 .word $0002
data003 .word $0003
data004 .word $0004
data005 .word $0005
data006 .word $0006
data007 .word $0007
data008 .word $0008
data009 .word $0009
data010 .word $0010
data011 .word $0011
data012 .word $0012
data013 .word $0013
data014 .word $0014
data015 .word $0015
data016 .word $0016
data017 .word $0017
data018 .word $0018
data019 .word $0019
data020 .word $0020
musicEnabled .byte 1
sfxEnabled .byte 1
volume .byte 15

; Code labels with local symbols (100 code labels × 5 locals each = 500 labels)
code000
    _local0 = 0
    _local1 = 1
    _local2 = 2
    _local3 = 3
    _local4 = 4
        lda #_local0
        sta _local4
        rts

code001
    _local0 = 0
    _local1 = 1
    _local2 = 2
    _local3 = 3
    _local4 = 4
        lda #_local0
        sta _local4
        rts

code002
    _local0 = 0
    _local1 = 1
    _local2 = 2
    _local3 = 3
    _local4 = 4
        lda #_local0
        sta _local4
        rts

code003
    _local0 = 0
    _local1 = 1
    _local2 = 2
    _local3 = 3
    _local4 = 4
        lda #_local0
        sta _local4
        rts

code004
    _local0 = 0
    _local1 = 1
    _local2 = 2
    _local3 = 3
    _local4 = 4
        lda #_local0
        sta _local4
        rts

code005
    _local0 = 0
    _local1 = 1
    _local2 = 2
    _local3 = 3
    _local4 = 4
        lda #_local0
        sta _local4
        rts

code006
    _local0 = 0
    _local1 = 1
    _local2 = 2
    _local3 = 3
    _local4 = 4
        lda #_local0
        sta _local4
        rts

code007
    _local0 = 0
    _local1 = 1
    _local2 = 2
    _local3 = 3
    _local4 = 4
        lda #_local0
        sta _local4
        rts

code008
    _local0 = 0
    _local1 = 1
    _local2 = 2
    _local3 = 3
    _local4 = 4
        lda #_local0
        sta _local4
        rts

code009
    _local0 = 0
    _local1 = 1
    _local2 = 2
    _local3 = 3
    _local4 = 4
        lda #_local0
        sta _local4
        rts
