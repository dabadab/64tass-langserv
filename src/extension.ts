import * as path from 'path';
import {
    DecorationOptions,
    ExtensionContext,
    Range,
    TextDocument,
    TextEditor,
    TextEditorDecorationType,
    ThemeColor,
    window,
    workspace,
} from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';
import { CycleCount, columnText, columnWidth } from './client/cycleColumn';

let client: LanguageClient;

/** Collapses a burst of keystrokes into one refresh, as the server does for diagnostics. */
const REFRESH_DEBOUNCE_MS = 150;

/**
 * The cycle-count column, drawn immediately left of the code.
 *
 * Not VS Code's gutter: that is the glyph margin, which sits left of the line
 * numbers and takes an image rather than text. A `before` attachment on the first
 * character puts the numbers where the request was really aiming - a column of
 * their own between the folding arrows and the code - as real, themed text.
 */
function createColumnDecoration(): TextEditorDecorationType {
    return window.createTextEditorDecorationType({
        before: {
            color: new ThemeColor('editorLineNumber.foreground'),
            margin: '0 1ch 0 0',
        },
    });
}

function cycleColumnEnabled(): boolean {
    return workspace.getConfiguration('64tass').get<boolean>('cycleCounts', false);
}

export function activate(context: ExtensionContext) {
    const serverModule = context.asAbsolutePath(
        path.join('out', 'server', 'server.js')
    );

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] }
        }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: '64tass' }],
        synchronize: {}
    };

    client = new LanguageClient(
        '64tassLanguageServer',
        '64tass Language Server',
        serverOptions,
        clientOptions
    );

    const columnDecoration = createColumnDecoration();
    context.subscriptions.push(columnDecoration);

    const isOurs = (document: TextDocument) => document.languageId === '64tass';

    async function refresh(editor: TextEditor | undefined): Promise<void> {
        if (!editor || !isOurs(editor.document)) return;
        if (!cycleColumnEnabled()) {
            editor.setDecorations(columnDecoration, []);
            return;
        }

        const version = editor.document.version;
        let counts: CycleCount[];
        try {
            counts = await client.sendRequest<CycleCount[]>(
                '64tass/cycleCounts', { uri: editor.document.uri.toString() });
        } catch {
            return;   // server still starting, or gone: leave what is drawn alone
        }
        // Edited while the request was in flight: these counts belong to lines
        // that have moved. The change that overtook us has its own refresh coming.
        if (editor.document.version !== version) return;

        const width = columnWidth(counts);
        const byLine = new Map(counts.map(count => [count.line, count.text]));
        const decorations: DecorationOptions[] = [];
        for (let line = 0; line < editor.document.lineCount; line++) {
            const text = byLine.get(line);
            decorations.push({
                range: new Range(line, 0, line, 0),
                hoverMessage: text ? 'Cycles' : undefined,
                renderOptions: { before: { contentText: columnText(text, width) } },
            });
        }
        editor.setDecorations(columnDecoration, decorations);
    }

    const refreshAll = () => window.visibleTextEditors.forEach(editor => void refresh(editor));

    let pending: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        window.onDidChangeActiveTextEditor(editor => void refresh(editor)),
        window.onDidChangeVisibleTextEditors(refreshAll),
        workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('64tass.cycleCounts')) refreshAll();
        }),
        workspace.onDidChangeTextDocument(event => {
            if (!isOurs(event.document)) return;
            if (pending) clearTimeout(pending);
            pending = setTimeout(refreshAll, REFRESH_DEBOUNCE_MS);
        }),
        { dispose: () => { if (pending) clearTimeout(pending); } },
    );

    // The server has to be answering before the first request, and the editor is
    // usually already open by then.
    void client.start().then(refreshAll);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
