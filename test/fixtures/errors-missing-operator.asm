; Test file for missing operator errors
; These should fail with "an operator is expected" error

        * = $1000

; Missing commas in .byte directive
test1   .byte 1 2 3

; Missing operator in .word directive
test2   .word $1000 $2000

; Missing operator in .text directive
test3   .text "hello" "world"
