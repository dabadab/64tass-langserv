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
- **Hover** on symbols and mnemonics, and on a block closer like `.pend` to see
  which scope it ends.
- **Document links** on the quoted paths of `.include`, `.binclude` and
  `.binary` — ctrl-click to open. Only paths that actually resolve become links,
  so a broken one is visible as plain text.
- **Quick fixes** for a misspelled symbol or macro name (suggesting the closest
  visible label) and for a block that was never closed.
- **Expand selection** (<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>→</kbd>) stepping
  out through word, operand, operand list, line, each enclosing block, document.
- **Folding** for `.proc`/`.pend`, `.macro`/`.endm`, `.if`/`.endif` and friends.
- **Diagnostics** for various problems.
- **Inactive code** greyed out - the branches of an `.if` chain the conditions rule out.
- **Directive help** on hover, quoting the 64tass manual.

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

Saying which target you are on also turns on some checks: a mnemonic that belongs
to some other CPU (`bra` on a plain 6502) is reported, as is an addressing mode
that exists elsewhere but not here (`lda $10,s`). A form no CPU has at all
(`lda ($10),x`) is reported either way. Left at the default, that
check stays off — the target can also come from a command-line flag, and guessing
wrong would mean errors on correct code.

### `64tass.includePaths`

Extra directories to search for `.include` and `.binclude` files, mirroring
64tass's `-I` flag. The including file's own directory is always tried first;
these are searched after it, in order. Relative paths are taken against the
workspace root.

```json
"64tass.includePaths": ["libs", "../shared/asm"]
```

### `64tass.unusedSymbols`

Default `true`. Greys out labels, constants and macros nothing in the same
program refers to, the way 64tass's own `-Wunused` reports them. Worth knowing
before you turn it off: a file of shared definitions uses none of its own
symbols, so it fades wholesale.

### `64tass.format.mnemonicColumn` / `operandColumn` / `commentColumn`

Where **Format Document** puts each field: mnemonic at 8, operand at 12, trailing
comment at 40 — the columns the 64tass distribution's own sources use. A field
that overruns its column gets a single space instead.

Formatting only ever changes the whitespace *between* label, mnemonic, operand and
comment. Full-line comments and `.comment` blocks are never touched, and a line it
cannot split confidently is left exactly as it is.

### `64tass.cycleHints`

Default `false`. Shows each instruction's cycle count at the end of its line as
an inlay hint — `4` plainly, `4*` when an indexed access can cross a page, `2**`
for a branch. Only the NMOS targets have timing data, and a line whose addressing
mode cannot be pinned down (`lda elsewhere`, which may be zeropage or absolute)
gets no hint rather than a guessed one.

### `64tass.assemblerPath`

Path to the real `64tass` binary. When set, **saving a file assembles it** and
whatever the assembler says is shown alongside the extension's own checks
(marked `64tass build`). That catches everything the static checks cannot reach —
expression typing, page and bank arithmetic, branch distance — and errors in an
`.include` are shown in that file, not in the one that includes it.

The target CPU, `-C` and `64tass.includePaths` are passed automatically from the
other settings. `64tass.assemblerArgs` adds anything else your build needs.

```json
"64tass.assemblerPath": "/usr/bin/64tass",
"64tass.assemblerArgs": ["-D", "DEBUG=1"]
```

Nothing is written: the run sends its output to the null device, so it cannot
disturb your own build.

## Pragmas

**They are ordinary comments to 64tass** — they change only how
this extension reads your code.

Type `; 64t` and completion offers the prefix, then the pragma names, then the
values each one takes. Hovering a pragma line says what it does.

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

### Which file to assemble

```asm
; 64tass-langserv: root ../main.asm
```

An include usually cannot be assembled on its own. Without this pragma, saving a
file assembles the one root that includes it, or the file itself when nothing
does — or when several unrelated programs do, since guessing there would report
errors about a program you are not editing.

## Editor defaults

The extension ships two language-scoped defaults for `.asm` files. Both are
ordinary settings, so anything in your own `settings.json` wins:

```json
"[64tass]": {
    "editor.colorDecorators": false,
    "editor.acceptSuggestionOnEnter": "smart"
}
```

`colorDecorators` is off because VS Code's built-in colour decorator mistakes a
hex-looking immediate operand such as `cpx #250` for a CSS colour and paints a
colour-picker box on it.

`acceptSuggestionOnEnter` is `smart` so Enter only accepts a suggestion when that
would actually change the text. Type a symbol in full and Enter opens the next
line; type a prefix and Enter still completes it. Tab always accepts.

## Installation

Install **64tass Language Support** from the
[Marketplace](https://marketplace.visualstudio.com/items?itemName=dabadab.64tass-langserv),
or download a `.vsix` from [Releases](https://github.com/dabadab/64tass-langserv/releases)
and use *Install from VSIX…* in the Extensions view.

To run from source: `yarn install`, then F5 to launch the Extension Development Host.

## License

MIT
