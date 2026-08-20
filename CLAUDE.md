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
│       ├── parser.ts             # parseDocument — label/scope/macro extraction
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
  Decides `opcodesForCpu()` and `registerModesForCpu()`. Only the FIRST `.cpu` in a
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
- **Directive scopes**: `.proc`, `.block`, `.macro`, `.function`, `.struct`, `.union`, `.namespace`
- **Local symbols**: Start with `_`, scoped to the nearest code label above them
- **Scope resolution**: Searches from current scope up to global, then any scopes
  imported by an enclosing `.with`. `.with X` makes X's members visible unqualified
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
  which chain each line sits in. The duplicate-label check uses those rather than
  `findDeadLines`: the assembler assembles at most one branch, so two definitions in
  different branches never collide *even when the condition is undecidable*.
- **Build-time defines**: a `; 64tass-langserv: define NAME = VALUE` pragma
  (`detectDefinePragmas` in `utils.ts`) mirrors 64tass's `-D` flag and is indexed by
  `parseDocument` as a normal `kind: 'var'` label, so it resolves like any other
  symbol. Mainly exists so `-D`-supplied flags can decide `.if` branches.
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
- **Dynamic members**: `DocumentIndex.labelDefinedByMacro` maps a label to the
  scope its members come from - the macro of a `label #macro` / `label .macro`
  call, or the function of a `label = fn(...)` assignment where the function
  returns `namespace(*)`. Dict literals (`D = {.MAP: 1}`) instead index each key
  as a real label scoped under `D`. All three make members reachable ONLY as
  `label.member`, never bare (verified). `findSymbolInfo` tries the path as
  written FIRST and these substitutions after, so a scope that genuinely carries
  that name still wins.
- **Struct instances**: `name .dstruct type, ...` (and `.dunion`) records
  `DocumentIndex.structInstances[name] = type`, so `name.member` resolves to that
  type's member. A member the type does not declare is still reported, matching the
  assembler.
- **Document indexing**: `DocumentIndex` stores labels, scope info, parameters, macro sub-labels; `.include` files are recursively indexed
- **Diagnostic codes**: diagnostics that a quick fix can act on carry a `code`
  (`undefined-symbol`, `undefined-macro`, `unclosed-block`); `codeActions.ts`
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
yarn test          # Run all tests (currently 1120 tests); compiles first
yarn test:watch    # Watch mode
yarn test:coverage # Run with coverage (report in coverage/)
yarn typecheck     # Type-check src/ AND test/ (vitest transpiles without checking)
```

`tsconfig.test.json` exists because the build config compiles only `src/`, so a
hand-built `DocumentIndex` in a test would silently go stale whenever the
interface gains a field. Use `emptyIndex()` from `test/helpers/doc.ts` instead of
building one literally.

- **Framework:** Vitest
- **Unit tests:** `test/unit/` — one file per module
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
