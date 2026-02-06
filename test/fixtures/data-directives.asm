; Data directives with various operand types
; This file should compile cleanly with 64tass

        * = $1000

bytes   .byte $FF, $00, $AB
words   .word $1234, $5678
longs   .long $123456
strtxt  .text "hello world"
nulls   .null "null-terminated"
shifts  .shift "shifted"
fills   .fill 16, $EA
