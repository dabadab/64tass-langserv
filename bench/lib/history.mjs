/**
 * Benchmark past refs: each is checked out into a git worktree, installed,
 * built and measured with THIS checkout's harness. That is what makes a series
 * reproducible on new hardware - the whole history can be re-run in one go.
 *
 * Old releases differ in two ways the loop has to absorb: v0.6.0 and v0.7.0
 * build with `tsc -b` and run unbundled from their own node_modules (so the
 * server is started with the worktree as cwd), and early servers lack most
 * capabilities, which the measurement records as null.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RunError } from './measure.mjs';
import { appendResult, RESULTS_FILE } from './results.mjs';

function git(repo, ...args) {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Every v* tag, oldest first. */
export function releaseTags(repo) {
    const out = git(repo, 'tag', '--list', 'v*', '--sort=creatordate');
    return out === '' ? [] : out.split('\n');
}

function sh(cmd, args, cwd, log) {
    log(`  $ ${cmd} ${args.join(' ')}`);
    const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) {
        const tail = `${result.stdout}${result.stderr}`.trim().split('\n').slice(-20).join('\n');
        throw new Error(`${cmd} ${args.join(' ')} failed (exit ${result.status}) in ${cwd}:\n${tail}`);
    }
}

/**
 * Install and build one worktree; returns the build script used so the record
 * says whether it measured the production bundle or a tsc build.
 */
export function buildWorktree(worktree, log) {
    // yarn.lock is not committed, so this resolves fresh every time and a
    // later run may get newer transitive versions - hence the dependency
    // versions recorded in every result. --ignore-engines because the .yarnrc
    // that turns engine checks off only exists from v0.10.1.
    sh('yarn', ['install', '--silent', '--non-interactive', '--ignore-engines'], worktree, log);
    const scripts = JSON.parse(readFileSync(path.join(worktree, 'package.json'), 'utf8')).scripts ?? {};
    const buildScript = scripts['compile:prod'] ? 'compile:prod' : 'compile';
    if (!scripts[buildScript]) throw new Error(`no compile script in ${worktree}/package.json`);
    sh('yarn', ['--silent', '--ignore-engines', buildScript], worktree, log);
    const serverPath = path.join(worktree, 'out', 'server', 'server.js');
    if (!existsSync(serverPath)) throw new Error(`${buildScript} produced no out/server/server.js in ${worktree}`);
    return { buildScript, serverPath };
}

export async function history(refs, { repo, runs, reps, warmup, scale, save, keep, label, scanWait, measureTarget, log = console.error }) {
    const targets = refs.length > 0 ? refs : releaseTags(repo);
    if (targets.length === 0) throw new Error('no refs given and no v* tags found');
    const base = mkdtempSync(path.join(os.tmpdir(), 'bench-worktrees-'));
    const failed = [];
    log(`benchmarking ${targets.length} ref(s): ${targets.join(' ')}`);
    for (const ref of targets) {
        const worktree = path.join(base, ref.replace(/[^A-Za-z0-9._-]/g, '_'));
        log(`\n== ${ref}`);
        try {
            sh('git', ['worktree', 'add', '--detach', worktree, ref], repo, log);
            const { buildScript, serverPath } = buildWorktree(worktree, log);
            const record = await measureTarget({
                serverPath, cwd: worktree, scale, runs, reps, warmup, scanWait, label, buildScript, log,
            });
            const m = record.metrics;
            log(`  ${record.target.describe}: startup ${m.startupMs?.median} ms, open ${m['open.toDiagnosticsMs']?.median} ms, hover ${m.hoverMs?.median ?? '-'} ms`);
            if (save) {
                appendResult(record);
                log(`  saved ${record.target.describe} to ${path.relative(process.cwd(), RESULTS_FILE)}`);
            }
        } catch (error) {
            failed.push(ref);
            log(`  FAILED: ${error.message}`);
            if (error instanceof RunError && error.stderr.length > 0) log('  server stderr:\n  ' + error.stderr.join('\n  '));
        } finally {
            if (!keep) {
                try { sh('git', ['worktree', 'remove', '--force', worktree], repo, () => {}); } catch { rmSync(worktree, { recursive: true, force: true }); }
            }
        }
    }
    try { git(repo, 'worktree', 'prune'); } catch { /* nothing to prune */ }
    if (keep) log(`worktrees kept under ${base}`);
    else rmSync(base, { recursive: true, force: true });
    if (failed.length > 0) {
        log(`\n${failed.length} ref(s) failed: ${failed.join(' ')}`);
        process.exitCode = 1;
    }
}
