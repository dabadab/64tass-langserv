import { describe, it, expect } from 'vitest';
import { parseAssemblerOutput, toDiagnostics, chooseRoots, detectRootPragma, mergeDiagnostics } from '../../src/server/assembler';
import { DiagnosticSeverity } from 'vscode-languageserver/node';

describe('parseAssemblerOutput', () => {
    it('reads the file, position, severity and text', () => {
        const messages = parseAssemblerOutput(
            "main.asm:12:9: error: general syntax\n main.asm line\n         ^\n" +
            "sub.inc:3:1: warning: label not on left side [-Wlabel-left]\n");
        expect(messages).toEqual([
            { file: 'main.asm', line: 12, column: 9, severity: 'error', message: 'general syntax' },
            { file: 'sub.inc', line: 3, column: 1, severity: 'warning', message: 'label not on left side [-Wlabel-left]' },
        ]);
    });

    it('ignores everything that is not a message line', () => {
        expect(parseAssemblerOutput('64tass Turbo Assembler Macro V1.60.3243\nPasses: 2\n')).toEqual([]);
    });
});

describe('toDiagnostics', () => {
    const messages = parseAssemblerOutput(
        'main.asm:2:5: error: bad thing\nsub/other.inc:7:3: error: other thing\n');

    it('files each message against the file it came from', () => {
        const byUri = toDiagnostics(messages, '/proj');
        expect([...byUri.keys()]).toEqual(['file:///proj/main.asm', 'file:///proj/sub/other.inc']);
    });

    it('converts to zero-based positions', () => {
        const [diagnostic] = toDiagnostics(messages, '/proj').get('file:///proj/main.asm')!;
        expect(diagnostic.range.start).toEqual({ line: 1, character: 4 });
        expect(diagnostic.severity).toBe(DiagnosticSeverity.Error);
        expect(diagnostic.source).toBe('64tass build');
    });

    it('folds a note into the message it belongs to', () => {
        // 64tass points at the original of a duplicate with a following note.
        const withNote = parseAssemblerOutput(
            "main.asm:5:1: error: duplicate definition 'lbl'\nmain.asm:2:1: note: original definition here\n");
        const [diagnostic] = toDiagnostics(withNote, '/proj').get('file:///proj/main.asm')!;
        expect(diagnostic.message).toBe("duplicate definition 'lbl' (original definition here)");
        expect(toDiagnostics(withNote, '/proj').get('file:///proj/main.asm')).toHaveLength(1);
    });

    it('marks a warning as a warning', () => {
        const warned = parseAssemblerOutput('main.asm:1:1: warning: careful\n');
        expect(toDiagnostics(warned, '/proj').get('file:///proj/main.asm')![0].severity)
            .toBe(DiagnosticSeverity.Warning);
    });
});

describe('choosing what to assemble', () => {
    it('follows a root pragma, relative to the file holding it', () => {
        expect(detectRootPragma('        nop\n; 64tass-langserv: root ../build/main.asm\n'))
            .toBe('../build/main.asm');
        expect(chooseRoots('file:///proj/inc/part.inc', '; 64tass-langserv: root ../main.asm', []))
            .toEqual(['/proj/main.asm']);
    });

    it('assembles the single root that includes the file', () => {
        expect(chooseRoots('file:///proj/part.inc', '', ['file:///proj/main.asm']))
            .toEqual(['/proj/main.asm']);
    });

    it('assembles the file itself when nothing includes it', () => {
        expect(chooseRoots('file:///proj/main.asm', '', [])).toEqual(['/proj/main.asm']);
    });

    it('assembles every root when several include the file', () => {
        // A header shared by two programs belongs to both, and an error it causes
        // in either is real - the same set symbol resolution treats as one unit.
        expect(chooseRoots('file:///proj/part.inc', '', ['file:///proj/b.asm', 'file:///proj/a.asm']))
            .toEqual(['/proj/a.asm', '/proj/b.asm']);
    });

    it('ignores the file appearing in its own root list', () => {
        expect(chooseRoots('file:///proj/main.asm', '', ['file:///proj/main.asm', 'file:///proj/top.asm']))
            .toEqual(['/proj/top.asm']);
    });

    it('gives up on a URI it cannot turn into a path', () => {
        expect(chooseRoots('untitled:Untitled-1', '', [])).toEqual([]);
    });
});

describe('mergeDiagnostics', () => {
    const run = (uri: string, message: string) =>
        toDiagnostics(parseAssemblerOutput(`${uri}:1:1: error: ${message}\n`), '/proj');

    it('keeps what every run said about the same file', () => {
        // A header assembled as part of two programs can be wrong in both.
        const merged = mergeDiagnostics([run('shared.inc', 'first program'), run('shared.inc', 'second program')]);
        expect(merged.get('file:///proj/shared.inc')?.map(d => d.message))
            .toEqual(['first program', 'second program']);
    });

    it('keeps files only one run mentioned', () => {
        const merged = mergeDiagnostics([run('a.asm', 'in a'), run('b.asm', 'in b')]);
        expect([...merged.keys()]).toEqual(['file:///proj/a.asm', 'file:///proj/b.asm']);
    });

    it('is empty for no runs at all', () => {
        expect(mergeDiagnostics([]).size).toBe(0);
    });
});
