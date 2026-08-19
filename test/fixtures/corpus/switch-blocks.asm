; .switch / .case / .default, and the nesting of a switch inside a scope.

; 64tass-langserv: define mode = 2

        * = $1000

start
        .switch mode
        .case 1
        lda #$01
        .case 2
        lda #$02
        .case 3, 4
        lda #$03
        .default
        lda #$00
        .endswitch
        rts

outer   .proc
        .switch mode
        .case 2
inner   lda #<target
        rts
        .default
        rts
        .endswitch
target  .byte 0
        .pend

        jsr outer.inner
        lda outer.target
