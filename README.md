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

- **Go to Definition** (F12) - Navigate to label and symbol definitions with proper scope awareness
  - Supports scoped labels within `.proc`, `.block`, `.macro`, `.function`, `.struct`, `.union`, and `.namespace`
  - Works across files via `.include` directives

- **Hover Information** - View symbol values and scope information on hover

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

### From Source

1. Clone this repository
2. Run `yarn install`
3. Run `yarn compile`
4. Press F5 to launch the Extension Development Host

### Package as VSIX

```bash
yarn package
```

Then install the generated `.vsix` file in VS Code.

## License

MIT
