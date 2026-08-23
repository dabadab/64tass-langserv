# 64tass Language Server

VS Code extension providing language support for the 64tass MOS 6502 macro assembler.

## Project Structure

```
64tass-langserv/
├── src/
│   ├── extension.ts              # VS Code extension client entry point
│   └── server/
│       ├── server.ts             # LSP handler registration and capabilities only
│       ├── types.ts              # Shared interfaces (LabelDefinition, DocumentIndex)
│       ├── constants.ts          # Opcode tables (all 11 CPU targets), directives, builtins
│       ├── utils.ts              # String/comment/numeric helpers, pragma detection
│       ├── blocks.ts             # blockDirectivesOn — the one block-directive scanner
│       ├── parser.ts             # parseDocument — label/scope/macro extraction
│                                 #   (branch ORDER is contractual; see its header)
│       ├── paths.ts              # .include/.binclude path resolution (-I search paths)
│       ├── hover.ts              # Symbol and opcode hover
│       ├── documentLinks.ts      # Clickable .include/.binclude/.binary paths
│       ├── selectionRanges.ts    # Expand-selection hierarchy
│       ├── codeActions.ts        # Quick fixes for spelling and unclosed blocks
│       ├── addressing.ts         # GENERATED addressing modes per CPU (probed from 64tass)
│       ├── opcodeDocs.ts         # Hand-written mnemonic descriptions and flags
│       ├── cycles.ts             # NMOS cycle counts (transcribed, not probed)
│       ├── indexing.ts           # indexDocument — include tree + case-sensitivity cascade
│       ├── includes.ts           # IncludeGraph — which roots pull in which .include files
│       ├── workspace.ts          # collectSourceFiles, findFilePathAt — workspace scan, file paths
│       ├── symbols.ts            # Symbol lookup, occurrences, references, rename
│       ├── diagnostics.ts        # validateDocument — errors and warnings
│       ├── conditions.ts         # evaluateCondition — static .if branch evaluation
│       ├── completions.ts        # getCompletions — directives, opcodes, symbols, paths
│       ├── documentSymbols.ts    # buildDocumentSymbols — outline and breadcrumbs
│       ├── workspaceSymbols.ts   # findWorkspaceSymbols — Ctrl+T symbol search
│       ├── signatureHelp.ts      # getSignatureHelp — macro/function call hints
│       ├── semanticTokens.ts     # buildSemanticTokens — semantic highlighting
│       ├── folding.ts            # computeFoldingRanges — foldable block regions
│       ├── debounce.ts           # Debouncer — collapses rapid diagnostic runs
│       └── performance.ts        # Benchmark instrumentation (not product behaviour)
├── syntaxes/
│   └── 64tass.tmLanguage.json    # TextMate grammar for syntax highlighting
├── language-configuration.json   # Bracket matching, comments, etc.
├── test/
│   ├── unit/                     # Unit tests for each module
│   ├── integration/              # Compiler reference tests
│   ├── fixtures/                 # .asm fixture files
│   └── helpers/                  # Shared test utilities
├── package.json                  # Extension manifest
└── tsconfig.json                 # TypeScript configuration
```

## Architecture

LSP extension with two components:

1. **Client** (`src/extension.ts`): Starts the language server
2. **Server** (`src/server/`): Provides go-to-definition, find references, rename, hover, folding, completion, document/workspace symbols, signature help, semantic tokens and diagnostics

`server.ts` is deliberately thin: LSP handler registration and capability
declaration only. Anything with logic worth testing lives in its own module and is
unit-tested, because `server.ts` calls `createConnection()` at module load and so
cannot be imported from a test.

What `server.ts` itself does get is `test/integration/protocol.test.ts`, which
spawns the built server as a child process and talks LSP to it over stdio, as the
editor does. That covers the wiring - capabilities declared, requests routed,
responses shaped right - which is the only kind of bug that can live in a file
that thin. Note the v8 coverage report still shows `server.ts` at 0%: the code
runs in another process, where the instrumentation cannot see it.

Because those tests run against the *bundle*, `yarn test` compiles first. Testing
a stale `out/server/server.js` would be worse than not testing it at all.

### Key Concepts

- **CPU targets**: `OPCODES` in `constants.ts` is the UNION of mnemonics across all 11
  CPUs 64tass can target, derived by probing the assembler itself rather than written
  by hand. Recognition must not depend on knowing the target, since it can be set by
  `.cpu` or a command-line flag the server cannot see. `opcodesForCpu()` exposes the
  per-CPU breakdown for a future narrowing. Label detection gates on `OPCODES.has()`,
  so a missing mnemonic means a file indexes to *no labels at all*.
- **CPU target**: `DocumentIndex.cpu`, defaulting to `6502i` - the NMOS set with
  the undocumented opcodes, which is what a C64's 6510 is. Deliberately wider
  than 64tass's own default (`--m65xx`, spelled both `default` and `6502`),
  because label detection gates on the opcode table: on too narrow a target a
  line using `lax` indexes to no labels at all. Set by `64tass.cpu`, overridden by a `.cpu "..."`
  directive or a `; 64tass-langserv: cpu <name>` pragma, which cascade into the
  `.include` tree exactly like case sensitivity (`detectCpu` in `utils.ts`).
  Decides `opcodesForCpu()` and `registerModesForCpu()`.
  `DocumentIndex.cpuExplicit` records whether anyone actually SAID so - a `.cpu`
  directive or pragma (cascading like the value itself), or a `64tass.cpu` setting
  holding anything but the default. Diagnostics that would call good code wrong on
  a bad guess gate on it: `findUnsupportedMnemonic` reports `bra` on a 6502 only
  when the target was declared, since it can also come from a flag the server
  never sees. Note the OPERAND of such a line is checked either way - the narrow
  gate used to disable symbol validation for the whole line. Only the FIRST `.cpu` in a
  file is used: 64tass allows switching mid-file, which the index does not model.
  The name -> flag mapping is NOT mechanical, and getting it wrong is the bug the
  all-opcodes fixtures caught: `--m6502` is "NMOS 65xx", which `.cpu` spells
  `6502i`, while `.cpu "6502"` is the documented set selected by `--m65xx` - the
  same target as `default`. `CPU_FLAG` in `test/helpers/compiler.ts` is the one
  authoritative copy of that mapping; generators and comparison tests use it.
- **Register operands**: `REGISTER_MODES`/`INDEX_REGISTERS` in `constants.ts`. 64tass
  accepts a register where an address would go and assembles the matching
  instruction - `lda x` is TXA, `ldx s` is TSX, `asl a` is accumulator mode,
  `psh p` is PHP - plus `,x`/`,y`/`,s` index registers and the `,b`/`,d`/`,k`/`,r`
  addressing-size and bank suffixes. These are not symbol references, so the
  undefined-symbol check skips them. Kept per-opcode rather than as a blanket list
  of short names, so `lda i` is still reported.
- **Block directives**: `blockDirectivesOn` (`blocks.ts`) is the ONE place that
  decides which openers and closers a line carries; the parser, the unclosed-block
  check in `diagnostics.ts` and `folding.ts` all consume it. They used to have
  three separate implementations, and the parser's tested the RAW line - so a
  `.pend` in a comment or a `.bend` in a string closed the enclosing scope and
  every later label was filed under the wrong one, silently. A `:` counts as a
  boundary (`outer:.proc` is valid) but a letter does not, which is what keeps the
  dotted reference `outer.proc` from reading as an opener.
- **Directive scopes**: `.proc`, `.block`, `.macro`, `.function`, `.struct`, `.union`, `.namespace`.
  An UNNAMED one is still a scope - `.block` with no label hides its labels from
  the outside (verified) - so it gets a synthetic `block@<line>` name rather than
  null, the same trick the unlabelled `.binclude` uses. `@` cannot occur in a user
  symbol, so it never collides. `LABEL_REQUIRED_OPENERS` lists the four the
  assembler refuses unnamed (`.proc`, `.macro`, `.function`, `.segment`)
- **Label vs instruction**: decided by the FIRST TOKEN, never by the column
  (verified): an indented `inner lda #1` defines `inner`, while `jsr rts` defines
  nothing at either column - `jsr` is the instruction and `rts` its operand - and a
  bare `nop` is the opcode, assembling to $EA. An explicit colon overrides all of
  it, so `nop:` is a label. Anchoring on column 0 instead lost every indented label
  (a false "undefined symbol" on each reference) and invented one for every
  `jsr rts`, which also re-anchored the following `_local` symbols.
- **Local symbols**: Start with `_`, scoped to the nearest code label above them.
  The underscore says WHERE a name lives, not what kind of thing it is: `_tbl .byte`
  is a data label, `_sub .block` opens a scope, a bare `_x` is a code label - all
  local, all verified. Every label pattern in `parser.ts` accepts the underscore
  and marks the result local via `isLocalName`; the dedicated local branch handles
  only bare names and assignments. A `_` code label does NOT become the enclosing
  label, so `_a` stays visible past a following `_code` (verified).
- **Qualified names**: `a.b` resolves `a` through the ordinary scope chain, so its
  full path must be `<some enclosing scope>.a` (verified: from global,
  `keyboard.scan` does NOT reach a `keyboard` nested inside `qwe`; from inside
  `qwe`, or from a sibling scope within it, it does). `scopeCandidates` in
  `symbols.ts` splits this into `reachable` (the written path, matched exactly
  against the chain) and `substituted` (what the name STANDS FOR - a `.dstruct`
  type, a macro-call label, a function's result - matched loosely, since the
  substitution already pins the identity). Only the FIRST segment substitutes.
  Loose matching everywhere used to hide two bugs: the parser not closing scopes
  on long-form closers, and `keyboard.scan` resolving from anywhere.
- **Function results**: `DocumentIndex.functionReturnScope` maps a `.function` to
  the scope its `.endf <name>` hands back, so `X = fn(...)` exposes THAT scope's
  members. `.endf namespace(*)` returns the function's own scope and needs no
  entry.
- **Scope resolution**: Searches from current scope up to global, then any scopes
  imported by an enclosing `.with`. `.with` scopes accumulate - `.with b` inside
  `.with a` searches `a.b` - and apply to qualified names too, so inside
  `.with MAPDATA` the reference `CHARS.DATA` means `MAPDATA.CHARS.DATA`. The
  expansion is applied once (`applyWith`), or it would recurse forever. `.with X` makes X's members visible unqualified
  but does NOT change where definitions land - a label defined inside a `.with` block
  belongs to the enclosing scope (verified). So it is recorded per line as
  `scopeAtLine[n].withScopes` (raw names, resolved at query time since the target may
  live in another file), never pushed onto the scope stack.
- **Case sensitivity**: Configurable via `64tass.caseSensitive` setting (equivalent to 64tass `-C` flag)
  - When disabled (default): `label.name` stores lowercase, matches 64tass default behavior
  - When enabled: `label.name` stores original case for exact matching
  - `originalName` always preserves display casing regardless of setting
  - Index is rebuilt when setting changes
  - Overridable per compilation unit via a `; 64tass-langserv: case-sensitive` /
    `case-insensitive` pragma comment (`detectCaseSensitivityPragma` in `utils.ts`).
    Recognized in a document's own text during indexing; the resolved value cascades
    from a root document into its `.include` tree (see `indexDocument` in `indexing.ts`)
    and is stored per-document as `DocumentIndex.caseSensitive`, since different
    compilation units in the same workspace can now have different effective settings.
    Query-time handlers must look up `documentIndex.get(uri)?.caseSensitive` (via the
    `effectiveCaseSensitive` helper in `server.ts`) rather than assume a single global
    value - this is a comment as far as 64tass itself is concerned and has no effect
    on the real compiler.
- **Conditional blocks**: `evaluateCondition` (`conditions.ts`) decides `.if`/`.elsif`
  conditions statically where possible; `findDeadLines` in `diagnostics.ts` uses it to
  skip undefined-symbol reporting inside branches that provably cannot be taken.
  Deliberately conservative - anything undecidable returns `null` and leaves every
  branch reported, so the evaluator can suppress but never invent. Supports literals,
  index-resolved symbols, `!` `&&` `||`, `= == != < > <= >=`, arithmetic and parens;
  the program counter `*` and strings are undecidable.
  `computeBranchPaths`/`areMutuallyExclusive` (same module) record which branch of
  which chain each line sits in. The duplicate-label check needs BOTH: branch paths,
  because two definitions in different branches of one chain never collide even when
  the condition is undecidable; and `findDeadLines`, because a definition inside a
  branch that provably cannot be taken (`.if 0`) is not there at all, and so neither
  collides nor is collided with. Missing the second gave a false duplicate for a
  label defined once inside `.if 0` and once outside it.
  Cross-file duplicates are NOT detected: the check only looks at the current
  document's labels, so a name defined in both a file and something it `.include`s
  goes unreported even though the assembler rejects it.
- **Build-time defines**: a `; 64tass-langserv: define NAME = VALUE` pragma
  (`detectDefinePragmas` in `utils.ts`) mirrors 64tass's `-D` flag and is indexed by
  `parseDocument` as a normal `kind: 'var'` label, so it resolves like any other
  symbol. Mainly exists so `-D`-supplied flags can decide `.if` branches.
- **Qualified completion**: a prefix containing a dot (`keyboard.`) completes the
  MEMBERS of that scope, not what is in scope at the cursor - nothing visible here
  can follow a dot. `collectScopeMembers` in `symbols.ts` resolves the path
  through the same `scopeCandidates` helper `findSymbolInfo` uses, so a struct
  instance, a label on a macro call and a label assigned from a function all
  offer the right scope's members. Locals and anonymous labels are excluded, and
  the operand-kind filter still applies, so `jsr scope.` will not offer a macro.
- **Opcode completion is per-CPU**: `getOpcodeCompletions` takes the document's
  `cpu` and uses `opcodesForCpu`, NOT the `OPCODES` union - the union exists for
  *recognition*, where the target may be unknown, but suggesting `bra` on a 6502
  offers something that cannot assemble.
- **Index register completion**: after a comma in an opcode operand only index
  registers are offered, never symbols. `,` is deliberately NOT a trigger
  character (that would fire completion at every comma in the language), so the
  list only appears once a letter has been typed. That is only tolerable because
  the extension ships `editor.acceptSuggestionOnEnter: "smart"` in
  `contributes.configurationDefaults`: a suggestion identical to what was typed
  makes no textual change, so Enter opens the next line instead of being consumed
  by the popup. Removing that default makes this branch cost a keypress on every
  indexed line - it was briefly deleted for exactly that reason (6fdd68c,
  reverted). Which ones is derived from
  `addressingModesFor` rather than a blanket list, so it is exact per opcode, per
  CPU and per position - a comma is `plain` (`lda $1234,x`), `inside`
  (`lda ($10,x)`) or `after-close` (`lda ($10),y`), and those take different
  registers: `lda $10,z` is rejected on the 4510 while `lda ($10),z` is fine. An
  empty result falls back to symbol completion, which is what `jmp $1234,` and
  the third operand of `bbr` need. The `,b` `,d` `,k` `,r` suffixes are
  deliberately excluded: they assemble but are addressing-size and bank
  overrides, not indices (`lda $10,b` disassembles as a plain absolute
  `lda $0010`).
- **Index lifetime**: `scanWorkspace` runs once, at startup, so `onDidClose` must
  NOT simply drop a file - doing so shrank the index with every file opened and
  closed, quietly costing Ctrl+T and cross-file go-to-definition for the rest of
  the session. A closed file under a workspace root is re-indexed from disk
  instead; only one outside the roots is dropped. `onDidChangeWatchedFiles`
  likewise treats `Created` as a reason to index rather than to skip.
- **Compilation units**: a workspace holds many independent programs, so symbols
  from a file that is not assembled together with the current one must not be
  offered. `IncludeGraph.compilationUnit(uri)` is that set: the file's own
  include tree plus the trees of any roots that pull it in, since files included
  side by side under one root do see each other (verified). A file no root
  includes is a unit of one. Passed to `collectVisibleLabels` as `visibleUris`
  by completion and by the spelling quick fix. Deliberately NOT applied to
  `findSymbolInfo`: an incomplete include graph would there turn into false
  "undefined symbol" reports, where the worst it can cost completion is a
  missing suggestion.
- **Dotted assignment targets**: `outer.extra = 5` and `_sid.init = 5` both
  assemble, so `constMatch` takes the leading segments as the scope the symbol
  lands in and the last as its name - the same shape `findDictKeys` produces.
  Nothing matched these lines before, so the definition vanished; that is what
  made `music.init` read as undefined in 64tass's own `loading_a_sid_file`.
- **Dynamic members**: `DocumentIndex.labelDefinedByMacro` maps a label - by FULL
  scope path, as `structInstances` and `functionReturnScope` do - to the
  scope its members come from - the macro of a `label #macro` / `label .macro`
  call, or the function of a `label = fn(...)` assignment where the function
  returns `namespace(*)`. Dict literals (`D = {.MAP: 1}`) instead index each key
  as a real label scoped under `D`. All three make members reachable ONLY as
  `label.member`, never bare (verified). `findSymbolInfo` tries the path as
  written FIRST and these substitutions after, so a scope that genuinely carries
  that name still wins. `substitutionsFor` takes the LONGEST matching prefix of a
  path and carries the remainder over, and consults every document rather than
  stopping at the first - stopping made the answer depend on indexing order.
- **Struct instances**: `name .dstruct type, ...` (and `.dunion`) records
  `DocumentIndex.structInstances[name] = type`, so `name.member` resolves to that
  type's member. A member the type does not declare is still reported, matching the
  assembler.
- **Document indexing**: `DocumentIndex` stores labels, scope info, parameters, macro sub-labels; `.include` files are recursively indexed
- **Documentation comments**: `getBlockComment` (`utils.ts`) takes the same-line
  comment, else a run of comment-only lines directly above, else one directly
  below, and `LabelDefinition.comment` carries it to hover and completion. It
  applies to EVERY symbol a user writes - it used to reach only scope openers and
  `.binclude` labels, so `counter = $10 ; how many` documented nothing. Three
  branches deliberately opt out, each said so at the branch: anonymous labels
  (never named), define-pragma symbols (the pragma line is itself the comment) and
  dict-literal keys (the comment describes the assignment, not each key).
- **Symbol name characters**: the manual's rule is "starting with a letter and
  containing letters, numbers and underscores", and anything else ENDS the name -
  `CODE_£ = $30` defines `CODE_` and then fails, so ten such lines in a row all
  redefine `CODE_`. `findInvalidSymbolChar` in `diagnostics.ts` reports the
  offending character, and `findMissingValue` catches the `CODE_= = $35` variant,
  where the truncated name leaves an assignment with no expression. Non-ASCII
  LETTERS are deliberately allowed: the manual permits them under `-a`, a flag the
  extension cannot see, so a missed error without it beats reporting good code
  with it (`£` and `↑` are not letters and are still caught).
- **Diagnostic codes**: diagnostics that a quick fix can act on carry a `code`
  (`undefined-symbol`, `undefined-macro`, `unclosed-block`, plus
  `invalid-symbol-character`, `expression-expected` and `label-required`); `codeActions.ts`
  matches on that rather than on message text, so wording can change freely. An
  `unclosed-block` also carries the closer to insert in `data`.
- **Symbol lookup cost**: `findSymbolInfo` filters by name first via
  `DocumentIndex.labelsByName`, then by scope. It used to scan every label of
  every document per call, so cost grew with the whole workspace (~0.1 ms per
  lookup at 20k labels, and diagnostics calls it once per symbol occurrence).
  `performance.test.ts` guards the scaling property rather than a wall-clock
  ceiling, which would be flaky on CI.
- **Cycle counts**: `cycles.ts`, keyed by opcode byte, for the NMOS family only
  (`6502`/`6502i`/`default`). The ONE table here that cannot be probed - 64tass
  is an assembler and has no timing information at all (no listing column, no
  directive, no flag, nothing in the manual), so it is transcribed from two
  published references that agree on every shared entry. It is cross-checked
  against the probed addressing table: all 221 forms the assembler accepts for
  the 6502i map to the mnemonic the reference gives that opcode byte, which
  cannot verify the counts but does catch a table lined up against the wrong
  opcodes. CMOS and 16-bit targets are deliberately absent - the 65816's timing
  depends on register widths and direct-page alignment - and hover falls back to
  instruction length for them.
- **Closer hover**: hovering `.pend`/`.bend`/`.endm`... names the scope it ends
  and the line it opened on - not its kind, which the closer already says.
  The opener is found with `computeFoldingRanges`, so hover and folding can never
  disagree about the pairing. Two traps, both covered by tests: it must be tried
  BEFORE `symbolHover`, which strips a leading dot to look up a macro and would
  otherwise answer for `.pend` with a symbol called `pend`; and the label at the
  opener's line only counts as the scope's name when its `kind` matches the
  directive, since `.for i = 0, ...` records `i` as a loop variable.
- **Opcode hover**: `hover.ts` merges three sources. `addressing.ts` is GENERATED -
  every addressing mode was probed from 64tass, with the mode read back from the
  listing's monitor column (the assembler's own disassembly) rather than assumed
  from the syntax fed in, which is what separates `lda $34,y` (encodes absolute,y)
  from a real zeropage,y form and a relative branch from an absolute jump.
  `test/integration/addressing.test.ts` re-runs that probe and compares, so the
  table cannot go stale. `opcodeDocs.ts` is hand-written and deliberately partial:
  semantics cannot be probed, so mnemonics outside the sets whose meaning is
  unambiguous are left undescribed rather than guessed at, and hover degrades to
  showing just their (verified) modes.
- **Operand shapes**: `operands.ts` is the one place that reads an operand's
  structure - bracket, index register inside (`($10,x)`), index register outside
  (`($10),y`, `$10,x`), and both at once (the 65816's `($10,s),y`). Completion asks
  it which registers a comma can take; `findAddressingProblem` asks whether the
  written form has a mode at all, so `lda ($10),x` and `ldx $10,x` are reported.
  Everything is derived from the probed `addressing.ts`, with two limits the
  assembler itself forced, both found by `addressing-check.test.ts` (which runs
  every mnemonic of every target through every shape and demands ZERO reports on
  anything 64tass accepts): the patterns are the assembler's DISASSEMBLY, so a
  source form it rewrites is invisible - `pei ($10)` and `jml [$1234]` assemble but
  read back as plain addresses, hence bracket-only forms are only reported for
  mnemonics the table shows brackets for - and WHICH bracket is not distinguished,
  since the 45gs02 takes `lda [$10],z` for the same mode it prints as `($10),z`.
  Immediates, implied forms, register operands (`asl a`) and the `bbr`/`mvn`
  multi-operand families are deliberately not modelled. A form that exists on some
  other target is reported only when `cpuExplicit`; one no target has is always.
- **Include resolution**: `resolveIncludePath` in `paths.ts`. 64tass tries the
  including file's own directory first, then each `-I` directory in order
  (verified). The `-I` list is the `64tass.includePaths` setting, made absolute
  against the workspace root by `absoluteSearchPaths` and passed down through
  `IndexContext.includePaths`.
- **`.binclude` scoping**: `label .binclude "f"` wraps f in a block scope, so f's
  `sym` is reachable only as `label.sym`, unlike the textual `.include`. The parser
  records the full scope path in `DocumentIndex.includeScopes` and `indexDocument`
  re-parses the target with it as `parseDocument`'s `baseScope`, which prefixes every
  scope path the file produces. Nests, picks up an enclosing `.proc`/`.block`, and
  cascades through plain `.include`s below it. One index entry per URI, so a file
  bincluded twice under different labels only models the first.

## Build Commands

Uses **yarn** (not npm):

```bash
yarn install     # Install dependencies
yarn compile     # Build TypeScript
yarn watch       # Build in watch mode
yarn package     # Create .vsix (uses vsce)
```

## Testing

Tests must be kept up to date when making code changes. Run `yarn test` before considering work complete. If a change modifies parser, symbols, diagnostics, utils, or constants, update or add corresponding tests in `test/unit/` and verify they pass.

```bash
yarn test          # Run all tests (currently 1356 tests); compiles first
yarn test:watch    # Watch mode
yarn test:coverage # Run with coverage (report in coverage/)
yarn typecheck     # Type-check src/ AND test/ (vitest transpiles without checking)
```

`tsconfig.test.json` exists because the build config compiles only `src/`, so a
hand-built `DocumentIndex` in a test would silently go stale whenever the
interface gains a field. Use `emptyIndex()` from `test/helpers/doc.ts` instead of
building one literally.

- **Framework:** Vitest
- **Unit tests:** `test/unit/` — one file per module. Self-contained: never reuse
  symbol names lifted from `example/` (gitignored, private work) or
  `test/fixtures/64tass-examples/`. Reproduce the SHAPE of a bug with invented
  names and say in a comment which real construct it came from. Real sources
  belong in the integration suites, which read the fixture files on purpose.
- **Integration tests:** `test/integration/` — compiler reference tests. They need
  a real 64tass (`TASS_PATH`, default `/home/db/bin/64tass`) and SKIP silently
  without one, so `REQUIRE_TASS=1` turns a missing binary into a hard failure. CI
  installs the Debian/Ubuntu `64tass` package and sets both, since a green run
  that skipped every compiler test verifies nothing.
  `addressing.test.ts` and `register-modes.test.ts` compare the GENERATED tables
  back against the assembler; those two additionally skip unless the assembler is
  `TABLES_PROBED_FROM` (the version the tables were probed from), because another
  version may legitimately differ - but under `REQUIRE_TASS` a mismatch is an
  ERROR, since skipping them there would leave CI green having verified nothing.
  CI therefore BUILDS that exact version from source (about three seconds) rather
  than installing the apt package: Ubuntu 24.04 ships 1.59.3120, which has no
  `psh`/`pul`, so `corpus/register-modes.asm` does not even assemble under it.
  The pinned version lives in `TASS_VERSION` in both workflows and must be kept in
  step with `TABLES_PROBED_FROM`.
- **Fixtures:** `test/fixtures/` — `.asm` files used by integration tests.
  `test/fixtures/all-opcodes/` holds one file per `.cpu` target exercising every
  mnemonic and addressing form, all assembling with zero errors AND zero warnings.
  Anything the extension reports on them is a false positive, and any line indexed
  as a *label* means a mnemonic went unrecognised - which is what
  `all-opcodes.test.ts` asserts. `test/fixtures/64tass-examples/` holds real
  sources from the 64tass distribution.
  `test/fixtures/corpus/` holds 20 files that BOTH assemble cleanly under real
  64tass and must produce zero error diagnostics here, so a false positive fails
  the build. Add one whenever a new construct is supported; verify it assembles
  before committing (a construct that does not assemble proves nothing), and add
  any flags it needs to `COMPILE_FLAGS` in `corpus.test.ts`.
- **Helpers:** `test/helpers/` — `createDoc`, `buildIndex`, `compile`
  - `buildIndex()` accepts `caseSensitive` per source object (falling back to the first entry), so a single index can mix case-sensitive and case-insensitive documents

## Release Process

1. Update version in CHANGELOG.md and `package.json`
2. Commit changes
3. Create and push an **annotated** tag:
   `git tag -a v0.x.y -m "Release v0.x.y" && git push origin v0.x.y`
   Annotated (`-a`), not plain `git tag`: a lightweight tag is only a pointer at a
   commit, so it has no object to carry a tagger, a message or a signature -
   `tag.gpgsign` has no effect on one. Use `-s` to force signing regardless of config.
4. GitHub Actions builds and creates the release with the .vsix

Note `vscode:prepublish` runs `version-from-tag`, which rewrites `package.json`'s
version from `git describe`, so the pushed tag is what ultimately decides the
published version.

## File Extensions

Handles: `.asm`, `.s`, `.inc`, `.src`
