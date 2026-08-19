# Exhaustive opcode fixtures

One file per CPU target `.cpu` accepts, each exercising every mnemonic and every
distinct addressing form 64tass supports for that chip - including forms that
encode to the same opcode byte (`ror a` and bare `ror`) spelled out separately
rather than deduplicated.

Generated from the addressing-mode tables in 64tass's own `opcodes.c`, and
verified: **all eleven assemble with zero errors and zero warnings** under
64tass 1.60.3243. That makes them ground truth in both directions - every line
here must be recognised, and anything the extension reports on them is a false
positive.

Relative branches use anonymous `-` labels so every instruction stays in range
regardless of file length.

Note `6502` and `6502i` are different targets: `6502` is the documented NMOS set,
`6502i` adds the undocumented opcodes (the `-i` / `--m6502` flag, "NMOS 65xx").
