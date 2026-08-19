import { Hover, MarkupKind } from 'vscode-languageserver/node';
import { DocumentIndex } from './types';
import { findSymbolInfo } from './symbols';
import { opcodesForCpu, DEFAULT_CPU } from './constants';
import { addressingModesFor } from './addressing';
import { opcodeDoc } from './opcodeDocs';
import { parseNumericValue, formatNumericValue } from './utils';

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
        lines.push('', `Addressing modes on \`${cpu}\`:`, '', '| Operand | Opcode | Bytes |', '| --- | --- | --- |');
        for (const [pattern, opcode, length] of modes) {
            lines.push(`| \`${pattern || '(implied)'}\` | \`$${hex(opcode)}\` | ${length} |`);
        }
    }

    return { contents: { kind: MarkupKind.Markdown, value: lines.join('\n') } };
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

/** Hover for a word: a symbol if one resolves, otherwise a mnemonic. */
export function buildHover(
    word: string,
    uri: string,
    line: number,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive: boolean,
    cpu: string = DEFAULT_CPU
): Hover | null {
    return symbolHover(word, uri, line, documentIndex, caseSensitive)
        ?? opcodeHover(word, cpu);
}
