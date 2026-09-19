# Changelog

All notable changes to the 64tass Language Support extension will be documented in this file.

## [Unreleased]

## [0.14.0] - 2026-09-20

### Improved
- **Capitals Under Case Sensitivity** - with `64tass.caseSensitive` on, 64tass matches
  instruction and directive names exactly and has no capitalised ones, so `LDA #1` and
  `.BYTE 1` do not assemble. Both are now reported, with a quick fix that lowercases the
  word. Only where the name cannot be a label instead: a lone `RTS`, `LDA = 5` and
  `LDA .byte 1` all assemble and stay silent
- **Unclosed Brackets** - nothing continues a line in this language, a trailing backslash
  included, so a tuple, list or dict split across two lines is an error. The bracket left
  open is now reported where it opened

### Fixed
- **Files With CRLF Line Endings** - every line kept its carriage return, which no
  pattern anchored at the end of a line could match. `.if`/`.else`/`.fi` chains were not
  recognised at all, so labels in the two halves collided as duplicates and branches that
  are never assembled were checked as live code - 28 wrong reports in one real project
- **Unnamed `.struct` And `.union`** - their members belong to the scope around them, as
  the zeropage-layout idiom depends on; they were hidden as an unnamed `.block`'s are, so
  89 fields of one project read as undefined
- **Local Symbols After A Bare Macro Call** - `PTR_ADD ptr, offset` was taken for a label
  definition and re-anchored the `_local`s after it, so references to them from above the
  call read as undefined. The no-argument form had this since before 0.13.0, the form
  with arguments since 0.13.0

## [0.13.0] - 2026-09-19

### Added
- **Benchmark Harness** - `yarn bench` measures the built server over LSP, the way the
  editor uses it: startup, workspace scan, open and edit to diagnostics, every request
  kind, and memory. `yarn bench:history` measures past releases in git worktrees so a
  series can be reproduced on new hardware, `yarn bench:report` tabulates them and
  `yarn bench:compare --baseline vX.Y.Z` fails on a regression before a tag. Records
  live in `bench/results.jsonl`, per machine and workload, written only on `--save`

### Improved
- **Undefined `#mac` Calls** - are reported too; only the `.mac` spelling was checked
- **Renames That Break The Source Are Refused** - with a reason rather than applied: an
  instruction mnemonic (a label called `lda` is read as the instruction), a leading
  underscore gained or lost (`_name` is local to the nearest code label), and a name that
  already resolves where the definition sits

### Fixed
- **Labels In `.bfor`, `.brept` And `.bwhile`** - the body is a scope of its own, so a
  label inside one no longer collides with a same-named label outside it
- **Labels In Different `.case` Branches** - were reported as duplicates, though a
  `.switch` assembles at most one of them
- **`.if` On A Reassigned Variable** - `v .var 1` then `v .var 2` decided the branch from
  the first value, greying out the branch that is actually assembled and reporting symbols
  in the one that is not
- **Integer Division** - `-7 / 2` is -4: 64tass floors where the evaluator truncated
- **Checks Inside A Dead Branch** - an unsupported mnemonic, an oversized immediate and a
  shape with no addressing mode were reported in code that is never assembled
- **`lbl mac 5`** - a label in front of an unprefixed macro call was not indexed at all,
  so every reference to it read as undefined
- **`.for i := 0, ...`** - the `:=` spelling defined no loop variable, leaving every use
  of `i` undefined, the loop header included
- **`v += 1`** - and `v*=2`, `v<<=1`, `v..=[1]`: the operator was read as part of the name
  and reported as a character that cannot be in one
- **Lines Ending In Spaces** - `jsr foo  ` was not checked at all, its operand having been
  read as the mnemonic
- **Index Registers Inside A String** - `lda #"a,` offered `x` and `y` after a comma that
  is text
- **Unused `.function`** - was called a label; `-Wunused` calls it a macro
- **Include Edges And Directory Order** - a file included by several roots was attributed
  to whichever the scan reached first, so which program an include belonged to - and the
  symbols it could see - depended on the order directories were walked

### Removed
- **Per-Test-Run Timing Log** - `test/performance-results.jsonl` was appended to on every
  `yarn test`, mostly from dirty trees, and `src/server/performance.ts` was used by
  nothing else. The scaling property test moved to `symbols.test.ts`

## [0.12.0] - 2026-09-06

### Added
- **Parameters On Hover** - hovering a macro or function shows the parameters it declares,
  as written: casing, `: type` and `= default` included
- **Signature Help While Typing A Call** - the parameter you are on is shown in bold, from
  the space after the name onwards, in all four call forms 64tass accepts (`#mac a, b`,
  `.mac a, b`, a bare `mac a, b` and `fn(a, b)`). The popup follows the form you are
  writing, so a `.function` invoked as a statement is shown as one

### Improved
- **More Symbols Checked** - the arguments of a macro or function call, and the operands of
  `.if`, `.for`, `.rept`, `.align`, `.check`, `.logical`, `.cerror` and `*=`. Arguments the
  callee never reads are left alone, as 64tass only works one out where the body asks for it
- **Addressing Width** - `sty $c000,x` is reported: the shape is right and the width is
  not, since sty has no absolute,x form
- **CPU-Dependent Checks** - are judged against the target in force rather than only a
  declared one. A file for a wider CPU should say so with `64tass.cpu`, a `.cpu` directive
  or the pragma, or it is read as `6502i`
- **Performance** - unused-symbol hints no longer re-read and re-scan every file of the
  compilation unit on each pause in typing

### Fixed
- **Rename Corrupted Source** - three ways: `jsr scope.name` counted as a use of a
  top-level `name` and was rewritten with it; a local whose name has a capital had its
  definition renamed and none of its uses; and a name inside a string literal was edited
  like code
- **`.comment` Blocks Were Read As Code** - prose saying ".if 0" greyed out the rest of the
  file and suppressed its errors, `.comment`/`.endc` were honoured mid-sentence, an opener
  written in one was folded against a real closer, and a name mentioned in one counted as
  a use
- **Includes Nobody Opened** - the workspace scan recorded no include edges, so an include
  opened on its own reported its parent's symbols as undefined
- **No-Argument Macro Calls** - a bare `inc_d020` was indexed as a label, colliding with
  the macro it calls; 44 false duplicate errors disappeared from one real project
- **`sty ($100)/2,x`** - the address was read as `$100`, so a line the assembler takes was
  reported as an error
- **`.with`** - `lbl:.with sc` opened no scope, and a label on such a line was never indexed
- **`nop: #mac`** - a colon settles label-vs-instruction, as it does everywhere else
- **Cycle Counts** - a line starting with an anonymous label (`-  inx`) got none
- **`foo == 1`** - was indexed as a constant, for a line the assembler rejects
- **File Paths In Comments** - `nop ; see .include "b.asm"` became a document link and a
  go-to-definition target
- **Signature Help In A Scope** - a macro or function defined inside a `.proc` never got a
  popup
- **Unused Symbols** - a symbol used by the file's parent could be greyed out

## [0.11.0] - 2026-08-25

### Added
- **Real Assembler Diagnostics** - set `64tass.assemblerPath` to the 64tass binary to get
  additional diagnostics from real assembler runs.
- **Which File To Assemble** - a `; 64tass-langserv: root ../main.asm` pragma says which
  program an include belongs to. Without it, saving assembles every root that includes the
  file - a header shared by two programs is part of both builds - or the file itself when
  nothing does
- **Formatting** - Format Document aligns label, mnemonic, operand and comment to
  configurable columns (`64tass.format.mnemonicColumn`, `operandColumn`, `commentColumn`,
  defaulting to 8, 12 and 40).
- **Cycle Counts** - `64tass.cycleCounts` shows each instruction's cycles in a column of
  its own. 65xx only.
- **Unused Symbols** - unused symbols are greyed. On by default;
  `64tass.unusedSymbols` turns it off
- **Inactive Code** - Inactive code (disabled by `.if` and similar directives) are
  greyed out.
- **Pragma Help** - typing `; 64t` completes the pragma prefix, then the pragma names,
  then the values each one takes; hovering a pragma line says what it does. Ordinary
  comments raise no popup - the prefix has to be under way first
- **Directive Help** - hovering `.byte`, `.proc`, `.for` and the rest shows the syntax and
  description from the 64tass reference manual, quoted rather than rewritten. All 132
  directives the extension knows are covered

### Improved
- **Better error reporting** - Mnemonics from wrong CPUs, wrong indexed addressing modes,
  oversized immediates are reported now.
- **Duplicate Labels Across Includes** - a name defined both in a file and in something it
  `.include`s is now reported.

## [0.10.3] - 2026-08-20

### Improved
- **Hover and completion info** - comments shown for various things, scope open location for scope closers

## [0.10.2] - 2026-08-20

### Added
- **Editor Defaults** - `.asm` files now get `editor.acceptSuggestionOnEnter: "smart"`,
  so Enter accepts a suggestion only when that would actually change the text. Typing a
  symbol in full and pressing Enter opens the next line instead of the completion popup
  swallowing the keypress; Tab still accepts. Overridable in your own `settings.json`

### Fixed
- **Invalid Symbol Names Went Unreported** - a name may contain only letters, numbers and
  underscores, and anything else ends it rather than belonging to it: `CODE_£ = $30`
  defines `CODE_` and then fails, so a run of such lines silently redefines the same
  truncated name. These are now reported, where before the file simply would not assemble
  with no hint why
- **Mnemonics From Other CPUs Were Suggested** - the completion list came from the union
  of every target, so a `6502` file was offered `bra`, `brl`, `bbr` and other instructions
  it cannot assemble. It now follows the file's CPU
- **Completion After a Dot** - typing `scope.` listed the symbols visible at the cursor,
  none of which can follow a dot. It now offers that scope's members, resolving the scope
  the same way go-to-definition does - so a `.dstruct` instance, and a label standing in
  for a macro's or a function's scope, offer the right members too

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

