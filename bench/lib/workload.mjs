/**
 * A synthetic 64tass workspace, generated the same way every time.
 *
 * Real projects are private (example/ is gitignored) and the fixtures are a few
 * hundred lines, so the benchmark builds its own: an include tree several
 * levels deep, macros defined in one file and called from every other, .proc
 * and .block scopes with _local labels, struct types and instances, data
 * tables and .if chains - the shapes the server's hot paths are about.
 *
 * Deterministic on purpose. The skeleton is fixed and a seeded PRNG decides only
 * data values, so the SAME questions are asked of every version measured: the
 * probe positions (where to hover, what to rename) are recorded while the
 * lines are written, never found by parsing, and the whole tree's hash goes
 * into every result so numbers from different workloads are never compared.
 *
 * Every construct here assembles cleanly under 64tass with only documented NMOS
 * opcodes; `bench workload --verify` proves it (see verifyWorkload).
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

export const WORKLOAD_NAME = 'synthetic-v1';
export const WORKLOAD_SEED = 0x6402a55;
/** Above this the data tables no longer fit in 64K of address space. */
const MAX_SCALE = 25;

/** Small, fast, seedable PRNG - the values only need to be stable. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Column and line bookkeeping for one generated file. */
class Out {
    constructor(name) {
        this.name = name;
        this.lines = [];
    }
    /** Append a line; returns its zero-based index. */
    emit(text) {
        this.lines.push(text);
        return this.lines.length - 1;
    }
    /** Where `token` sits on the line just emitted. */
    probe(line, token) {
        const character = this.lines[line].indexOf(token);
        if (character < 0) throw new Error(`probe token '${token}' not on line: ${this.lines[line]}`);
        return { file: this.name, line, character, expect: token };
    }
    text() {
        return this.lines.join('\n') + '\n';
    }
}

const hex = n => '$' + n.toString(16).padStart(2, '0');

/**
 * @typedef {{ file: string, line: number, character: number, expect: string }} Probe
 * @typedef {{
 *   hover: Probe, definition: Probe, references: Probe, rename: Probe & { newName: string },
 *   completion: Probe, signatureHelp: Probe, workspaceSymbolQuery: string,
 *   document: string, changeInsert: { file: string, line: number, text: string }
 * }} Probes
 * @typedef {{ name: string, scale: number, seed: number, hash: string, files: string[],
 *             lines: number, root: string, probes: Probes }} Workload
 */

/**
 * Build the workspace in memory.
 * @returns {{ files: Map<string, string>, workload: Workload }}
 */
export function buildWorkload({ scale = 10, seed = WORKLOAD_SEED } = {}) {
    if (!Number.isInteger(scale) || scale < 1) throw new Error(`scale must be a positive integer, got ${scale}`);
    if (scale > MAX_SCALE) throw new Error(`scale ${scale} exceeds ${MAX_SCALE}: the data tables would overflow 64K`);
    const rnd = mulberry32(seed ^ scale);
    const byte = () => Math.floor(rnd() * 256);
    const pick = n => Math.floor(rnd() * n);

    const CONSTANTS = 200;
    const SCREEN_CONSTANTS = 20;
    const MACROS = 20;
    const STRUCTS = 10;
    const BLOCKS_PER_MODULE = 30;
    const TABLE_LINES = 100;

    const files = new Map();
    const probes = {};
    const finish = out => files.set(out.name, out.text());

    // ---- inc/constants.inc: plain constants plus a chain the evaluator can decide
    {
        const out = new Out('inc/constants.inc');
        out.emit('; constants shared by every module');
        out.emit('SC = $02');
        for (let i = 0; i < SCREEN_CONSTANTS; i++) out.emit(`SCREEN_${i} = ${hex(0x10 + i)}`);
        for (let i = 0; i < CONSTANTS; i++) out.emit(`C_${i} = ${hex(byte())}`);
        out.emit('VERSION = 2');
        out.emit('        .if VERSION > 2');
        out.emit('MODE = 3');
        out.emit('        .elsif VERSION == 2');
        out.emit('MODE = 2');
        out.emit('        .else');
        out.emit('MODE = 1');
        out.emit('        .endif');
        finish(out);
    }

    // ---- inc/shared.inc: the one symbol every module refers to
    {
        const out = new Out('inc/shared.inc');
        out.emit('; entry point every module calls');
        const line = out.emit('shared_entry');
        out.emit('        lda #0');
        out.emit('        rts');
        out.emit('shared_table .byte 1, 2, 3, 4');
        probes.references = out.probe(line, 'shared_entry');
        probes.rename = { ...out.probe(line, 'shared_entry'), newName: 'shared_entry_renamed' };
        finish(out);
    }

    // ---- inc/macros.inc: named-parameter macros, called from every module
    {
        const out = new Out('inc/macros.inc');
        out.emit('; macros with named parameters');
        for (let n = 0; n < MACROS; n++) {
            out.emit(`mac_${n} .macro dest, value`);
            out.emit('        lda #\\value');
            out.emit('        sta \\dest');
            out.emit('        .endm');
        }
        finish(out);
    }

    // ---- inc/structs.inc: struct types for .dstruct instances
    {
        const out = new Out('inc/structs.inc');
        out.emit('; struct types');
        for (let j = 0; j < STRUCTS; j++) {
            out.emit(`type_${j} .struct`);
            const members = 4 + (j % 5);
            for (let m = 0; m < members; m++) out.emit(`f${m}      ${m % 3 === 1 ? '.word' : '.byte'} ?`);
            out.emit('        .ends');
        }
        finish(out);
    }

    // ---- one module per scale unit
    for (let k = 0; k < scale; k++) {
        const out = new Out(`mod${k}/mod${k}.asm`);
        out.emit(`; module ${k}`);
        out.emit(`mod${k}  .proc`);
        out.emit('        jsr shared_entry');
        const hoverLine = out.emit(`        lda SCREEN_${k % SCREEN_CONSTANTS}`);
        out.emit(`        sta C_${pick(CONSTANTS)}`);
        const completionLine = out.emit('        lda SC');
        const sigLine = out.emit(`        #mac_${k % MACROS} C_${pick(CONSTANTS)}, ${byte()}`);
        if (k === 0) {
            probes.hover = out.probe(hoverLine, 'SCREEN_0');
            probes.definition = out.probe(hoverLine, 'SCREEN_0');
            probes.completion = { file: out.name, line: completionLine, character: out.lines[completionLine].length, expect: 'SC' };
            probes.signatureHelp = { file: out.name, line: sigLine, character: out.lines[sigLine].indexOf(', ') + 2, expect: ', ' };
            probes.document = out.name;
        }
        for (let b = 0; b < BLOCKS_PER_MODULE; b++) {
            out.emit(`blk${b}   .block`);
            out.emit(`_start  ldx #${byte()}`);
            out.emit(`_loop   lda C_${pick(CONSTANTS)}`);
            out.emit(`        sta SCREEN_${pick(SCREEN_CONSTANTS)},x`);
            out.emit(`        #mac_${pick(MACROS)} C_${pick(CONSTANTS)}, ${byte()}`);
            out.emit('        dex');
            out.emit('        bne _loop');
            out.emit(`        lda tab_${k}_1,x`);
            out.emit(`        cmp inst_${k}_${b % 4}.f0`);
            out.emit('        bcc _done');
            out.emit('        jsr shared_entry');
            out.emit('_done   rts');
            out.emit('        .bend');
        }
        out.emit('        .if MODE == 1');
        out.emit('        lda #1');
        out.emit('        .elsif MODE == 2');
        out.emit('        lda #2');
        out.emit('        .else');
        out.emit('        lda #3');
        out.emit('        .endif');
        out.emit('        rts');
        for (let i = 0; i < 4; i++) out.emit(`inst_${k}_${i} .dstruct type_${pick(STRUCTS)}`);
        out.emit(`        .include "l1_${k}.asm"`);
        out.emit('        .pend');
        finish(out);

        // Three levels of data tables under the module.
        for (let level = 1; level <= 3; level++) {
            const t = new Out(`mod${k}/l${level}_${k}.asm`);
            t.emit(`; module ${k} data, level ${level}`);
            t.emit(`tab_${k}_${level}`);
            for (let row = 0; row < TABLE_LINES; row++) {
                const cells = Array.from({ length: 8 }, () => hex(byte())).join(', ');
                t.emit(`        .byte ${cells}`);
            }
            t.emit(`tab_${k}_${level}_end`);
            if (level < 3) t.emit(`        .include "l${level + 1}_${k}.asm"`);
            finish(t);
        }
    }

    // ---- main.asm: the root that pulls everything in
    {
        const out = new Out('main.asm');
        out.emit(`; ${WORKLOAD_NAME} benchmark workload - generated by bench/lib/workload.mjs`);
        out.emit('        * = $0801');
        out.emit('        .include "inc/constants.inc"');
        out.emit('        .include "inc/shared.inc"');
        out.emit('        .include "inc/macros.inc"');
        out.emit('        .include "inc/structs.inc"');
        for (let k = 0; k < scale; k++) out.emit(`        .include "mod${k}/mod${k}.asm"`);
        out.emit('start');
        for (let k = 0; k < scale; k++) out.emit(`        jsr mod${k}`);
        out.emit('        jmp start');
        const last = out.emit('        rts');
        probes.changeInsert = { file: out.name, line: last, text: '        nop\n' };
        finish(out);
    }

    probes.workspaceSymbolQuery = 'inst_';

    const names = [...files.keys()].sort();
    const workload = {
        name: WORKLOAD_NAME,
        scale,
        seed,
        hash: workloadHash(files),
        files: names,
        lines: names.reduce((n, f) => n + files.get(f).split('\n').length - 1, 0),
        root: 'main.asm',
        probes,
    };
    return { files, workload };
}

/** sha256 over the sorted path/content pairs. */
export function workloadHash(files) {
    const hash = createHash('sha256');
    for (const name of [...files.keys()].sort()) hash.update(name).update('\0').update(files.get(name)).update('\0');
    return hash.digest('hex');
}

/** Build and write the workspace under `dir`. */
export function generateWorkload(dir, options = {}) {
    const { files, workload } = buildWorkload(options);
    for (const [name, content] of files) {
        const full = path.join(dir, name);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, content);
    }
    return workload;
}

/** Same convention as test/helpers/compiler.ts. */
export const TASS_PATH = process.env.TASS_PATH ?? '/home/db/bin/64tass';

/**
 * Assemble the generated tree and fail on any error or warning: a workload
 * that does not assemble measures the server on input no one would write.
 */
export function verifyWorkload(dir, workload, tassPath = TASS_PATH) {
    const result = spawnSync(tassPath, ['--quiet', '-Wall', '--output', '/dev/null', workload.root],
        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error?.code === 'ENOENT') throw new Error(`64tass not found at ${tassPath} (set TASS_PATH)`, { cause: result.error });
    if (result.error) throw new Error(`could not run ${tassPath}: ${result.error.message}`, { cause: result.error });
    const output = `${result.stdout}${result.stderr}`;
    if (result.status !== 0) throw new Error(`64tass rejected the workload (exit ${result.status}):\n${output}`);
    if (/(error|warning):/.test(output)) throw new Error(`64tass reported problems:\n${output}`);
    return true;
}

/**
 * Every probe points at the token it claims to. Runs after generation in
 * --smoke, so a change to the generator cannot silently move a probe onto
 * whitespace and make a metric measure nothing.
 */
export function checkProbes(files, probes) {
    const line = p => (files.get(p.file) ?? '').split('\n')[p.line] ?? '';
    const at = p => line(p).slice(p.character).startsWith(p.expect);
    const before = p => line(p).slice(0, p.character).endsWith(p.expect);
    const failures = [];
    for (const name of ['hover', 'definition', 'references', 'rename']) if (!at(probes[name])) failures.push(name);
    for (const name of ['completion', 'signatureHelp']) if (!before(probes[name])) failures.push(name);
    if (!files.has(probes.document)) failures.push('document');
    if (line(probes.changeInsert) === '' && !files.has(probes.changeInsert.file)) failures.push('changeInsert');
    return failures;
}
