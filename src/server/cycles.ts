/**
 * Instruction timing for the NMOS 6502 - which is also the C64's 6510, and so
 * the `6502`, `6502i` and `default` targets.
 *
 * UNLIKE every other table here, this one cannot be probed: 64tass is an
 * assembler and knows nothing about cycles (confirmed - no listing column, no
 * directive, no flag, and the reference manual never mentions timing). So it is
 * transcribed from published opcode tables rather than derived from the tool.
 *
 * Two independent sources were used and agree on every entry they share -
 * including the cases that are easy to get wrong, such as `sta $1234,x` taking a
 * flat 5 (stores always pay the indexing cycle) where `lda $1234,x` takes 4 plus
 * one only when the index crosses a page.
 *
 * It was then cross-checked against this project's own addressing table, which
 * IS probed from the assembler: all 221 forms 64tass accepts for the 6502i agree
 * with the reference on which opcode byte carries which mnemonic. That does not
 * verify the cycle counts themselves, but it does rule out a table lined up
 * against the wrong opcodes - see cycles.test.ts.
 *
 * Only the NMOS family is covered. The CMOS and 16-bit targets retime several
 * instructions and the 65816's timing additionally depends on register widths
 * and direct-page alignment, so guessing there would be worse than saying
 * nothing: hover falls back to showing instruction length for them.
 */

/** How an instruction's cycle count varies, beyond the base figure. */
export type CycleVariance =
    /** Always this many. */
    | 'fixed'
    /** One more if the indexed address crosses a page boundary. */
    | 'page'
    /** One more if the branch is taken, two if it also lands on another page. */
    | 'branch'
    /** Locks the processor up; no meaningful count. */
    | 'jam';

export interface CycleInfo {
    cycles: number;
    variance: CycleVariance;
}

// opcode byte -> [cycles, variance]
const NMOS: Record<number, readonly [number, CycleVariance]> = {
    0x00: [7, 'fixed'],   // brk impl
    0x01: [6, 'fixed'],   // ora izx
    0x02: [0, 'jam'],   // kil impl
    0x03: [8, 'fixed'],   // slo izx
    0x04: [3, 'fixed'],   // nop zp
    0x05: [3, 'fixed'],   // ora zp
    0x06: [5, 'fixed'],   // asl zp
    0x07: [5, 'fixed'],   // slo zp
    0x08: [3, 'fixed'],   // php impl
    0x09: [2, 'fixed'],   // ora imm
    0x0A: [2, 'fixed'],   // asl impl
    0x0B: [2, 'fixed'],   // anc imm
    0x0C: [4, 'fixed'],   // nop abs
    0x0D: [4, 'fixed'],   // ora abs
    0x0E: [6, 'fixed'],   // asl abs
    0x0F: [6, 'fixed'],   // slo abs
    0x10: [2, 'branch'],   // bpl rel
    0x11: [5, 'page'],   // ora izy
    0x12: [0, 'jam'],   // kil impl
    0x13: [8, 'fixed'],   // slo izy
    0x14: [4, 'fixed'],   // nop zpx
    0x15: [4, 'fixed'],   // ora zpx
    0x16: [6, 'fixed'],   // asl zpx
    0x17: [6, 'fixed'],   // slo zpx
    0x18: [2, 'fixed'],   // clc impl
    0x19: [4, 'page'],   // ora aby
    0x1A: [2, 'fixed'],   // nop impl
    0x1B: [7, 'fixed'],   // slo aby
    0x1C: [4, 'page'],   // nop abx
    0x1D: [4, 'page'],   // ora abx
    0x1E: [7, 'fixed'],   // asl abx
    0x1F: [7, 'fixed'],   // slo abx
    0x20: [6, 'fixed'],   // jsr abs
    0x21: [6, 'fixed'],   // and izx
    0x22: [0, 'jam'],   // kil impl
    0x23: [8, 'fixed'],   // rla izx
    0x24: [3, 'fixed'],   // bit zp
    0x25: [3, 'fixed'],   // and zp
    0x26: [5, 'fixed'],   // rol zp
    0x27: [5, 'fixed'],   // rla zp
    0x28: [4, 'fixed'],   // plp impl
    0x29: [2, 'fixed'],   // and imm
    0x2A: [2, 'fixed'],   // rol impl
    0x2B: [2, 'fixed'],   // anc imm
    0x2C: [4, 'fixed'],   // bit abs
    0x2D: [4, 'fixed'],   // and abs
    0x2E: [6, 'fixed'],   // rol abs
    0x2F: [6, 'fixed'],   // rla abs
    0x30: [2, 'branch'],   // bmi rel
    0x31: [5, 'page'],   // and izy
    0x32: [0, 'jam'],   // kil impl
    0x33: [8, 'fixed'],   // rla izy
    0x34: [4, 'fixed'],   // nop zpx
    0x35: [4, 'fixed'],   // and zpx
    0x36: [6, 'fixed'],   // rol zpx
    0x37: [6, 'fixed'],   // rla zpx
    0x38: [2, 'fixed'],   // sec impl
    0x39: [4, 'page'],   // and aby
    0x3A: [2, 'fixed'],   // nop impl
    0x3B: [7, 'fixed'],   // rla aby
    0x3C: [4, 'page'],   // nop abx
    0x3D: [4, 'page'],   // and abx
    0x3E: [7, 'fixed'],   // rol abx
    0x3F: [7, 'fixed'],   // rla abx
    0x40: [6, 'fixed'],   // rti impl
    0x41: [6, 'fixed'],   // eor izx
    0x42: [0, 'jam'],   // kil impl
    0x43: [8, 'fixed'],   // sre izx
    0x44: [3, 'fixed'],   // nop zp
    0x45: [3, 'fixed'],   // eor zp
    0x46: [5, 'fixed'],   // lsr zp
    0x47: [5, 'fixed'],   // sre zp
    0x48: [3, 'fixed'],   // pha impl
    0x49: [2, 'fixed'],   // eor imm
    0x4A: [2, 'fixed'],   // lsr impl
    0x4B: [2, 'fixed'],   // alr imm
    0x4C: [3, 'fixed'],   // jmp abs
    0x4D: [4, 'fixed'],   // eor abs
    0x4E: [6, 'fixed'],   // lsr abs
    0x4F: [6, 'fixed'],   // sre abs
    0x50: [2, 'branch'],   // bvc rel
    0x51: [5, 'page'],   // eor izy
    0x52: [0, 'jam'],   // kil impl
    0x53: [8, 'fixed'],   // sre izy
    0x54: [4, 'fixed'],   // nop zpx
    0x55: [4, 'fixed'],   // eor zpx
    0x56: [6, 'fixed'],   // lsr zpx
    0x57: [6, 'fixed'],   // sre zpx
    0x58: [2, 'fixed'],   // cli impl
    0x59: [4, 'page'],   // eor aby
    0x5A: [2, 'fixed'],   // nop impl
    0x5B: [7, 'fixed'],   // sre aby
    0x5C: [4, 'page'],   // nop abx
    0x5D: [4, 'page'],   // eor abx
    0x5E: [7, 'fixed'],   // lsr abx
    0x5F: [7, 'fixed'],   // sre abx
    0x60: [6, 'fixed'],   // rts impl
    0x61: [6, 'fixed'],   // adc izx
    0x62: [0, 'jam'],   // kil impl
    0x63: [8, 'fixed'],   // rra izx
    0x64: [3, 'fixed'],   // nop zp
    0x65: [3, 'fixed'],   // adc zp
    0x66: [5, 'fixed'],   // ror zp
    0x67: [5, 'fixed'],   // rra zp
    0x68: [4, 'fixed'],   // pla impl
    0x69: [2, 'fixed'],   // adc imm
    0x6A: [2, 'fixed'],   // ror impl
    0x6B: [2, 'fixed'],   // arr imm
    0x6C: [5, 'fixed'],   // jmp ind
    0x6D: [4, 'fixed'],   // adc abs
    0x6E: [6, 'fixed'],   // ror abs
    0x6F: [6, 'fixed'],   // rra abs
    0x70: [2, 'branch'],   // bvs rel
    0x71: [5, 'page'],   // adc izy
    0x72: [0, 'jam'],   // kil impl
    0x73: [8, 'fixed'],   // rra izy
    0x74: [4, 'fixed'],   // nop zpx
    0x75: [4, 'fixed'],   // adc zpx
    0x76: [6, 'fixed'],   // ror zpx
    0x77: [6, 'fixed'],   // rra zpx
    0x78: [2, 'fixed'],   // sei impl
    0x79: [4, 'page'],   // adc aby
    0x7A: [2, 'fixed'],   // nop impl
    0x7B: [7, 'fixed'],   // rra aby
    0x7C: [4, 'page'],   // nop abx
    0x7D: [4, 'page'],   // adc abx
    0x7E: [7, 'fixed'],   // ror abx
    0x7F: [7, 'fixed'],   // rra abx
    0x80: [2, 'fixed'],   // nop imm
    0x81: [6, 'fixed'],   // sta izx
    0x82: [2, 'fixed'],   // nop imm
    0x83: [6, 'fixed'],   // sax izx
    0x84: [3, 'fixed'],   // sty zp
    0x85: [3, 'fixed'],   // sta zp
    0x86: [3, 'fixed'],   // stx zp
    0x87: [3, 'fixed'],   // sax zp
    0x88: [2, 'fixed'],   // dey impl
    0x89: [2, 'fixed'],   // nop imm
    0x8A: [2, 'fixed'],   // txa impl
    0x8B: [2, 'fixed'],   // xaa imm
    0x8C: [4, 'fixed'],   // sty abs
    0x8D: [4, 'fixed'],   // sta abs
    0x8E: [4, 'fixed'],   // stx abs
    0x8F: [4, 'fixed'],   // sax abs
    0x90: [2, 'branch'],   // bcc rel
    0x91: [6, 'fixed'],   // sta izy
    0x92: [0, 'jam'],   // kil impl
    0x93: [6, 'fixed'],   // ahx izy
    0x94: [4, 'fixed'],   // sty zpx
    0x95: [4, 'fixed'],   // sta zpx
    0x96: [4, 'fixed'],   // stx zpy
    0x97: [4, 'fixed'],   // sax zpy
    0x98: [2, 'fixed'],   // tya impl
    0x99: [5, 'fixed'],   // sta aby
    0x9A: [2, 'fixed'],   // txs impl
    0x9B: [5, 'fixed'],   // tas aby
    0x9C: [5, 'fixed'],   // shy abx
    0x9D: [5, 'fixed'],   // sta abx
    0x9E: [5, 'fixed'],   // shx aby
    0x9F: [5, 'fixed'],   // ahx aby
    0xA0: [2, 'fixed'],   // ldy imm
    0xA1: [6, 'fixed'],   // lda izx
    0xA2: [2, 'fixed'],   // ldx imm
    0xA3: [6, 'fixed'],   // lax izx
    0xA4: [3, 'fixed'],   // ldy zp
    0xA5: [3, 'fixed'],   // lda zp
    0xA6: [3, 'fixed'],   // ldx zp
    0xA7: [3, 'fixed'],   // lax zp
    0xA8: [2, 'fixed'],   // tay impl
    0xA9: [2, 'fixed'],   // lda imm
    0xAA: [2, 'fixed'],   // tax impl
    0xAB: [2, 'fixed'],   // lax imm
    0xAC: [4, 'fixed'],   // ldy abs
    0xAD: [4, 'fixed'],   // lda abs
    0xAE: [4, 'fixed'],   // ldx abs
    0xAF: [4, 'fixed'],   // lax abs
    0xB0: [2, 'branch'],   // bcs rel
    0xB1: [5, 'page'],   // lda izy
    0xB2: [0, 'jam'],   // kil impl
    0xB3: [5, 'page'],   // lax izy
    0xB4: [4, 'fixed'],   // ldy zpx
    0xB5: [4, 'fixed'],   // lda zpx
    0xB6: [4, 'fixed'],   // ldx zpy
    0xB7: [4, 'fixed'],   // lax zpy
    0xB8: [2, 'fixed'],   // clv impl
    0xB9: [4, 'page'],   // lda aby
    0xBA: [2, 'fixed'],   // tsx impl
    0xBB: [4, 'page'],   // las aby
    0xBC: [4, 'page'],   // ldy abx
    0xBD: [4, 'page'],   // lda abx
    0xBE: [4, 'page'],   // ldx aby
    0xBF: [4, 'page'],   // lax aby
    0xC0: [2, 'fixed'],   // cpy imm
    0xC1: [6, 'fixed'],   // cmp izx
    0xC2: [2, 'fixed'],   // nop imm
    0xC3: [8, 'fixed'],   // dcp izx
    0xC4: [3, 'fixed'],   // cpy zp
    0xC5: [3, 'fixed'],   // cmp zp
    0xC6: [5, 'fixed'],   // dec zp
    0xC7: [5, 'fixed'],   // dcp zp
    0xC8: [2, 'fixed'],   // iny impl
    0xC9: [2, 'fixed'],   // cmp imm
    0xCA: [2, 'fixed'],   // dex impl
    0xCB: [2, 'fixed'],   // axs imm
    0xCC: [4, 'fixed'],   // cpy abs
    0xCD: [4, 'fixed'],   // cmp abs
    0xCE: [6, 'fixed'],   // dec abs
    0xCF: [6, 'fixed'],   // dcp abs
    0xD0: [2, 'branch'],   // bne rel
    0xD1: [5, 'page'],   // cmp izy
    0xD2: [0, 'jam'],   // kil impl
    0xD3: [8, 'fixed'],   // dcp izy
    0xD4: [4, 'fixed'],   // nop zpx
    0xD5: [4, 'fixed'],   // cmp zpx
    0xD6: [6, 'fixed'],   // dec zpx
    0xD7: [6, 'fixed'],   // dcp zpx
    0xD8: [2, 'fixed'],   // cld impl
    0xD9: [4, 'page'],   // cmp aby
    0xDA: [2, 'fixed'],   // nop impl
    0xDB: [7, 'fixed'],   // dcp aby
    0xDC: [4, 'page'],   // nop abx
    0xDD: [4, 'page'],   // cmp abx
    0xDE: [7, 'fixed'],   // dec abx
    0xDF: [7, 'fixed'],   // dcp abx
    0xE0: [2, 'fixed'],   // cpx imm
    0xE1: [6, 'fixed'],   // sbc izx
    0xE2: [2, 'fixed'],   // nop imm
    0xE3: [8, 'fixed'],   // isc izx
    0xE4: [3, 'fixed'],   // cpx zp
    0xE5: [3, 'fixed'],   // sbc zp
    0xE6: [5, 'fixed'],   // inc zp
    0xE7: [5, 'fixed'],   // isc zp
    0xE8: [2, 'fixed'],   // inx impl
    0xE9: [2, 'fixed'],   // sbc imm
    0xEA: [2, 'fixed'],   // nop impl
    0xEB: [2, 'fixed'],   // sbc imm
    0xEC: [4, 'fixed'],   // cpx abs
    0xED: [4, 'fixed'],   // sbc abs
    0xEE: [6, 'fixed'],   // inc abs
    0xEF: [6, 'fixed'],   // isc abs
    0xF0: [2, 'branch'],   // beq rel
    0xF1: [5, 'page'],   // sbc izy
    0xF2: [0, 'jam'],   // kil impl
    0xF3: [8, 'fixed'],   // isc izy
    0xF4: [4, 'fixed'],   // nop zpx
    0xF5: [4, 'fixed'],   // sbc zpx
    0xF6: [6, 'fixed'],   // inc zpx
    0xF7: [6, 'fixed'],   // isc zpx
    0xF8: [2, 'fixed'],   // sed impl
    0xF9: [4, 'page'],   // sbc aby
    0xFA: [2, 'fixed'],   // nop impl
    0xFB: [7, 'fixed'],   // isc aby
    0xFC: [4, 'page'],   // nop abx
    0xFD: [4, 'page'],   // sbc abx
    0xFE: [7, 'fixed'],   // inc abx
    0xFF: [7, 'fixed'],   // isc abx
};

/** CPU targets whose timing the NMOS table describes. */
const NMOS_TARGETS = new Set(['default', '6502', '6502i']);

/**
 * Cycle count for an opcode byte on a CPU, or null when the timing for that
 * target is not modelled.
 */
export function cyclesFor(cpu: string, opcode: number): CycleInfo | null {
    if (!NMOS_TARGETS.has(cpu.toLowerCase())) return null;
    const entry = NMOS[opcode];
    return entry ? { cycles: entry[0], variance: entry[1] } : null;
}

/** Whether cycle timing is known for a CPU at all. */
export function hasCycleData(cpu: string): boolean {
    return NMOS_TARGETS.has(cpu.toLowerCase());
}

/**
 * How a count is written where there is no room to explain it: a bare number, or
 * one with the markers hover's legend describes.
 */
export function formatCycles(cycles: number, variance: CycleVariance): string {
    switch (variance) {
        case 'page': return `${cycles}*`;
        case 'branch': return `${cycles}**`;
        case 'jam': return '--';
        default: return String(cycles);
    }
}
