; Deliberately BROKEN - the one fixture here that must not assemble.
; Used by test/integration/assembler.test.ts to check that a real 64tass run is
; parsed back into diagnostics, including one in an included file.
        *= $1000
        .include "sub.inc"
start   lda #$1234
        rts
