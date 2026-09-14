/**
 * A language client for one server process, talked to over stdio the way the
 * editor does. A plain-JS port of test/helpers/lspClient.ts with what a
 * benchmark needs on top: timing on every exchange, log capture, and a clear
 * failure when the server dies or stops answering.
 *
 * Two rules keep the numbers honest:
 *   - a null metric means "this server does not have the capability", never
 *     "it did not answer": every wait has a timeout, and a timeout FAILS the run;
 *   - a waiter for publishDiagnostics is registered BEFORE the notification
 *     that provokes it is sent, so a fast server cannot answer into the void.
 */
import * as cp from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    createMessageConnection, StreamMessageReader, StreamMessageWriter, ResponseError, ErrorCodes,
} from 'vscode-jsonrpc/node.js';

export class BenchTimeoutError extends Error {}
export class ServerExitedError extends Error {}

/** The settings the server asks for; keys a version does not know are ignored by its readSettings. */
export const DEFAULT_SETTINGS = {
    caseSensitive: false,
    cpu: '6502i',
    includePaths: [],
    assemblerPath: '',
    assemblerArgs: [],
    unusedSymbols: true,
    cycleCounts: true,
    format: { mnemonicColumn: 8, operandColumn: 12, commentColumn: 40 },
};

const STDERR_TAIL = 50;

function now() {
    return performance.now();
}

export class LspClient {
    /** @private use LspClient.spawn */
    constructor(child, connection, rootDir) {
        this.child = child;
        this.connection = connection;
        this.rootDir = rootDir;
        this.capabilities = {};
        this.version = 1;
        this.log = [];
        this.logWaiters = [];
        this.diagnosticWaiters = new Map();
        this.unsolicitedDiagnostics = 0;
        this.exited = null;
        this.stderr = [];
        this.pending = new Set();
    }

    /**
     * Start `node <serverPath> --stdio` with the given cwd (the measured
     * worktree, so an unbundled tsc-era server finds its own node_modules).
     */
    static spawn({ serverPath, cwd, rootDir, settings = DEFAULT_SETTINGS, nodePath = process.execPath }) {
        const child = cp.spawn(nodePath, [serverPath, '--stdio'], { cwd, stdio: 'pipe' });
        const connection = createMessageConnection(
            new StreamMessageReader(child.stdout),
            new StreamMessageWriter(child.stdin),
        );
        const client = new LspClient(child, connection, rootDir);

        child.stderr.setEncoding('utf8');
        child.stderr.on('data', chunk => {
            for (const line of chunk.split('\n')) {
                if (line === '') continue;
                client.stderr.push(line);
                if (client.stderr.length > STDERR_TAIL) client.stderr.shift();
            }
        });
        child.on('exit', (code, signal) => client.onExit(code, signal));

        // All passive: an old server never sends these, a new one must not wait.
        connection.onRequest('workspace/configuration', () => [settings]);
        connection.onRequest('client/registerCapability', () => null);
        connection.onRequest('client/unregisterCapability', () => null);
        connection.onRequest('window/workDoneProgress/create', () => null);
        connection.onNotification('window/logMessage', params => client.onLog(params));
        connection.onNotification('textDocument/publishDiagnostics', params => client.onDiagnostics(params));
        connection.onClose(() => client.onExit(client.exited?.code ?? null, client.exited?.signal ?? 'connection closed'));
        connection.listen();
        return client;
    }

    get pid() {
        return this.child.pid;
    }

    uriOf(rel) {
        return pathToFileURL(path.join(this.rootDir, rel)).toString();
    }

    onExit(code, signal) {
        if (this.exited) return;
        this.exited = { code, signal, stderr: [...this.stderr] };
        const error = new ServerExitedError(
            `server exited (code ${code}, signal ${signal})\n${this.exited.stderr.join('\n')}`);
        for (const reject of this.pending) reject(error);
        this.pending.clear();
    }

    onLog(params) {
        const entry = { t: now(), type: params.type, message: params.message };
        this.log.push(entry);
        for (const waiter of [...this.logWaiters]) {
            const match = entry.message.match(waiter.regex);
            if (match) {
                this.logWaiters.splice(this.logWaiters.indexOf(waiter), 1);
                waiter.resolve({ match, entry });
            }
        }
    }

    onDiagnostics(params) {
        const queue = this.diagnosticWaiters.get(params.uri);
        if (!queue || queue.length === 0) {
            this.unsolicitedDiagnostics++;
            return;
        }
        queue.shift().resolve(params);
    }

    /** Race a promise against the clock; the loser is a failed run, never a null. */
    withTimeout(promise, ms, label) {
        return new Promise((resolve, reject) => {
            if (this.exited) return reject(new ServerExitedError(`server already exited before ${label}`));
            const timer = setTimeout(() => {
                this.pending.delete(fail);
                reject(new BenchTimeoutError(`${label} did not complete within ${ms}ms`));
            }, ms);
            const fail = error => { clearTimeout(timer); reject(error); };
            this.pending.add(fail);
            promise.then(
                value => { clearTimeout(timer); this.pending.delete(fail); resolve(value); },
                error => { clearTimeout(timer); this.pending.delete(fail); reject(error); },
            );
        });
    }

    async initialize({ timeoutMs = 30000 } = {}) {
        const rootUri = pathToFileURL(this.rootDir).toString();
        const t0 = now();
        const result = await this.withTimeout(this.connection.sendRequest('initialize', {
            processId: process.pid,
            rootUri,
            workspaceFolders: [{ uri: rootUri, name: 'bench' }],
            // Configuration support so the server reads settings from us; no
            // file watching, since nothing here would ever serve a watcher.
            capabilities: {
                workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } },
                textDocument: {},
            },
        }), timeoutMs, 'initialize');
        const elapsedMs = now() - t0;
        this.capabilities = result.capabilities ?? {};
        return { capabilities: this.capabilities, elapsedMs };
    }

    /** Marks the moment the server may start its background work. */
    initialized() {
        this.initializedAt = now();
        return this.connection.sendNotification('initialized', {});
    }

    hasCapability(name) {
        const value = this.capabilities[name];
        return value !== undefined && value !== null && value !== false;
    }

    /** 0 none, 1 full, 2 incremental - as a number or as `{ change }`. */
    textDocumentSyncKind() {
        const sync = this.capabilities.textDocumentSync;
        if (typeof sync === 'number') return sync;
        if (sync && typeof sync === 'object' && typeof sync.change === 'number') return sync.change;
        return 1;
    }

    /**
     * Wait for a log line matching `regex`, searching what has already arrived
     * first so a server that logged before we asked is not waited on twice.
     */
    waitLog(regex, timeoutMs) {
        for (const entry of this.log) {
            const match = entry.message.match(regex);
            if (match) return Promise.resolve({ match, entry });
        }
        return this.withTimeout(new Promise(resolve => this.logWaiters.push({ regex, resolve })), timeoutMs, `log ${regex}`);
    }

    /** The next publishDiagnostics for `uri`. Register BEFORE provoking it. */
    nextDiagnostics(uri, timeoutMs) {
        let waiter;
        const promise = new Promise(resolve => { waiter = { resolve }; });
        if (!this.diagnosticWaiters.has(uri)) this.diagnosticWaiters.set(uri, []);
        this.diagnosticWaiters.get(uri).push(waiter);
        return this.withTimeout(promise, timeoutMs, `diagnostics for ${uri}`);
    }

    /**
     * Open a document. Resolves once its diagnostics were published, with the
     * time that took, and with `then`: a hook run right after the notification
     * is sent, so a request can be queued behind the synchronous indexing.
     */
    async open(rel, text, { timeoutMs = 60000, after } = {}) {
        const uri = this.uriOf(rel);
        this.texts ??= new Map();
        this.texts.set(rel, text);
        const published = this.nextDiagnostics(uri, timeoutMs);
        const t0 = now();
        await this.connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId: '64tass', version: this.version++, text },
        });
        const afterResult = after ? after(t0) : undefined;
        const diagnostics = await published;
        const toDiagnosticsMs = now() - t0;
        return { toDiagnosticsMs, diagnostics: diagnostics.diagnostics, after: await afterResult };
    }

    /**
     * Apply one edit and wait for the diagnostics it triggers. Incremental when
     * the server declared it; otherwise the whole new text is sent.
     */
    async change(rel, { range, text }, { timeoutMs = 60000 } = {}) {
        const uri = this.uriOf(rel);
        const current = this.texts.get(rel);
        const updated = applyEdit(current, range, text);
        this.texts.set(rel, updated);
        const contentChanges = this.textDocumentSyncKind() === 2 ? [{ range, text }] : [{ text: updated }];
        const published = this.nextDiagnostics(uri, timeoutMs);
        const t0 = now();
        await this.connection.sendNotification('textDocument/didChange', {
            textDocument: { uri, version: this.version++ },
            contentChanges,
        });
        await published;
        return { toDiagnosticsMs: now() - t0 };
    }

    /**
     * Send a request and time the answer. MethodNotFound is reported as
     * `unsupported` rather than thrown: a server may declare a capability it
     * cannot answer, or answer one it never declared (the custom cycleCounts
     * request has no capability at all).
     */
    async request(method, params, { timeoutMs = 30000 } = {}) {
        const t0 = now();
        try {
            const result = await this.withTimeout(this.connection.sendRequest(method, params), timeoutMs, method);
            return { result, ms: now() - t0, unsupported: false };
        } catch (error) {
            if (error instanceof ResponseError && error.code === ErrorCodes.MethodNotFound) {
                return { result: null, ms: now() - t0, unsupported: true };
            }
            throw error;
        }
    }

    /** Resident set size of the server process in MB, Linux only. */
    rssMB() {
        try {
            const status = readFileSync(`/proc/${this.child.pid}/status`, 'utf8');
            const kb = Number(status.match(/^VmRSS:\s+(\d+) kB/m)?.[1]);
            return Number.isFinite(kb) ? Math.round(kb / 1024 * 10) / 10 : null;
        } catch {
            return null;
        }
    }

    async shutdown() {
        if (!this.exited) {
            try { await this.withTimeout(this.connection.sendRequest('shutdown', null), 5000, 'shutdown'); } catch { /* gone */ }
            try { await this.connection.sendNotification('exit'); } catch { /* gone */ }
            await new Promise(resolve => {
                const timer = setTimeout(() => { this.child.kill('SIGKILL'); resolve(); }, 2000);
                this.child.once('exit', () => { clearTimeout(timer); resolve(); });
                if (this.exited) { clearTimeout(timer); resolve(); }
            });
        }
        this.connection.dispose();
    }
}

/** Apply an LSP range edit to text, for keeping the client's copy in step. */
export function applyEdit(text, range, replacement) {
    const lines = text.split('\n');
    const offset = ({ line, character }) => {
        let n = 0;
        for (let i = 0; i < line && i < lines.length; i++) n += lines[i].length + 1;
        return n + character;
    };
    return text.slice(0, offset(range.start)) + replacement + text.slice(offset(range.end));
}
