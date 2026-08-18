; 65C02-only mnemonics, likewise invisible to the default opcode table
        .cpu "65c02"
        * = $1000

start   stz $0400
        trb $02
        tsb $02
        phx
        phy
        plx
        ply
        inc a
        dec a
loop    bra loop

table   .byte 1, 2, 3
        lda table
        rts
