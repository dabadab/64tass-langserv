# 64tass Language Support

VS Code language support for the [64tass](http://tass64.sourceforge.net/) cross assembler
for the MOS 6502 family. Handles `.asm`, `.s`, `.inc` and `.src`.

## Features

- **Syntax highlighting** for opcodes (documented and undocumented), directives,
  numbers, strings and labels.
- **Semantic highlighting** on top of it, for what the grammar alone cannot tell
  apart, like a constant from a label.
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
- **Completion** for mostly everything.
- **Signature help** while typing a macro or function call — `#mac a, b`,
  `.mac a, b` and `fn(a, b)`.
- **Hover** on symbols and mnemonics
- **Document links** on the quoted paths of `.include`, `.binclude` and
  `.binary` — ctrl-click to open. Only paths that actually resolve become links,
  so a broken one is visible as plain text.
- **Quick fixes** for a misspelled symbol or macro name (suggesting the closest
  visible label) and for a block that was never closed.
- **Expand selection** (<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>→</kbd>) stepping
  out through word, operand, operand list, line, each enclosing block, document.
- **Folding** for `.proc`/`.pend`, `.macro`/`.endm`, `.if`/`.endif` and friends.
- **Diagnostics** for various problems.

## Settings

### `64tass.caseSensitive`

Default `false`. Mirrors 64tass's `-C` flag: when `true`, `MyLabel` and `mylabel` are distinct symbols.

### `64tass.cpu`

The default is `6502i` that includes all the "illegal" opcodes.

Decides which opcodes and register addressing modes are
recognised, mirroring 64tass's CPU selection flags. Accepts the same names as the
`.cpu` directive: `default`, `6502`, `6502i`, `65c02`, `65ce02`, `65dtv02`,
`65el02`, `65816`, `r65c02`, `w65c02`, `4510`, `45gs02`.


A `.cpu "..."` directive in a file is honoured automatically, and overrides the
setting for that file and everything it `.include`s.

### `64tass.includePaths`

Extra directories to search for `.include` and `.binclude` files, mirroring
64tass's `-I` flag. The including file's own directory is always tried first;
these are searched after it, in order. Relative paths are taken against the
workspace root.

```json
"64tass.includePaths": ["libs", "../shared/asm"]
```

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
        jsr music.play    ; not reported: this branch is inactive
        .endif
```

## Known issues

**A function that returns a label with members attached to it loses those
members.** A `.function` can hand back a namespace in two ways, and only one of
them is tracked.

This one works — `namespace(*)` returns the function's *own* scope, so its
top-level labels become the members:

```asm
split   .function _v
LOW     = _v & $ff              ; a label of the function itself
HIGH    = _v >> 8
        .endf namespace(*)      ; hand back this scope

addr    = split($1234)
        lda #addr.LOW           ; resolves, completes, go-to-definition works
```

This one does not — the members are hung on a label inside the function, and
that label is returned instead:

```asm
split   .function _v
_r      .text ""                ; a label...
_r.LOW  = _v & $ff              ; ...with a member attached to it
        .endf _r                ; hand back the label

addr    = split($1234)
        lda #addr.LOW           ; reported as undefined, though it assembles
```

Both assemble. The second is what 64tass's own `loading_a_sid_file` example does,
which is why `music.init` reads as undefined there. Dotted assignments onto a
label are not yet indexed as members of it.

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
