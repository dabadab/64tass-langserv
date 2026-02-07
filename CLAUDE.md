# 64tass Language Server

VS Code extension providing language support for the 64tass MOS 6502 macro assembler.

## Project Structure

```
64tass-langserv/
├── src/
│   ├── extension.ts              # VS Code extension client entry point
│   └── server/
│       ├── server.ts             # LSP handlers, document indexing
│       ├── types.ts              # Shared interfaces (LabelDefinition, DocumentIndex)
│       ├── constants.ts          # Opcodes, directives, builtins
│       ├── utils.ts              # String/comment/numeric helpers
│       ├── parser.ts             # parseDocument — label/scope/macro extraction
│       ├── symbols.ts            # Symbol lookup, definition, references
│       └── diagnostics.ts        # validateDocument — errors and warnings
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
2. **Server** (`src/server/`): Provides go-to-definition, find references, rename, hover, folding, and diagnostics

### Key Concepts

- **Directive scopes**: `.proc`, `.block`, `.macro`, `.function`, `.struct`, `.union`, `.namespace`
- **Local symbols**: Start with `_`, scoped to the nearest code label above them
- **Scope resolution**: Searches from current scope up to global
- **Case sensitivity**: Configurable via `64tass.caseSensitive` setting (equivalent to 64tass `-C` flag)
  - When disabled (default): `label.name` stores lowercase, matches 64tass default behavior
  - When enabled: `label.name` stores original case for exact matching
  - `originalName` always preserves display casing regardless of setting
  - Index is rebuilt when setting changes
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
yarn test        # Run all tests (currently 257 tests)
yarn test:watch  # Watch mode
```

- **Framework:** Vitest
- **Unit tests:** `test/unit/` — one file per module
- **Integration tests:** `test/integration/` — compiler reference tests (require `/home/db/bin/64tass`)
- **Fixtures:** `test/fixtures/` — `.asm` files used by integration tests
- **Helpers:** `test/helpers/` — `createDoc`, `buildIndex`, `compile`
  - `buildIndex()` accepts `caseSensitive` option in source objects for testing case-sensitive mode

## Release Process

1. Update version in CHANGELOG.md
2. Commit changes
3. Create and push tag: `git tag v0.x.0 && git push --tags`
4. GitHub Actions builds and creates release with .vsix

## File Extensions

Handles: `.asm`, `.s`, `.inc`, `.src`
