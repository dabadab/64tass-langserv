# Changelog

All notable changes to the 64tass Language Support extension will be documented in this file.

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

