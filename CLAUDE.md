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

### Key Concepts

- **CPU targets**: `OPCODES` in `constants.ts` is the UNION of mnemonics across all 11
  CPUs 64tass can target, derived by probing the assembler itself rather than written
  by hand. Recognition must not depend on knowing the target, since it can be set by
  `.cpu` or a command-line flag the server cannot see. `opcodesForCpu()` exposes the
  per-CPU breakdown for a future narrowing. Label detection gates on `OPCODES.has()`,
  so a missing mnemonic means a file indexes to *no labels at all*.
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
- **Struct instances**: `name .dstruct type, ...` (and `.dunion`) records
  `DocumentIndex.structInstances[name] = type`, so `name.member` resolves to that
  type's member. A member the type does not declare is still reported, matching the
  assembler.
- **Document indexing**: `DocumentIndex` stores labels, scope info, parameters, macro sub-labels; `.include` files are recursively indexed

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
yarn test          # Run all tests (currently 717 tests)
yarn test:watch    # Watch mode
yarn test:coverage # Run with coverage (report in coverage/)
```

- **Framework:** Vitest
- **Unit tests:** `test/unit/` — one file per module
- **Integration tests:** `test/integration/` — compiler reference tests (require `/home/db/bin/64tass`)
- **Fixtures:** `test/fixtures/` — `.asm` files used by integration tests
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
