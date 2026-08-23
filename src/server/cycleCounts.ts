/**
 * Cycle counts, one per instruction line.
 *
 * The numbers come from `cycles.ts`, so they exist only for the NMOS targets -
 * elsewhere there is nothing honest to show and the line gets nothing. Which
 * count applies depends on the addressing mode the line actually assembles to,
 * so the operand has to be resolved to ONE opcode byte: `lda $10` is a zeropage
 * load and `lda $1234` an absolute one, and only the latter can cross a page.
 *
 * Where the mode cannot be pinned down - an operand whose value nothing here
 * knows - a count appears only if every candidate agrees on it. Guessing a
 * number the code does not take would be worse than showing none.
 *
 * The client draws these in a column left of the code (see src/client), because
 * VS Code's own gutter takes images rather than text.
 */
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

/** The cycle text for one instruction line, or null when there is none to give. */
export function cycleTextFor(
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

/** One line's count, as the client needs it to draw its column. */
export interface CycleCount {
    /** Zero-based line number. */
    line: number;
    /** `4`, `4*`, `2**`, `--`. */
    text: string;
}

/**
 * The cycle count of every instruction line in the document.
 *
 * Whole-document rather than per-range: the client draws a column down the
 * margin and needs the widest entry before it can align any of it.
 */
export function computeCycleCounts(
    document: TextDocument,
    documentIndex: Map<string, DocumentIndex>
): CycleCount[] {
    const index = documentIndex.get(document.uri);
    if (!index || !hasCycleData(index.cpu)) return [];

    const counts: CycleCount[] = [];
    const lines = document.getText().split('\n');
    for (let line = 0; line < lines.length; line++) {
        const { code } = parseLineStructure(lines[line]);
        const text = cycleTextFor(code, document.uri, line, documentIndex, index);
        if (text !== null) counts.push({ line, text });
    }
    return counts;
}
