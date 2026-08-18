# 64tass Language Support

VS Code language support for the [64tass](http://tass64.sourceforge.net/) cross assembler
for the MOS 6502 family. Handles `.asm`, `.s`, `.inc` and `.src`.

## Features

- **Syntax highlighting** for opcodes (documented and undocumented), directives,
  numbers, strings and labels.
- **Semantic highlighting** on top of it, for what the grammar alone cannot tell
  apart: a builtin directive from a call to your own macro, and a constant from a
  label, a scope or a macro parameter.
- **Go to definition** (F12) — labels and symbols, scope-aware (`.proc`, `.block`,
  `.macro`, `.function`, `.struct`, `.union`, `.namespace`) and across `.include`
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
  parameters, and filenames inside `.include` / `.binclude` / `.binary`.
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

Default `false`. Mirrors 64tass's `-C` flag: when off, symbol names match
case-insensitively; when on, `MyLabel` and `mylabel` are distinct symbols.

## Pragmas

Two comment pragmas let a file describe how it is built, for cases the settings
cannot express. **Both are ordinary comments to 64tass** — they change only how
this extension reads your code, never what the assembler does, so keep them in
sync with the flags your build actually passes.

### Case sensitivity

```asm
; 64tass-langserv: case-sensitive
; 64tass-langserv: case-insensitive
```

Overrides `64tass.caseSensitive` for the file it appears in **and everything that
file `.include`s**. Useful when one workspace holds several projects that are
built with different `-C` settings. A nested file may override it again for its
own subtree.

### Build-time defines

```asm
; 64tass-langserv: define linking = 0
; 64tass-langserv: define below_io = $01
```

Mirrors `-D label=value`, for symbols your build supplies on the command line and
which therefore appear nowhere in the source. Defining them stops false
"undefined symbol" reports, and — more usefully — lets the extension decide which
`.if` branches are dead.

## Conditional blocks

Symbols used in a `.if` branch that provably cannot be taken are not reported as
undefined, matching the assembler, which never evaluates those branches:

```asm
; 64tass-langserv: define linking = 0

        .if linking = 1
        jsr link_load_next    ; not reported: this branch is dead
        .endif
```

A branch counts as dead only when its condition can be decided statically —
numeric literals, symbols with known constant values, `!`, `&&`, `||`, the
comparisons `=` `==` `!=` `<` `>` `<=` `>=`, arithmetic and parentheses. Anything
undecidable, such as an unresolvable flag or the program counter `*`, leaves every
branch reported as usual, so nothing is hidden by guesswork.

## Known issues

**A colour swatch appears on values like `cpx #250`.** VS Code's own colour
decorator mistakes a hex-looking immediate operand for a CSS colour. This is
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
