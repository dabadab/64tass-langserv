/**
 * Cycle counts shown at the end of each instruction line.
 *
 * The numbers come from `cycles.ts`, so they exist only for the NMOS targets -
 * elsewhere there is nothing honest to show and the line gets no hint. Which
 * count applies depends on the addressing mode the line actually assembles to,
 * so the operand has to be resolved to ONE opcode byte: `lda $10` is a zeropage
 * load and `lda $1234` an absolute one, and only the latter can cross a page.
 *
 * Where the mode cannot be pinned down - an operand whose value nothing here
 * knows - the hint appears only if every candidate agrees on the count. Guessing
 * a number the code does not take would be worse than showing none.
 */
import { InlayHint, InlayHintKind, Position, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentIndex } from './types';
import { opcodesForCpu } from './constants';
import { addressingModesFor } from './addressing';
import { cyclesFor, hasCycleData, formatCycles } from './cycles';
import { parseOperand } from './operands';
import { parseLineStructure } from './utils';
import { evaluateExpression } from './conditions';

/** Leading label (if any), then the instruction slot, then the rest. */
const LINE = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(:?)\s*(.*)$/;

/**
 * Split a line into mnemonic and operand, by the assembler's first-token rule:
 * the first word is the instruction when it is one, otherwise it is a label and
 * the second word is. Anchoring on a regex alone reads `jsr sub` as a label
 * called `jsr`, since `sub` is three letters too.
 */
function instructionOn(code: string, opcodes: ReadonlySet<string>): { mnemonic: string; operand: string } | null {
    const match = code.match(LINE);
    if (!match) return null;
    const [, first, colon, rest] = match;
    if (!colon && opcodes.has(first.toLowerCase())) return { mnemonic: first.toLowerCase(), operand: rest.trim() };

    const second = rest.match(LINE);
    if (!second || second[2] === ':') return null;
    return opcodes.has(second[1].toLowerCase())
        ? { mnemonic: second[1].toLowerCase(), operand: second[3].trim() }
        : null;
}

/** How many bytes the operand's value needs, or null when it cannot be told. */
function operandBytes(
    operand: string,
    uri: string,
    line: number,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive: boolean
): number | null {
    const text = operand.trim().replace(/^[#([]+/, '').replace(/[)\],].*$/, '').trim();
    if (text === '') return null;
    const value = evaluateExpression(text, uri, line, documentIndex, caseSensitive);
    if (value === null || value < 0) return null;
    if (value <= 0xff) return 1;
    if (value <= 0xffff) return 2;
    return 3;
}

/**
 * The cycle text for one instruction line, or null when there is none to give.
 */
export function cycleHintFor(
    code: string,
    uri: string,
    line: number,
    documentIndex: Map<string, DocumentIndex>,
    index: DocumentIndex
): string | null {
    if (!hasCycleData(index.cpu)) return null;

    const instruction = instructionOn(code, opcodesForCpu(index.cpu));
    if (instruction === null) return null;
    const { mnemonic, operand } = instruction;
    const written = parseOperand(operand);
    const modes = addressingModesFor(index.cpu, mnemonic).filter(([pattern]) => {
        const mode = parseOperand(pattern);
        if (mode.kind !== written.kind) return false;
        if (mode.kind !== 'address' || written.kind !== 'address') return true;
        return mode.shape.bracket === written.shape.bracket
            && mode.shape.inside === written.shape.inside
            && mode.shape.outside === written.shape.outside;
    });
    if (modes.length === 0) return null;

    // Narrow by operand width where the value is knowable: `$hh` forms take one
    // byte, `$hhhh` two. A relative branch has neither and needs no narrowing.
    const bytes = operandBytes(operand, uri, line, documentIndex, index.caseSensitive);
    const sized = bytes === null
        ? modes
        : modes.filter(([pattern]) => {
            const width = (pattern.match(/\$h+/)?.[0].length ?? 1) - 1;
            return width === 0 || width / 2 === bytes;
        });
    const candidates = sized.length > 0 ? sized : modes;

    const texts = new Set<string>();
    for (const [, opcode] of candidates) {
        const timing = cyclesFor(index.cpu, opcode);
        if (!timing) return null;
        texts.add(formatCycles(timing.cycles, timing.variance));
    }
    return texts.size === 1 ? [...texts][0] : null;
}

/** Cycle-count hints for the instruction lines inside `range`. */
export function computeInlayHints(
    document: TextDocument,
    range: Range,
    documentIndex: Map<string, DocumentIndex>
): InlayHint[] {
    const index = documentIndex.get(document.uri);
    if (!index || !hasCycleData(index.cpu)) return [];

    const lines = document.getText().split('\n');
    const hints: InlayHint[] = [];
    for (let line = range.start.line; line <= Math.min(range.end.line, lines.length - 1); line++) {
        const { code } = parseLineStructure(lines[line]);
        const text = cycleHintFor(code, document.uri, line, documentIndex, index);
        if (text === null) continue;
        hints.push({
            // At the end of the code, so a trailing comment stays where it is.
            position: Position.create(line, code.trimEnd().length),
            label: text,
            kind: InlayHintKind.Parameter,
            paddingLeft: true,
            tooltip: 'Cycles',
        });
    }
    return hints;
}
