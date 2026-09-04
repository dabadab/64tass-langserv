/**
 * The shape of an instruction operand: brackets and index register, ignoring the
 * value written inside. `lda ($10),y` and `lda (ptr),y` are the same shape, and
 * that shape is what decides whether an addressing mode exists at all - the size
 * of the value only picks between zeropage and absolute forms of one shape.
 *
 * The one place that reads operand shapes: completion consults it for which index
 * registers a comma can take, diagnostics for whether the written form assembles.
 * Both sides derive everything from `addressing.ts`, which is probed from the
 * assembler, so neither carries a hand-written list of what is legal.
 */
import { addressingModesFor, AddressingMode } from './addressing';
import { CPU_NAMES, OPCODES, REGISTER_MODES, opcodesForCpu } from './constants';

/**
 * Where a comma sits relative to the operand's brackets:
 *
 *   plain        `lda $1234,x`    - no brackets involved
 *   inside       `lda ($10,x)`    - within the brackets
 *   after-close  `lda ($10),y`    - after the brackets closed
 */
export type CommaContext = 'plain' | 'inside' | 'after-close';

export interface OperandShape {
    /** '(' or '[' when the address is bracketed, '' when it is not. */
    bracket: '' | '(' | '[';
    /** Index register inside the brackets, as in `($10,x)`. Null when there is none. */
    inside: string | null;
    /**
     * Index register outside them - `($10),y` or, unbracketed, `$10,x`. Both
     * positions can be filled at once: the 65816 has `($10,s),y`.
     */
    outside: string | null;
}

/** Distinguishes the forms that are not addresses at all. */
type Parsed =
    | { kind: 'address'; shape: OperandShape }
    | { kind: 'implied' }
    | { kind: 'immediate' }
    /** More than one top-level comma (`bbr 0,$10,lbl`, `mvn $01,$02`) - not modelled. */
    | { kind: 'multi' };

/** Index positions of the top-level commas, and whether the text is fully bracketed. */
function scan(text: string): { commas: number[]; wrapped: boolean } {
    const commas: number[] = [];
    let depth = 0;
    let quote: string | null = null;
    // Where the bracket opened at position 0 closes, if it does.
    let closeOfFirst = -1;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quote) {
            if (char === quote) {
                if (text[i + 1] === quote) i++;
                else quote = null;
            }
            continue;
        }
        if (char === '"' || char === "'") quote = char;
        else if (char === '(' || char === '[') depth++;
        else if (char === ')' || char === ']') {
            depth--;
            if (depth === 0 && closeOfFirst < 0) closeOfFirst = i;
        } else if (char === ',' && depth === 0) commas.push(i);
    }
    const opens = text[0] === '(' || text[0] === '[';
    return { commas, wrapped: opens && closeOfFirst === text.length - 1 };
}

/** The register written after a comma, or null when it is an expression instead. */
function registerAfter(text: string): string | null {
    const match = text.match(/^\s*([a-zA-Z]+)\s*$/);
    return match ? match[1].toLowerCase() : null;
}

/**
 * Classify one operand - either a probed pattern from `addressing.ts` or what the
 * user actually wrote, since the two have to be compared as shapes.
 */
export function parseOperand(text: string): Parsed {
    const s = text.trim();
    if (s === '') return { kind: 'implied' };
    if (s.startsWith('#')) return { kind: 'immediate' };

    const { commas } = scan(s);
    if (commas.length > 1) return { kind: 'multi' };

    // Anything after a top-level comma is the outside index.
    let outside: string | null = null;
    let head = s;
    if (commas.length === 1) {
        outside = registerAfter(s.slice(commas[0] + 1));
        if (outside === null) return { kind: 'multi' };   // `mvn $01,$02` and friends
        head = s.slice(0, commas[0]).trim();
    }

    const headScan = scan(head);
    if (!headScan.wrapped) return { kind: 'address', shape: { bracket: '', inside: null, outside } };

    const bracket = head[0] as '(' | '[';
    const inner = head.slice(1, -1);
    const innerScan = scan(inner);
    if (innerScan.commas.length === 0) {
        return { kind: 'address', shape: { bracket, inside: null, outside } };
    }
    if (innerScan.commas.length > 1) return { kind: 'multi' };
    const inside = registerAfter(inner.slice(innerScan.commas[0] + 1));
    return inside === null
        ? { kind: 'multi' }
        : { kind: 'address', shape: { bracket, inside, outside } };
}

function shapeKey(shape: OperandShape): string {
    return `${shape.bracket}|${shape.inside ?? ''}|${shape.outside ?? ''}`;
}

/** The address shapes a mnemonic accepts on one CPU. */
function shapesFor(cpu: string, mnemonic: string): Set<string> {
    const keys = new Set<string>();
    for (const [pattern] of addressingModesFor(cpu, mnemonic)) {
        const parsed = parseOperand(pattern);
        if (parsed.kind === 'address') keys.add(shapeKey(parsed.shape));
    }
    return keys;
}

/** True when the mnemonic has forms this module deliberately does not model. */
function hasUnmodelledForm(cpu: string, mnemonic: string): boolean {
    return addressingModesFor(cpu, mnemonic).some(([pattern]) => parseOperand(pattern).kind === 'multi');
}

/**
 * Index registers offered after a comma in this position - exact per opcode, per
 * CPU and per position, since `lda $10,z` is rejected on the 4510 while
 * `lda ($10),z` is fine.
 */
export function indexRegistersFor(cpu: string, mnemonic: string, context: CommaContext): string[] {
    const registers = new Set<string>();
    for (const [pattern] of addressingModesFor(cpu, mnemonic)) {
        const parsed = parseOperand(pattern);
        if (parsed.kind !== 'address') continue;
        const { bracket, inside, outside } = parsed.shape;
        if (context === 'inside' && inside) registers.add(inside);
        if (context === 'after-close' && bracket !== '' && outside) registers.add(outside);
        if (context === 'plain' && bracket === '' && outside) registers.add(outside);
    }
    return [...registers].sort();
}

/** Every register that indexes something on some target: what a comma can mean. */
const INDEXING_REGISTERS: ReadonlySet<string> = (() => {
    const found = new Set<string>();
    for (const cpu of CPU_NAMES) {
        for (const mnemonic of OPCODES) {
            for (const context of ['plain', 'inside', 'after-close'] as const) {
                for (const register of indexRegistersFor(cpu, mnemonic, context)) found.add(register);
            }
        }
    }
    return found;
})();

/** 64tass's own wording, so the message matches what a build would print. */
function describeInside(bracket: string, register: string): string {
    const long = bracket === '[' ? 'long ' : '';
    return `no ${register === 's' ? 'stack' : register} indexed ${long}indirect addressing mode`;
}

function describeOutside(bracket: string, register: string): string {
    const name = register === 's' ? 'stack' : register;
    if (bracket === '') return `no ${name} indexed addressing mode`;
    return `no ${bracket === '[' ? 'long ' : ''}indirect ${name} indexed addressing mode`;
}

export interface AddressingProblem {
    message: string;
}

/**
 * The part of an operand that carries the address, for a caller that wants to
 * evaluate it: brackets and any index register stripped off. Null for an
 * immediate, whose width is `findOversizedImmediate`'s business.
 */
export function addressExpressionOf(operand: string): string | null {
    let text = operand.trim();
    if (text === '' || text.startsWith('#')) return null;

    // Peel the operand's own punctuation and nothing else. Cutting at the first
    // `)` instead took `sty ($100)/2,x` for `$100` - a two-byte value where the
    // expression is $80, and the line was reported as an addressing error the
    // assembler accepts.
    for (;;) {
        const { commas, wrapped } = scan(text);
        // A trailing index register belongs to the operand, not the address.
        if (commas.length === 1 && registerAfter(text.slice(commas[0] + 1)) !== null) {
            text = text.slice(0, commas[0]).trim();
            continue;
        }
        // Brackets are only the operand's when they wrap the WHOLE expression;
        // `($100)/2` is arithmetic that happens to start with one.
        if (wrapped) {
            text = text.slice(1, -1).trim();
            continue;
        }
        return text === '' ? null : text;
    }
}

/** How many bytes a value needs, or null when it needs none we can reason about. */
export function bytesForValue(value: number): number | null {
    if (!Number.isInteger(value) || value < 0) return null;
    if (value <= 0xff) return 1;
    if (value <= 0xffff) return 2;
    return 3;
}

/** The address bytes one probed pattern holds, or null when it holds no address. */
function patternBytes(pattern: string): number | null {
    const digits = pattern.match(/\$h+/);
    // `<label>` is a relative branch and `a`/`` are register or implied forms:
    // none of them carries an address whose width could be wrong.
    return digits ? (digits[0].length - 1) / 2 : null;
}

/** The modes of this mnemonic whose shape is exactly the one written. */
function modesMatchingShape(cpu: string, mnemonic: string, shape: OperandShape): readonly AddressingMode[] {
    const wanted = shapeKey(shape);
    return addressingModesFor(cpu, mnemonic).filter(([pattern]) => {
        const parsed = parseOperand(pattern);
        return parsed.kind === 'address' && shapeKey(parsed.shape) === wanted;
    });
}

/**
 * Targets whose direct (base) page can be moved: `.dpage $c000` makes `$c010`
 * a direct-page address there, and `sty $c010,x` assembles (verified). The value
 * alone cannot decide the width on those, so the width check stands down.
 */
const MOVABLE_PAGE_CPUS: ReadonlySet<string> = new Set(['65816', '65el02', '4510', '45gs02']);

/** Whether the value fits the widest mode of this shape - null when it does. */
function tooWideFor(
    cpu: string,
    mnemonic: string,
    shape: OperandShape,
    valueBytes: number
): number | null {
    if (MOVABLE_PAGE_CPUS.has(cpu.toLowerCase())) return null;
    const matching = modesMatchingShape(cpu, mnemonic, shape);
    if (matching.length === 0) return null;

    let widest = 0;
    for (const [pattern] of matching) {
        const bytes = patternBytes(pattern);
        if (bytes === null) return null;   // no fixed-width address in this form
        widest = Math.max(widest, bytes);
    }
    return valueBytes > widest ? widest : null;
}

/**
 * Whether `mnemonic operand` has an addressing mode on this CPU. Null means fine,
 * or not modelled - immediates, implied forms, the `bbr`/`mvn` multi-operand
 * families and register operands (`asl a`) are all deliberately left alone, as is
 * any mnemonic the target does not have at all.
 */
export function findAddressingProblem(
    cpu: string,
    mnemonic: string,
    operand: string,
    /**
     * The operand's value, where the caller could work it out. A shape the
     * mnemonic HAS may still be wrong at this width: `sty $10,x` assembles and
     * `sty $c000,x` does not, because sty has no absolute,x form.
     */
    value?: number | null
): AddressingProblem | null {
    const name = mnemonic.toLowerCase();
    const modes = shapesFor(cpu, name);
    if (modes.size === 0 || hasUnmodelledForm(cpu, name)) return null;

    const parsed = parseOperand(operand);
    if (parsed.kind !== 'address') return null;
    const { shape } = parsed;
    // A comma the assembler does not index with: the `,b` `,d` `,k` `,r` size and
    // bank overrides, or a comma inside an expression we have misread.
    for (const register of [shape.inside, shape.outside]) {
        if (register !== null && !INDEXING_REGISTERS.has(register)) return null;
    }
    // A register operand rather than an address: `asl a`, `ldx s`.
    if (shape.bracket === '' && shape.outside === null
        && (REGISTER_MODES[name] ?? []).includes(operand.trim().toLowerCase())) return null;
    // The shape exists; the only thing left that can be wrong is its width.
    if (modes.has(shapeKey(shape))) {
        const valueBytes = value === undefined || value === null ? null : bytesForValue(value);
        if (valueBytes === null) return null;
        const widest = tooWideFor(cpu, name, shape, valueBytes);
        if (widest === null) return null;
        const written = `$${(value as number).toString(16)}`;
        // Both are 64tass's own distinctions: a form that only reaches page zero
        // is described differently from one the value simply overflows. The
        // opcode is not named - it is right there on the line.
        return {
            message: widest === 1
                ? `not a direct page address '${written}'`
                : `'${written}' does not fit in ${widest * 8} bits`,
        };
    }
    // Nothing to say about a plain address whose shape is missing: every mnemonic
    // that takes an operand at all takes one of those, and an operand on an
    // implied-only mnemonic is reported by the caller as a mnemonic the target
    // does not have.
    if (shape.bracket === '' && shape.outside === null) return null;

    // Which half is at fault. When each half is fine on its own and only the
    // combination is missing, say nothing rather than invent a description of it.
    const message = wrongPart(cpu, name, shape);
    if (message === null) return null;

    return { message: `${message} for opcode '${name}'` };
}

/** The part of the shape no mode of this mnemonic has, described 64tass's way. */
function wrongPart(cpu: string, mnemonic: string, shape: OperandShape): string | null {
    // Bracketed or not is the distinction that matters - `$10,x` and `($10),x` are
    // different modes. WHICH bracket is not: the 45gs02 assembles `lda [$10],z`,
    // and the table records the form the assembler disassembles it back to,
    // `($10),z`. Separating the two characters made every such line a false error.
    const registers = (position: 'inside' | 'outside') => {
        const found = new Set<string>();
        for (const [pattern] of addressingModesFor(cpu, mnemonic)) {
            const parsed = parseOperand(pattern);
            if (parsed.kind !== 'address') continue;
            if ((parsed.shape.bracket === '') !== (shape.bracket === '')) continue;
            const register = position === 'inside' ? parsed.shape.inside : parsed.shape.outside;
            if (register) found.add(register);
        }
        return found;
    };

    if (shape.inside !== null && !registers('inside').has(shape.inside)) {
        return describeInside(shape.bracket, shape.inside);
    }
    if (shape.outside !== null && !registers('outside').has(shape.outside)) {
        return describeOutside(shape.bracket, shape.outside);
    }
    // Both halves exist, just never together - `adc ($10,x),y`.
    if (shape.inside !== null && shape.outside !== null) {
        const inside = shape.inside === 's' ? 'stack' : shape.inside;
        const outside = shape.outside === 's' ? 'stack' : shape.outside;
        return `no ${inside} indexed indirect ${outside} indexed addressing mode`;
    }
    if (shape.outside !== null) return null;

    // Bracketed with no index at all. Only worth saying when the table models
    // brackets for this mnemonic in the first place: the patterns are the
    // assembler's own disassembly, and a few source forms do not survive it -
    // `pei ($10)` and `jml [$1234]` assemble but read back as plain addresses
    // (both verified). Without this they were the only false positives across
    // every mnemonic, operand shape and target.
    const bracketed = addressingModesFor(cpu, mnemonic)
        .some(([pattern]) => pattern.includes('(') || pattern.includes('['));
    if (!bracketed) return null;
    return `no ${shape.bracket === '[' ? 'long ' : ''}indirect addressing mode`;
}

/**
 * How many bytes an immediate operand takes on this mnemonic, or null when that
 * is not a static fact.
 *
 * Null for a target with `rep`/`sep`: there the accumulator and index registers
 * switch between 8 and 16 bits at run time, so `lda #$1234` assembles under `.al`
 * and not otherwise (verified) - the width simply is not knowable from the line.
 * Null too when the mnemonic has no immediate form at all, since then there is
 * nothing to measure against.
 */
export function immediateBytesFor(cpu: string, mnemonic: string): number | null {
    const set = opcodesForCpu(cpu);
    if (set.has('rep') && set.has('sep')) return null;
    let bytes: number | null = null;
    for (const [pattern, , length] of addressingModesFor(cpu, mnemonic)) {
        if (!pattern.startsWith('#')) continue;
        bytes = Math.max(bytes ?? 0, length - 1);
    }
    return bytes;
}
