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
  - Click on `.include` paths to open the included file

- **Find All References** (Shift+F12) - Find all usages of a symbol across files

- **Rename Symbol** (F2) - Rename a symbol and all its references
  - Optionally includes occurrences in comments (shown in preview, unchecked by default)

- **Hover Information** - View symbol values and scope information on hover
  - Numeric values displayed in binary, decimal, and hexadecimal
  - Shows associated comments from block definitions

- **Code Folding** - Fold blocks like `.proc`/`.pend`, `.macro`/`.endm`, `.if`/`.endif`, etc.

- **Diagnostics** - Real-time error detection:
  - Duplicate label definitions
  - Unclosed blocks
  - Undefined symbols and macros

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
