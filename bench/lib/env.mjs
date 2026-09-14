/**
 * What produced a measurement: the code, the machine and the runtime.
 *
 * Numbers are only comparable on one machine, so every record carries a
 * machine id derived from the hardware rather than the hostname - a renamed
 * laptop is the same machine, a replaced one is not.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function git(dir, ...args) {
    try {
        return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return null;
    }
}

/** The git state of a checkout: describe (tag or short sha), full sha, dirty flag. */
export function describeRepo(dir) {
    const commit = git(dir, 'rev-parse', 'HEAD');
    if (commit === null) return { describe: 'unknown', commit: null, dirty: false };
    // The whole tree, not just src/: a changed fixture or dependency list is
    // just as much a reason for a number to be unreproducible.
    const dirty = (git(dir, 'status', '--porcelain', '--untracked-files=no') ?? '') !== '';
    const described = git(dir, 'describe', '--tags', '--always') ?? commit.slice(0, 7);
    return { describe: dirty ? `${described}-dirty` : described, commit, dirty };
}

/** Hardware and runtime of this host. */
export function machineInfo() {
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model?.trim() ?? 'unknown';
    const cores = cpus.length;
    const totalMemGB = Math.round(os.totalmem() / 2 ** 30);
    const info = {
        node: process.version,
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpuModel,
        cores,
        totalMemGB,
        loadavg1: Math.round(os.loadavg()[0] * 100) / 100,
    };
    return { ...info, machineId: machineId(info) };
}

/** Short stable hash of the hardware, ignoring hostname and OS patch level. */
export function machineId({ cpuModel, cores, totalMemGB, platform, arch }) {
    return createHash('sha256')
        .update(`${cpuModel}|${cores}|${totalMemGB}|${platform}|${arch}`)
        .digest('hex')
        .slice(0, 12);
}

/**
 * Versions of the packages that end up inside (or under) the measured server.
 * Read from the measured worktree's own node_modules, because yarn.lock is not
 * committed and a re-run may resolve something newer.
 */
export function dependencyVersions(worktree) {
    const out = {};
    for (const name of ['vscode-languageserver', 'vscode-languageserver-textdocument', 'vscode-jsonrpc', 'typescript', 'esbuild']) {
        try {
            out[name] = JSON.parse(readFileSync(path.join(worktree, 'node_modules', name, 'package.json'), 'utf8')).version;
        } catch {
            out[name] = null;
        }
    }
    return out;
}

/** A busy machine makes every number noisier; say so before measuring. */
export function warnIfLoaded(info, log = console.error) {
    if (info.loadavg1 > info.cores / 2) {
        log(`warning: load average ${info.loadavg1} on ${info.cores} cores - results will be noisy`);
        return true;
    }
    return false;
}
