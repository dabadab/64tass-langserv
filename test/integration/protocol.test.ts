import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import { TestServer, SERVER_BUILT } from '../helpers/lspClient';

/**
 * End-to-end tests against a real language server process.
 *
 * These are the only coverage `src/server/server.ts` gets - it calls
 * createConnection() at module load and so cannot be imported. What is checked
 * here is the wiring rather than the logic: capabilities declared, requests
 * routed to the right module, responses shaped as the protocol expects.
 *
 * Needs `yarn compile` to have run; the suite skips with a warning otherwise.
 */
if (!SERVER_BUILT) {
    console.warn('[protocol] out/server/server.js not found - run `yarn compile`. Protocol tests SKIPPED.');
}

const SOURCE = [
    'counter = $10',                       // 0
    '',                                    // 1
    'start                                ; entry point',  // 2
    '        lda #<counter',               // 3
    '        jsr helper',                  // 4
    '        rts',                         // 5
    '',                                    // 6
    'helper  .proc',                       // 7
    'inner   lda #1',                      // 8
    '        rts',                         // 9
    '        .pend',                       // 10
].join('\n');

describe.skipIf(!SERVER_BUILT)('language server protocol', () => {
    let server: TestServer;
    let capabilities: Record<string, unknown>;

    beforeAll(async () => {
        server = await TestServer.start({ 'dep.asm': 'depsym = 1\n' });
        capabilities = await server.initialize();
        await server.open('main.asm', SOURCE);
    }, 30000);

    afterAll(async () => { await server?.stop(); });

    it('declares every capability it implements', () => {
        for (const capability of [
            'definitionProvider', 'referencesProvider', 'renameProvider', 'foldingRangeProvider',
            'hoverProvider', 'documentSymbolProvider', 'documentHighlightProvider',
            'semanticTokensProvider', 'workspaceSymbolProvider', 'signatureHelpProvider',
            'completionProvider', 'documentLinkProvider', 'selectionRangeProvider',
            'codeActionProvider',
        ]) {
            expect(capabilities[capability], capability).toBeTruthy();
        }
    });

    it('answers go-to-definition with the defining range', async () => {
        const location = await server.request<{ uri: string; range: { start: { line: number } } }>(
            'textDocument/definition', server.at('main.asm', 3, 18));
        expect(location.uri).toBe(server.uriOf('main.asm'));
        expect(location.range.start.line).toBe(0);
    });

    it('answers hover for a symbol', async () => {
        const hover = await server.request<{ contents: { value: string } }>(
            'textDocument/hover', server.at('main.asm', 3, 18));
        expect(hover.contents.value).toContain('counter');
    });

    it('answers hover for a mnemonic with its addressing modes', async () => {
        const hover = await server.request<{ contents: { value: string } }>(
            'textDocument/hover', server.at('main.asm', 3, 9));
        expect(hover.contents.value).toContain('LDA');
        expect(hover.contents.value).toContain('$A9');
    });

    it('answers hover for a block closer', async () => {
        // helper .proc is at line 7, its .pend at line 10
        const hover = await server.request<{ contents: { value: string } }>(
            'textDocument/hover', server.at('main.asm', 10, 10));
        expect(hover.contents.value).toContain('helper');
    });

    it('answers find-references', async () => {
        const locations = await server.request<{ range: { start: { line: number } } }[]>(
            'textDocument/references', { ...server.at('main.asm', 0, 2), context: { includeDeclaration: true } });
        expect(locations.map(l => l.range.start.line).sort((a, b) => a - b)).toEqual([0, 3]);
    });

    it('answers document symbols with the nested scope', async () => {
        const symbols = await server.request<{ name: string; children?: { name: string }[] }[]>(
            'textDocument/documentSymbol', { textDocument: { uri: server.uriOf('main.asm') } });
        const helper = symbols.find(s => s.name === 'helper');
        expect(helper).toBeDefined();
        expect(helper!.children?.map(c => c.name)).toContain('inner');
    });

    it('answers folding ranges', async () => {
        const ranges = await server.request<{ startLine: number; endLine: number }[]>(
            'textDocument/foldingRange', { textDocument: { uri: server.uriOf('main.asm') } });
        expect(ranges).toContainEqual(expect.objectContaining({ startLine: 7, endLine: 10 }));
    });

    it('answers completion', async () => {
        const result = await server.request<{ items: { label: string }[] } | { label: string }[]>(
            'textDocument/completion', server.at('main.asm', 3, 18));
        const items = Array.isArray(result) ? result : result.items;
        expect(items.map(i => i.label)).toContain('counter');
    });

    it('answers document links for an include', async () => {
        await server.open('withinc.asm', '        .include "dep.asm"\n');
        const links = await server.request<{ target: string }[]>(
            'textDocument/documentLink', { textDocument: { uri: server.uriOf('withinc.asm') } });
        expect(links).toHaveLength(1);
        expect(links[0].target).toBe(server.uriOf('dep.asm'));
    });

    it('answers selection ranges', async () => {
        const [range] = await server.request<{ range: unknown; parent?: unknown }[]>(
            'textDocument/selectionRange',
            { textDocument: { uri: server.uriOf('main.asm') }, positions: [{ line: 3, character: 18 }] });
        expect(range.parent).toBeDefined();
    });

    it('answers semantic tokens', async () => {
        const tokens = await server.request<{ data: number[] }>(
            'textDocument/semanticTokens/full', { textDocument: { uri: server.uriOf('main.asm') } });
        expect(tokens.data.length).toBeGreaterThan(0);
        expect(tokens.data.length % 5).toBe(0);
    });

    it('answers workspace symbols', async () => {
        const symbols = await server.request<{ name: string }[]>('workspace/symbol', { query: 'count' });
        expect(symbols.map(s => s.name)).toContain('counter');
    });

    it('answers prepare-rename and rename', async () => {
        const prepared = await server.request<unknown>('textDocument/prepareRename', server.at('main.asm', 0, 2));
        expect(prepared).not.toBeNull();

        const edit = await server.request<{ documentChanges?: unknown[]; changes?: Record<string, unknown[]> }>(
            'textDocument/rename', { ...server.at('main.asm', 0, 2), newName: 'total' });
        const edits = edit.documentChanges ?? Object.values(edit.changes ?? {});
        expect(edits.length).toBeGreaterThan(0);
    });

    it('answers document highlights', async () => {
        const highlights = await server.request<{ range: { start: { line: number } } }[]>(
            'textDocument/documentHighlight', server.at('main.asm', 0, 2));
        expect(highlights.length).toBeGreaterThanOrEqual(2);
    });

    it('publishes diagnostics for an undefined symbol, then clears them on edit', async () => {
        const uri = server.uriOf('broken.asm');
        // open() waits for the first publish, so capture it as it arrives.
        const first = server.nextDiagnostics(uri);
        await server.connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId: '64tass', version: 1, text: 'start\n        lda undefined_thing\n' },
        });
        expect((await first).map(d => d.code)).toContain('undefined-symbol');

        const cleared = server.nextDiagnostics(uri);
        await server.connection.sendNotification('textDocument/didChange', {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text: 'undefined_thing = 1\nstart\n        lda undefined_thing\n' }],
        });
        expect(await cleared).toEqual([]);
    }, 20000);

    it('offers a quick fix for a misspelled symbol', async () => {
        const uri = server.uriOf('typo.asm');
        await server.open('typo.asm', 'counter = 1\nstart\n        lda countor\n');

        // The client echoes the diagnostics it holds back with the request, which
        // is what the handler acts on.
        const actions = await server.request<{ title: string }[]>('textDocument/codeAction', {
            textDocument: { uri },
            range: { start: { line: 2, character: 12 }, end: { line: 2, character: 19 } },
            context: {
                diagnostics: [{
                    range: { start: { line: 2, character: 12 }, end: { line: 2, character: 19 } },
                    message: "Undefined symbol 'countor'",
                    severity: 2,
                    source: '64tass',
                    code: 'undefined-symbol',
                }],
            },
        });
        expect(actions.map(a => a.title)).toContain("Change to 'counter'");
    });

    it('keeps a file in the workspace index after it is closed', async () => {
        // The workspace scan only runs at startup, so deleting the entry on close
        // made the index shrink with every file opened and closed in a session.
        const uri = server.uriOf('closable.asm');
        fs.writeFileSync(new URL(uri), 'closable_symbol = 1\n');
        await server.connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId: '64tass', version: 1, text: 'closable_symbol = 1\n' },
        });
        await server.nextDiagnostics(uri).catch(() => null);

        await server.connection.sendNotification('textDocument/didClose', { textDocument: { uri } });
        await new Promise(resolve => setTimeout(resolve, 300));

        const symbols = await server.request<{ name: string }[]>('workspace/symbol', { query: 'closable' });
        expect(symbols.map(s => s.name)).toContain('closable_symbol');
    }, 20000);

    it('picks up a file created in the workspace', async () => {
        // The watcher skipped any URI not already indexed, so a git checkout or a
        // generated table was never seen.
        const uri = server.uriOf('created.asm');
        fs.writeFileSync(new URL(uri), 'created_symbol = 1\n');
        await server.connection.sendNotification('workspace/didChangeWatchedFiles', {
            changes: [{ uri, type: 1 }],   // 1 = Created
        });
        await new Promise(resolve => setTimeout(resolve, 300));

        const symbols = await server.request<{ name: string }[]>('workspace/symbol', { query: 'created' });
        expect(symbols.map(s => s.name)).toContain('created_symbol');
    }, 20000);

    it('answers signature help inside a macro call', async () => {
        await server.open('sig.asm', ['setup   .macro ptr, val', '        rts', '        .endm', 'start', '        #setup '].join('\n'));
        const help = await server.request<{ signatures: { label: string }[] } | null>(
            'textDocument/signatureHelp', server.at('sig.asm', 4, 15));
        expect(help?.signatures?.[0]?.label).toContain('ptr');
    });
});
