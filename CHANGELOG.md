# Changelog

All notable changes to the 64tass Language Support extension will be documented in this file.

## [0.10.0] - 2026-08-19

### Added
- **CPU Targets** - Support for all CPU types 64tass does support. Defaults to `6502i`, 65xx with undocumented opcodes
- **Include Search Paths** - New `64tass.includePaths` setting mirroring 64tass's `-I`
  flag, so an include that only resolves through the build command line is no longer
  invisible
- **Opcode Hover** - Hovering a mnemonic shows info about the instruction
- **Document Links** - Ctrl-click the quoted path of an `.include`, `.binclude` or
  `.binary`. Only paths that actually resolve become links, so a broken one stands out
- **Quick Fixes** - Suggests the closest visible label for a misspelled symbol or macro
  name, and offers to close a block that was never closed
- **Expand Selection** - Shift+Alt+Right steps out through word, operand, operand list,
  line, each enclosing block, then the document
- **`.binclude` Scoping** - A `label .binclude "f"` now indexes f into the block scope the
  label opens, so its symbols resolve as `label.sym`

### Improved
- **Completion** - Symbols are offered only from files assembled together with the current
  one, so an unrelated program elsewhere in the workspace no longer pollutes the list.
  After a comma in an operand only the index registers valid for that instruction on that
  CPU are offered, never labels
- **Performance** - Symbol lookup no longer scans every label in the workspace on each
  call, which made it roughly ten times faster on a large project
- **Dynamic Members** - Members now resolve through a label attached to a macro call
  (`virt #drv`), a label assigned from a function returning a namespace (`PIC = mk(5)`),
  and the keys of a dict literal (`D = {.MAP: 1}`)

### Fixed
- **Undocumented Opcodes** - `.cpu "6502"` is the documented set only; the undocumented
  opcodes belong to `6502i`. They were previously attributed to the wrong target
- **Built-in Names** - The list of built-ins was missing every type object (`int`, `bool`,
  `str`, `bytes`, `list`, `dict`, `tuple`, `float`, `bits`, `code`, `gap`, `type`,
  `address`, `register`, `symbol`, `namespace`) and `pi`
- **`.comment` Blocks** - Their contents are no longer indexed or checked; the assembler
  discards them, so a label in there is not defined at all
- **Expressions** - Slices (`d[:2000:2]`), the ternary `?:`, `..`, `==`, `!=`, `<=`, `>=`,
  `&&`, `||`, `**`, `%`, `!` and `~` no longer produce a spurious "operator is expected"
- **`.for` Loops** - The variable of a `.for x in list` loop is now indexed, including the
  multi-variable form and loops sharing a line with an anonymous label
- **Function Parameters** - A parameter written `_data : binary` or `count = 5` now
  resolves inside the function body
- **Compound Assignment** - `_v ..= [x]` is a modification, not a redefinition, so building
  a list up no longer reports duplicate labels
- **Dict Keys** - `{.MAP: 1}` no longer reports its keys as an undefined macro and symbol
- **Register Operands** - `lda x`, `ldx s`, `asl a` and friends are no longer reported as
  undefined symbols; 45GS02's `q` and 65EL02's `i` were missing
- **Unclosed `.logical`** - Now reported; `.here` closes `.logical` only, not `.virtual`
- **`.with` Blocks** - Symbols imported by a `.with` now resolve
- **Struct Instances** - `name .dstruct type` resolves `name.member` against that type
- **Conditional Branches** - Two definitions in mutually exclusive `.if` branches no longer
  count as duplicates
- **Comments** - A semicolon inside a string is no longer treated as starting a comment

## [0.9.2] - 2026-08-18

### Added
- **Document Outline** - Outline view and breadcrumbs (Ctrl+Shift+O), nested by scope,
  with `_local` symbols grouped under the code label they belong to
- **Workspace Symbol Search** - Find any symbol across the project by fuzzy name (Ctrl+T)
- **Signature Help** - Parameter hints while typing a macro or function call
- **Semantic Highlighting** - Distinguishes what the grammar alone cannot
- **Highlight Occurrences** - Other uses of the symbol under the cursor are highlighted
- **Workspace Indexing** - Files are indexed in the background at startup
- **Build-time Define Pragma** - `; 64tass-langserv: define NAME = VALUE` mirrors the `-D`
  flag, for symbols your build supplies on the command line
- **Inactive Branch Detection** - Symbols used in a `.if` branch that provably cannot be taken
  are ignored

### Improved
- **Go to Definition** - Now opens `.binclude` and `.binary` paths, not just `.include`
- **Performance** - Diagnostics are debounced, so a burst of typing no longer triggers a
  validation pass per keystroke. Indexing stays immediate, so completion and go-to-definition
  never see stale data
- **External Changes** - Files edited outside the editor are re-indexed, and editing an
  included file now refreshes the diagnostics of the files that include it

### Fixed
- **Configuration** - Changing `64tass.caseSensitive` now takes effect immediately; it
  previously did nothing until the window was reloaded
- **Included Files** - Closing an included file no longer strips its symbols from files that
  still include it, and includes open with unsaved edits are no longer reverted to their
  saved state when the parent is edited
- **Rename** - Refuses invalid symbol names instead of writing them at every reference
- **`.for` Loop Variables** - Now indexed when the loop itself is labelled (`squarelo .for i = ...`)
- **Undefined Macro** - The reported range now covers the macro name rather than including
  the leading dot

## [0.9.0] - 2026-08-17

### Added
- **Code Completion** - Completion for labels, opcodes, directives and function parameters
- **Case Sensitivity Pragma** - `; 64tass-langserv: case-sensitive` / `case-insensitive` comment
  overrides the `64tass.caseSensitive` setting per compilation unit, cascading into `.include` files

### Improved
- **Parsing accuracy** - Many fixes
- **`.for` Loop Variables** - Loop variables are now indexed as symbols
- **Symbols and renaming** - Various fixes
- **Configuration** - Fixed settings not being loaded before the first requests were served


## [0.8.0] - 2026-02-07

### Added
- **Case Sensitivity Setting** - New `64tass.caseSensitive` setting to enable case-sensitive symbol matching
  - Equivalent to 64tass `-C` command line flag
  - Default: disabled (case-insensitive, matching 64tass default behavior)
  - When enabled, symbols must match exactly: `MyLabel`, `mylabel`, and `MYLABEL` are treated as distinct
  - Index automatically rebuilds when setting changes

### Improved
- **Various bugfixes** - Check git history for details

## [0.7.0] - 2026-02-05

### Added
- **Find All References** - Find all usages of a symbol across files (Shift+F12)
- **Rename Symbol** - Rename a symbol and all its references (F2)
  - Optionally includes occurrences in comments (shown in preview, unchecked by default)

## [0.6.0] - Initial Release

- **Hover documentation** - Shows associated comments from above/below block definitions
- **Numeric value display** - Hover shows values in binary, decimal, and hexadecimal
- **Go to Definition for .include** - Navigate to included files by clicking on the path
- **Go to Definition** - Navigate to symbol definitions (F12)
- **Hover Information** - Display symbol info and values on hover
- **Code Folding** - Fold/unfold code blocks (.proc, .macro, .if, etc.)
- **Diagnostics** - Warnings for undefined symbols and unclosed blocks
- **.include support** - Index symbols from included files
- **Syntax highlighting**
- **Language configuration**

