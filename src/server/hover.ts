import { Hover, MarkupKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentIndex } from './types';
import { findSymbolInfo } from './symbols';
import { opcodesForCpu, DEFAULT_CPU, CLOSING_DIRECTIVES } from './constants';
import { addressingModesFor } from './addressing';
import { opcodeDoc } from './opcodeDocs';
import { cyclesFor, hasCycleData, formatCycles, CycleVariance } from './cycles';
import { parseNumericValue, formatNumericValue, stripStrings, parseLineStructure } from './utils';
import { computeFoldingRanges } from './folding';
import { pragmaHover } from './pragmas';
import { DIRECTIVE_DOCS } from './directiveDocs';

const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/**
 * Hover for a mnemonic: what it does, and the addressing modes it has on the CPU
 * this file targets, with each form's opcode byte and length.
 *
 * A symbol always wins over an opcode, because a label may legitimately be named
 * after one - `inc` is a plausible variable name, and the definition is the more
 * useful answer when both exist.
 */
export function opcodeHover(word: string, cpu: string): Hover | null {
    const mnemonic = word.toLowerCase();
    if (!opcodesForCpu(cpu).has(mnemonic)) return null;

    const doc = opcodeDoc(mnemonic);
    const modes = addressingModesFor(cpu, mnemonic);

    const lines = [`**${mnemonic.toUpperCase()}**${doc?.undocumented ? ' *(undocumented)*' : ''}`];
    if (doc) lines.push('', doc.summary + '.');
    if (doc?.flags) lines.push('', `Flags: \`${doc.flags.split('').join(' ')}\``);

    if (modes.length > 0) {
        // Cycles are the interesting number, but they are only known for the NMOS
        // targets; elsewhere the instruction length is shown instead so the column
        // is never empty.
        const timed = hasCycleData(cpu);
        const seen = new Set<CycleVariance>();

        lines.push('', `Addressing modes on \`${cpu}\`:`, '',
            `| Operand | Opcode | ${timed ? 'Cycles' : 'Bytes'} |`, '| --- | --- | --- |');
        for (const [pattern, opcode, length] of modes) {
            let cell = String(length);
            if (timed) {
                const timing = cyclesFor(cpu, opcode);
                cell = timing ? formatCycles(timing.cycles, timing.variance) : '?';
                if (timing) seen.add(timing.variance);
            }
            lines.push(`| \`${pattern || '(implied)'}\` | \`$${hex(opcode)}\` | ${cell} |`);
        }

        // Only explain the markers actually used above.
        if (seen.has('page')) lines.push('', '`*` +1 cycle if the indexed address crosses a page boundary');
        if (seen.has('branch')) lines.push('', '`**` +1 cycle if the branch is taken, +2 if it also crosses a page');
        if (seen.has('jam')) lines.push('', '`--` locks the processor up');
    }

    return { contents: { kind: MarkupKind.Markdown, value: lines.join('\n') } };
}

/**
 * Hover for a block-closing directive: which scope it ends, and where that
 * started.
 *
 * A long `.proc` can put its `.pend` a screen or more away from the name, which
 * is exactly when it is worth asking. The opener is found with the same matching
 * `computeFoldingRanges` does, so hover and folding can never disagree about
 * which opener a closer belongs to.
 *
 * MUST be tried before symbolHover: that strips a leading dot to look a macro up,
 * so a symbol happening to be called `pend` would otherwise answer for `.pend`.
 */
export function closerHover(
    word: string,
    text: string,
    line: number,
    uri: string,
    documentIndex: Map<string, DocumentIndex>
): Hover | null {
    const closer = word.toLowerCase();
    const openers = CLOSING_DIRECTIVES[closer];
    if (!openers) return null;

    const region = computeFoldingRanges(text).find(range => range.endLine === line);
    if (!region) return null;   // unmatched; diagnostics reports that separately

    const lines = text.split('\n');
    const openerText = lines[region.startLine] ?? '';
    const openerCode = stripStrings(parseLineStructure(openerText).code).toLowerCase();
    // Safe: directive names come from the static CLOSING_DIRECTIVES table.
    const directive = openers.find(open => new RegExp(`(?:^|\\s)\\${open}\\b`).test(openerCode));

    // The parser records a scope opener's label with the directive as its kind, so
    // requiring that is what separates a real scope name from another label that
    // merely shares the line - `.for i = 0, ...` records `i` as a loop VARIABLE,
    // and calling it the name of the block would be wrong.
    const scopeKind = directive?.slice(1);
    const named = scopeKind
        ? documentIndex.get(uri)?.labels.find(label =>
            label.range.start.line === region.startLine && label.kind === scopeKind)
        : undefined;

    // The closer already says what kind of scope it is, so only the name and the
    // line are worth stating.
    const opened = `opened on line ${region.startLine + 1}`;
    const content = named
        ? `**${closer}**\n\nCloses **${named.originalName}**, ${opened}.`
        : `**${closer}**\n\n${opened.charAt(0).toUpperCase()}${opened.slice(1)}.`;

    return { contents: { kind: MarkupKind.Markdown, value: content } };
}

/** Hover for a label: where it is defined, its doc comment and its value. */
export function symbolHover(
    word: string,
    uri: string,
    line: number,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive: boolean
): Hover | null {
    const symbol = findSymbolInfo(word, uri, line, documentIndex, caseSensitive);
    if (!symbol) return null;

    let content = `**${symbol.originalName}**`;
    if (symbol.scopePath) content += ` *(in ${symbol.scopePath})*`;
    if (symbol.comment) content += `\n\n\`\`\`text\n${symbol.comment}\n\`\`\``;
    if (symbol.value) {
        const numValue = parseNumericValue(symbol.value);
        content += numValue !== null
            ? `\n\n\`= ${formatNumericValue(numValue)}\``
            // Not a simple numeric value, show as-is
            : `\n\n\`= ${symbol.value}\``;
    }

    return { contents: { kind: MarkupKind.Markdown, value: content } };
}

/**
 * Hover for one of the assembler's own directives.
 *
 * Ranked above symbolHover because the assembler ranks it there too: a macro
 * named `byte` does NOT take over `.byte`, which still emits a byte (verified).
 * The text is the manual's, quoted rather than rewritten - what a directive means
 * cannot be probed the way its opcode tables can, so there is no second source to
 * check a paraphrase against.
 */
export function directiveHover(word: string): Hover | null {
    const doc = DIRECTIVE_DOCS[word.toLowerCase()];
    if (!doc) return null;
    return {
        contents: {
            kind: MarkupKind.Markdown,
            value: [
                '```',
                doc.syntax,
                '```',
                '',
                doc.description,
                '',
                '*From the [64tass manual](https://tass64.sourceforge.net/).*',
            ].join('\n')
        }
    };
}

/** Hover for a word: a pragma, a block closer, a directive, a symbol, else a mnemonic. */
export function buildHover(
    word: string,
    document: TextDocument,
    line: number,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive: boolean,
    cpu: string = DEFAULT_CPU
): Hover | null {
    // The pragma comes first: its line is a comment, so nothing else would answer
    // for it, and a word inside one ("cpu", "root") could otherwise be looked up
    // as a symbol.
    return pragmaHover(document.getText().split('\n')[line] ?? '', line)
        ?? closerHover(word, document.getText(), line, document.uri, documentIndex)
        ?? directiveHover(word)
        ?? symbolHover(word, document.uri, line, documentIndex, caseSensitive)
        ?? opcodeHover(word, cpu);
}
