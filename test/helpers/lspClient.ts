import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import {
    createMessageConnection, MessageConnection,
    StreamMessageReader, StreamMessageWriter,
} from 'vscode-jsonrpc/node';

const SERVER = path.join(__dirname, '..', '..', 'out', 'server', 'server.js');

/** True once `yarn compile` has produced the bundled server. */
export const SERVER_BUILT = fs.existsSync(SERVER);

/**
 * A real language server in a child process, talked to over stdio exactly as the
 * editor does.
 *
 * This is the only thing that exercises `src/server/server.ts`: it calls
 * `createConnection()` at module load, so it cannot be imported from a test. The
 * modules under it are unit-tested directly; what is left to check here is the
 * wiring - that each capability is declared, routed to the right module, and
 * answered in the shape the protocol expects.
 */
/** As much of a diagnostic as the protocol tests look at. */
export interface PublishedDiagnostic {
    message: string;
    code?: string | number;
    severity?: number;
}

export class TestServer {
    private constructor(
        private readonly child: cp.ChildProcess,
        readonly connection: MessageConnection,
        readonly workspace: string,
        private version = 1,
    ) {}

    static async start(files: Record<string, string> = {}, settings: Record<string, unknown> = {}): Promise<TestServer> {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), '64tass-lsp-'));
        for (const [name, content] of Object.entries(files)) {
            const full = path.join(workspace, name);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, content);
        }

        const child = cp.spawn(process.execPath, [SERVER, '--stdio'], { stdio: 'pipe' });
        const connection = createMessageConnection(
            new StreamMessageReader(child.stdout!),
            new StreamMessageWriter(child.stdin!),
        );
        // The server asks for its configuration; answer with the test's settings so
        // the handlers see a resolved config rather than hanging on it.
        connection.onRequest('workspace/configuration', () => [{
            caseSensitive: false, cpu: '6502', includePaths: [], ...settings,
        }]);
        connection.onRequest('client/registerCapability', () => null);
        connection.listen();

        return new TestServer(child, connection, workspace);
    }

    uriOf(name: string): string {
        return pathToFileURL(path.join(this.workspace, name)).toString();
    }

    async initialize(): Promise<Record<string, unknown>> {
        const result = await this.connection.sendRequest('initialize', {
            processId: process.pid,
            rootUri: pathToFileURL(this.workspace).toString(),
            workspaceFolders: [{ uri: pathToFileURL(this.workspace).toString(), name: 'test' }],
            capabilities: { workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } } },
        }) as { capabilities: Record<string, unknown> };
        await this.connection.sendNotification('initialized', {});
        return result.capabilities;
    }

    /** Open a document and wait until its diagnostics have been published. */
    async open(name: string, text: string): Promise<void> {
        const uri = this.uriOf(name);
        const published = this.nextDiagnostics(uri);
        await this.connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId: '64tass', version: this.version++, text },
        });
        await published;
    }

    /** Resolve with the next diagnostics published for a URI. */
    nextDiagnostics(uri: string, timeoutMs = 10000): Promise<PublishedDiagnostic[]> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                disposable.dispose();
                reject(new Error(`no diagnostics published for ${uri} within ${timeoutMs}ms`));
            }, timeoutMs);
            const disposable = this.connection.onNotification('textDocument/publishDiagnostics', (params: {
                uri: string; diagnostics: PublishedDiagnostic[];
            }) => {
                if (params.uri !== uri) return;
                clearTimeout(timer);
                disposable.dispose();
                resolve(params.diagnostics);
            });
        });
    }

    request<T>(method: string, params: unknown): Promise<T> {
        return this.connection.sendRequest(method, params) as Promise<T>;
    }

    /** A position params object for a document. */
    at(name: string, line: number, character: number) {
        return { textDocument: { uri: this.uriOf(name) }, position: { line, character } };
    }

    async stop(): Promise<void> {
        try { await this.connection.sendRequest('shutdown', null); } catch { /* already gone */ }
        try { await this.connection.sendNotification('exit'); } catch { /* already gone */ }
        this.connection.dispose();
        this.child.kill();
        fs.rmSync(this.workspace, { recursive: true, force: true });
    }
}
