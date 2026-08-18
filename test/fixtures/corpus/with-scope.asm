; `.with` makes a scope's members visible unqualified. Verified: assembles cleanly.
        * = $1000

scope   .block
bar     .byte 1
baz     .byte 2
        .bend

outer   .block
inner   .block
deep    .byte 3
        .bend
        .bend

        .with scope
        lda bar
        lda baz
        lda scope.bar
        .endwith

        .with outer
        .with inner
        lda deep
        .endwith
        .endwith

        rts
