# Benchmarks

Run-time performance of the language server, measured the way the editor uses
it: the built bundle (`out/server/server.js`) is started as a child process and
driven over LSP on stdio. Nothing is imported from `src/`, which is what lets
the same harness measure any past release unchanged.

Numbers are comparable only on one machine and one workload. Every saved
record carries a machine id (a hash of CPU model, core count, memory, platform
and architecture) and the workload's content hash, and `report` and `compare`
refuse to put records with different ones side by side. When the hardware
changes, `bench:history` reproduces the whole series on the new machine.

## Commands

```
yarn bench                          # build the production bundle, measure HEAD, print a table
yarn bench --save                # ...and append the record to bench/results.jsonl (clean tree only)
yarn bench --save --force        # save from a dirty tree; the version is marked -dirty
yarn bench:history                  # every v* tag, each in its own worktree; add --save to keep them
yarn bench:history v0.9.0 v0.12.0   # only these refs
yarn bench:report                   # Markdown table, last 6 versions on this machine
yarn bench:report --format csv   # long-format CSV of everything
yarn bench:compare --baseline v0.12.0   # measure HEAD now, exit 1 if anything regressed > 20% and > 0.5 ms
node bench/bench.mjs workload --verify     # generate the workload and assemble it with 64tass
node bench/bench.mjs run --smoke           # what CI runs: tiny workload, one process, no save
```

Flags for `run` and `history`: `--scale N` (workload size, default 10),
`--runs N` (server processes, default 3), `--reps N` (measured repetitions per
request, default 20), `--warmup N` (unmeasured repetitions first, default 3),
`--label NAME` (a human name for this machine, stored in the record),
`--scan-wait auto|always|never`.

`yarn test` never touches `bench/results.jsonl`. Only `--save` writes there.

## What is measured

One server process is taken through the same sequence every time; each step
is timed. Per metric the report shows the median of the per-process medians,
the worst per-process p90 and the best minimum. Lower is better for all of them.

| metric | what it is |
|---|---|
| `startupMs` | spawning the process to the `initialize` response |
| `scan.reportedMs` | the workspace scan, as the server's own `Indexed N workspace file(s) in Xms` log line reports it |
| `scan.wallMs` | the same scan, from `initialized` to that log line, as the client sees it |
| `rss.afterScanMB` | resident memory of the server after the scan (Linux only) |
| `open.toDiagnosticsMs` | `didOpen` of the root file to its first `publishDiagnostics` |
| `open.indexMs` | a hover sent right after that `didOpen`: it queues behind the synchronous indexing, so this is the index cost without the debounce |
| `change.toDiagnosticsMs` | one edit at the end of the root file to the diagnostics it provokes |
| `completionMs` … `signatureHelpMs` | one request of that kind, at a fixed position |
| `cycleCountsMs` | the custom `64tass/cycleCounts` request |
| `rss.endMB` | resident memory at the end of the run |

Footnotes the report repeats:

- `open.toDiagnosticsMs` and `change.toDiagnosticsMs` include the 250 ms
  diagnostic debounce from v0.9.2 on. It is a constant, so changes between
  versions are still meaningful; `open.indexMs` is the debounce-free number.
- `scan.*` is null before v0.9.2, when the background scan arrived.
- `open.indexMs` is meaningful from v0.9.2 on. Before the debounce existed it
  equals `open.toDiagnosticsMs`, and v0.9.0/v0.9.1 answered the probing hover
  before indexing, so their 3 ms measures nothing.
- A `-` in the table means the version does not have the capability. A null is
  never "did not answer": every wait has a timeout, and a timeout fails the run.

Capabilities by version, for reading old columns: v0.6.0 hover, definition,
folding; v0.7.0 references, rename; v0.9.0 completion; v0.9.2 document and
workspace symbols, signature help, semantic tokens, the scan; v0.11.0
formatting, cycle counts.

`compare` calls a metric regressed when it grew by more than `--threshold`
(default 20%) AND by at least `--min-delta` (default 0.5 ms or MB): the
sub-millisecond requests jitter by half between two runs on an idle machine,
and a percentage alone would flag them every time.

## The workload

`bench/lib/workload.mjs` writes a synthetic project to a temporary directory:
an include tree several levels deep, constants and macros defined in one file
and used from every other, `.proc` and `.block` scopes with `_local` labels,
struct types and `.dstruct` instances, data tables and `.if` chains. The
skeleton is fixed and a seeded PRNG decides only data values, so it is the
same every time; `--smoke` asserts that, and that every probe (where to hover,
what to rename) points at the token it claims to.

`workload --verify` assembles it with 64tass (`TASS_PATH`, default
`/home/db/bin/64tass`) and fails on any error or warning. Current hashes,
`synthetic-v1`: scale 1 `845952f86a7c…` (9 files, 1130 lines), scale 10
`d98565b4a6a0…` (45 files, 7646 lines). Change the generator and the hash
changes with it, which starts a new series - old records stay in the file
but are reported in a table of their own.

## Getting a steady number

- Close the browser and anything else that burns CPU; the harness warns when
  the one-minute load average is above half the core count and records it.
- On a laptop, run on mains power. Pinning helps too:
  `taskset -c 2,3 nice -n -5 yarn bench`.
- `--runs 5` when a per-process metric (startup, scan, open) looks noisy.
- Use the same node binary for the whole series; `history` does, and records it.
- Dependencies are not pinned (`yarn.lock` is gitignored), so a worktree built
  today may bundle a newer `vscode-languageserver` than the same tag built last
  month. The versions found in the measured tree are stored under
  `target.dependencies`; if two records of one tag disagree, look there first.

## The record

One JSON object per line in `bench/results.jsonl`:

```json
{"schema":1,
 "harness":{"version":"1.0.0","workload":{"name":"synthetic-v1","scale":10,"seed":104868437,"hash":"d985…","files":45,"lines":7646}},
 "target":{"describe":"v0.12.0","commit":"b1a7bab…","dirty":false,"serverPath":"out/server/server.js","buildScript":"compile:prod",
           "dependencies":{"vscode-languageserver":"9.0.1","vscode-languageserver-textdocument":"1.0.12","vscode-jsonrpc":"8.2.1","typescript":"5.9.3","esbuild":"0.27.3"}},
 "env":{"timestamp":"2026-09-14T…","label":null,"machineId":"59d8eb73fcd2","node":"v22.22.2","platform":"linux","release":"…","arch":"x64",
        "cpuModel":"AMD Ryzen 5 3600 6-Core Processor","cores":12,"totalMemGB":31,"loadavg1":0.5},
 "settings":{"runs":3,"reps":20,"warmup":3},
 "capabilities":{"hover":true,"rename":true,"semanticTokens":true,"documentFormatting":true,"scan":true,"cycleCounts":true},
 "metrics":{"startupMs":{"n":3,"median":177,"p90":182,"min":176},"hoverMs":{"n":60,"median":0.4,"p90":0.6,"min":0.3},"cycleCountsMs":null},
 "errors":{},
 "runs":[{"startupMs":{"n":1,"median":177,"p90":177,"min":177,"max":177}}]}
```

`errors` holds a message per metric whose first answer failed its shape check
(a hover that came back null, references with one hit); such a metric is
recorded as null so garbage can never look fast.
