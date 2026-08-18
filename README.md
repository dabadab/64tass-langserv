# 64tass Language Support

VS Code language support for the [64tass](http://tass64.sourceforge.net/) cross assembler
for the MOS 6502 family. Handles `.asm`, `.s`, `.inc` and `.src`.

## Features

- **Syntax highlighting** for opcodes (documented and undocumented), directives,
  numbers, strings and labels.
- **Semantic highlighting** on top of it, for what the grammar alone cannot tell
  apart, like a constant from a label
- **Go to definition** (F12) — labels and symbols, scope-aware and across `.include`
  files. Also opens the file under the cursor in an `.include`, `.binclude` or
  `.binary` path.
- **Find all references** (Shift+F12), **highlight occurrences** of the symbol
  under the cursor, and **rename** (F2). Rename can also update occurrences in
  comments — shown separately in the preview, unchecked by default.
- **Outline and breadcrumbs** (Ctrl+Shift+O), nested by scope, with `_local`
  symbols grouped under the code label they belong to.
- **Workspace symbol search** (Ctrl+T) by fuzzy name, including files you have
  not opened.
- **Completion** for directives, opcodes, in-scope symbols, macro and function
  parameters, and filenames for `.include` / `.binclude` / `.binary`.
- **Signature help** while typing a macro or function call — `#mac a, b`,
  `.mac a, b` and `fn(a, b)`.
- **Hover** showing a symbol's scope, its documentation comment, and its value in
  binary, decimal and hexadecimal.
- **Folding** for `.proc`/`.pend`, `.macro`/`.endm`, `.if`/`.endif` and friends.
- **Diagnostics**: duplicate labels, unclosed or unmatched blocks, undefined
  symbols and macros, unresolvable anonymous label references, and missing
  operators between values.

## Settings

### `64tass.caseSensitive`

Default `false`. Mirrors 64tass's `-C` flag: when `true`, `MyLabel` and `mylabel` are distinct symbols.

### `64tass.cpu`

Default `6502`. Decides which opcodes and register addressing modes are
recognised, mirroring 64tass's CPU selection flags. Accepts the same names as the
`.cpu` directive: `default`, `6502`, `65c02`, `65ce02`, `65dtv02`, `65el02`,
`65816`, `r65c02`, `w65c02`, `4510`, `45gs02`.

There is no `6510`: the C64 CPU is `6502`, the NMOS set that includes the
undocumented opcodes. This matters more than it looks - label detection keys off
the opcode table, so a file whose CPU is wrong indexes to *no labels* and loses
navigation entirely.

A `.cpu "..."` directive in a file is honoured automatically, and overrides the
setting for that file and everything it `.include`s.

## Pragmas

**They are ordinary comments to 64tass** — they change only how
this extension reads your code.

### Case sensitivity

```asm
; 64tass-langserv: case-sensitive
; 64tass-langserv: case-insensitive
```

Overrides `64tass.caseSensitive` for the file it appears in **and everything that
file `.include`s**. Useful when one workspace holds several projects that are
built with different `-C` settings. A nested file may override it again for its
own subtree.

### CPU target

```asm
; 64tass-langserv: cpu 65816
```

For when the target is set on the command line rather than in the source. A
`.cpu "65816"` directive needs no pragma - it is picked up on its own.

### Build-time defines

```asm
; 64tass-langserv: define standalone = 0
; 64tass-langserv: define below_io = $01
```

Acts as `-D label=value` for 64tass, for symbols your build supplies on the command line.

Defining them stops false "undefined symbol" / "duplicate symbol" reports, and lets the extension decide which
`.if` branches are inactive.

## Conditional blocks

Symbols used in a `.if` branch that provably cannot be taken are not reported as undefined:

```asm
; 64tass-langserv: define include_music = 0

        .if include_music = 1
        jsr play_music    ; not reported: this branch is inactive
        .endif
```

## Known issues

**A color picker box may appear on values like `cpx #250`.** VS Code's own color
decorator mistakes a hex-looking immediate operand for a CSS color. This is
built into VS Code and cannot be suppressed by an extension; turn it off for this
language in `settings.json`:

```json
"[64tass]": {
    "editor.colorDecorators": false
}
```

## Installation

Install **64tass Language Support** from the
[Marketplace](https://marketplace.visualstudio.com/items?itemName=dabadab.64tass-langserv),
or download a `.vsix` from [Releases](https://github.com/dabadab/64tass-langserv/releases)
and use *Install from VSIX…* in the Extensions view.

To run from source: `yarn install`, then F5 to launch the Extension Development Host.

## License

MIT
