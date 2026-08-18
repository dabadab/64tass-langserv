# 64tass Language Support

VS Code language support for the [64tass](http://tass64.sourceforge.net/) cross assembler for the MOS 6502 family of processors.

## Features

- **Syntax Highlighting** - Full syntax highlighting for 64tass assembly including:
  - Standard and undocumented 6502 opcodes
  - All compiler directives
  - Numbers (decimal, hex `$`, binary `%`)
  - Immediate mode values (`#`)
  - Labels and registers
  - Strings and comments

- **Go to Definition** (F12) - Navigate to label and symbol definitions
  - Supports scoped labels within `.proc`, `.block`, `.macro`, `.function`, `.struct`, `.union`, and `.namespace`
  - Works across files via `.include` directives
  - Click on `.include`, `.binclude` or `.binary` paths to open that file

- **Find All References** (Shift+F12) - Find all usages of a symbol across files

- **Highlight Occurrences** - Other uses of the symbol under the cursor are highlighted

- **Rename Symbol** (F2) - Rename a symbol and all its references
  - Optionally includes occurrences in comments (shown in preview, unchecked by default)

- **Hover Information** - View symbol values and scope information on hover
  - Numeric values displayed in binary, decimal, and hexadecimal
  - Shows associated comments from block definitions

- **Document Outline** (Ctrl+Shift+O) - Outline view and breadcrumbs, with symbols
  nested by scope and local `_name` symbols grouped under their code label

- **Workspace Symbol Search** (Ctrl+T) - Find any symbol across the project by
  fuzzy name, including files you have not opened

- **Signature Help** - Parameter hints while typing a macro or function call
  (`#mac a, b`, `.mac a, b` and `fn(a, b)`)

- **Code Folding** - Fold blocks like `.proc`/`.pend`, `.macro`/`.endm`, `.if`/`.endif`, etc.

- **Diagnostics** - Real-time error detection:
  - Duplicate label definitions
  - Unclosed blocks
  - Undefined symbols and macros

## Configuration

- **`64tass.caseSensitive`** (default: `false`) - matches 64tass's `-C` command-line
  flag. When disabled (default), symbol names are matched case-insensitively; when
  enabled, `MyLabel`, `mylabel`, and `MYLABEL` are distinct symbols.

  This can also be overridden per file with a pragma comment, for cases where
  different projects/compilation units in the same workspace need different
  settings without changing the workspace-wide setting:
  ```
  ; 64tass-langserv: case-sensitive
  ; 64tass-langserv: case-insensitive
  ```
  The pragma is recognized in a file that is itself the entry point of a build
  (i.e. not reached via `.include` from elsewhere in the workspace) and applies to
  that file and everything it `.include`s, overriding the workspace setting for
  that whole compilation unit. It's a plain comment as far as 64tass itself is
  concerned - it only affects how this extension reads the file, not what the
  real compiler does, so keep `-C` in sync with it yourself if you use it.

- **Defining build-time symbols** - mirrors 64tass's `-D label=value` flag, for
  symbols your build supplies on the command line and which therefore appear
  nowhere in the source:
  ```
  ; 64tass-langserv: define linking = 0
  ; 64tass-langserv: define below_io = $01
  ```
  This is most useful for deciding which `.if` branches are dead (see below).
  Like the case-sensitivity pragma it is an ordinary comment to the assembler, so
  keep it in sync with the `-D` flags of your real build.

### Conditional blocks

Symbols referenced in a `.if` branch that provably cannot be taken are not
reported as undefined, matching the assembler, which never evaluates those
branches. A branch is only treated as dead when its condition can be decided
statically - numeric literals, symbols with known constant values, `!`, `&&`,
`||`, the comparisons `=` `==` `!=` `<` `>` `<=` `>=`, arithmetic and
parentheses. Anything undecidable (an unresolvable flag, the program counter
`*`) leaves every branch reported as normal, so nothing is hidden by guesswork.

If a condition depends on a flag your build passes with `-D`, add the matching
`define` pragma above and the branch can then be decided.

## Known Issues

- **Color swatch on `#`-prefixed values** (e.g. `cpx #250`) - VS Code's own built-in
  color decorator sometimes mistakes a hex-digit-looking immediate operand for a
  CSS color and draws a swatch/picker over it. This is a VS Code core behavior,
  not something this extension controls or can suppress. If it bothers you, add
  this to your workspace or user `settings.json`:
  ```json
  "[64tass]": {
      "editor.colorDecorators": false
  }
  ```

## Supported File Extensions

- `.asm`
- `.s`
- `.inc`
- `.src`

## Installation

### From VS Code Marketplace

Install directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=dabadab.64tass-langserv) or search for "64tass Language Support" in the Extensions view (Ctrl+Shift+X).

### From Releases

Download the latest `.vsix` file from [Releases](https://github.com/dabadab/64tass-langserv/releases) and install it in VS Code:
- Open VS Code
- Go to Extensions (Ctrl+Shift+X)
- Click the `...` menu and select "Install from VSIX..."

### From Source

1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
4. Press F5 to launch the Extension Development Host

## License

MIT
