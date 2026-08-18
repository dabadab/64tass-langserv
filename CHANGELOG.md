# Changelog

All notable changes to the 64tass Language Support extension will be documented in this file.

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

