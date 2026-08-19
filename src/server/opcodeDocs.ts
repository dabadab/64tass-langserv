/**
 * One-line descriptions and affected status flags per mnemonic.
 *
 * Unlike the addressing-mode table in `addressing.ts`, none of this can be
 * probed - the assembler knows the encoding, not the semantics - so it is
 * hand-written. It deliberately covers only the sets where the meaning is
 * unambiguous: the documented 6502, the well-known undocumented NMOS opcodes,
 * 64tass's own aliases, and the 65C02/65816 additions. Mnemonics specific to the
 * 65CE02/4510/45GS02/65EL02 are left out rather than guessed at; hover falls back
 * to showing just their addressing modes, which are verified.
 */

export interface OpcodeDoc {
    /** One-line summary, no trailing full stop. */
    summary: string;
    /** Status flags the instruction writes, e.g. "NZC". Omitted when it writes none. */
    flags?: string;
    /** Set for opcodes outside the official instruction set. */
    undocumented?: boolean;
}

const DOCS: Record<string, OpcodeDoc> = {
    // --- documented 6502 ---
    adc: { summary: 'Add with carry to the accumulator', flags: 'NVZC' },
    and: { summary: 'Bitwise AND with the accumulator', flags: 'NZ' },
    asl: { summary: 'Arithmetic shift left, bit 7 into carry', flags: 'NZC' },
    bcc: { summary: 'Branch if carry clear' },
    bcs: { summary: 'Branch if carry set' },
    beq: { summary: 'Branch if equal (zero set)' },
    bit: { summary: 'Test bits against the accumulator; N and V take bits 7 and 6 of the operand', flags: 'NVZ' },
    bmi: { summary: 'Branch if minus (negative set)' },
    bne: { summary: 'Branch if not equal (zero clear)' },
    bpl: { summary: 'Branch if plus (negative clear)' },
    brk: { summary: 'Force an interrupt', flags: 'BI' },
    bvc: { summary: 'Branch if overflow clear' },
    bvs: { summary: 'Branch if overflow set' },
    clc: { summary: 'Clear carry', flags: 'C' },
    cld: { summary: 'Clear decimal mode', flags: 'D' },
    cli: { summary: 'Clear interrupt disable', flags: 'I' },
    clv: { summary: 'Clear overflow', flags: 'V' },
    cmp: { summary: 'Compare with the accumulator', flags: 'NZC' },
    cpx: { summary: 'Compare with X', flags: 'NZC' },
    cpy: { summary: 'Compare with Y', flags: 'NZC' },
    dec: { summary: 'Decrement memory by one', flags: 'NZ' },
    dex: { summary: 'Decrement X by one', flags: 'NZ' },
    dey: { summary: 'Decrement Y by one', flags: 'NZ' },
    eor: { summary: 'Bitwise exclusive OR with the accumulator', flags: 'NZ' },
    inc: { summary: 'Increment memory by one', flags: 'NZ' },
    inx: { summary: 'Increment X by one', flags: 'NZ' },
    iny: { summary: 'Increment Y by one', flags: 'NZ' },
    jmp: { summary: 'Jump to address' },
    jsr: { summary: 'Jump to subroutine, pushing the return address' },
    lda: { summary: 'Load the accumulator', flags: 'NZ' },
    ldx: { summary: 'Load X', flags: 'NZ' },
    ldy: { summary: 'Load Y', flags: 'NZ' },
    lsr: { summary: 'Logical shift right, bit 0 into carry', flags: 'NZC' },
    nop: { summary: 'No operation' },
    ora: { summary: 'Bitwise OR with the accumulator', flags: 'NZ' },
    pha: { summary: 'Push the accumulator' },
    php: { summary: 'Push the status register' },
    pla: { summary: 'Pull the accumulator', flags: 'NZ' },
    plp: { summary: 'Pull the status register', flags: 'NVBDIZC' },
    rol: { summary: 'Rotate left through carry', flags: 'NZC' },
    ror: { summary: 'Rotate right through carry', flags: 'NZC' },
    rti: { summary: 'Return from interrupt', flags: 'NVBDIZC' },
    rts: { summary: 'Return from subroutine' },
    sbc: { summary: 'Subtract with borrow from the accumulator', flags: 'NVZC' },
    sec: { summary: 'Set carry', flags: 'C' },
    sed: { summary: 'Set decimal mode', flags: 'D' },
    sei: { summary: 'Set interrupt disable', flags: 'I' },
    sta: { summary: 'Store the accumulator' },
    stx: { summary: 'Store X' },
    sty: { summary: 'Store Y' },
    tax: { summary: 'Transfer the accumulator to X', flags: 'NZ' },
    tay: { summary: 'Transfer the accumulator to Y', flags: 'NZ' },
    tsx: { summary: 'Transfer the stack pointer to X', flags: 'NZ' },
    txa: { summary: 'Transfer X to the accumulator', flags: 'NZ' },
    txs: { summary: 'Transfer X to the stack pointer' },
    tya: { summary: 'Transfer Y to the accumulator', flags: 'NZ' },

    // --- 64tass aliases for the above ---
    bge: { summary: 'Branch if greater or equal - alias for BCS' },
    blt: { summary: 'Branch if less than - alias for BCC' },
    shl: { summary: 'Shift left - alias for ASL', flags: 'NZC' },
    shr: { summary: 'Shift right - alias for LSR', flags: 'NZC' },
    asr: { summary: 'AND then shift right - alias for ALR', flags: 'NZC', undocumented: true },
    cpa: { summary: 'Compare with the accumulator - alias for CMP', flags: 'NZC' },
    dcm: { summary: 'Decrement then compare - alias for DCP', flags: 'NZC', undocumented: true },
    ins: { summary: 'Increment then subtract - alias for ISC', flags: 'NVZC', undocumented: true },
    isb: { summary: 'Increment then subtract - alias for ISC', flags: 'NVZC', undocumented: true },
    lds: { summary: 'AND memory with the stack pointer - alias for LAS', flags: 'NZ', undocumented: true },
    lae: { summary: 'AND memory with the stack pointer - alias for LAS', flags: 'NZ', undocumented: true },
    ahx: { summary: 'Store A AND X AND high byte + 1 - alias for SHA', undocumented: true },
    ane: { summary: 'AND the accumulator with X and an immediate - alias for XAA, unstable', flags: 'NZ', undocumented: true },
    sbx: { summary: 'AND A with X, subtract an immediate into X - alias for AXS', flags: 'NZC', undocumented: true },
    tas: { summary: 'A AND X into the stack pointer, then store - alias for SHS', undocumented: true },
    hlt: { summary: 'Halt the processor - alias for JAM', undocumented: true },
    ind: { summary: 'Increment memory - alias for INC', flags: 'NZ' },
    ded: { summary: 'Decrement memory - alias for DEC', flags: 'NZ' },

    // --- 6502 undocumented ---
    lax: { summary: 'Load the accumulator and X together', flags: 'NZ', undocumented: true },
    sax: { summary: 'Store A AND X', undocumented: true },
    dcp: { summary: 'Decrement memory, then compare with the accumulator', flags: 'NZC', undocumented: true },
    isc: { summary: 'Increment memory, then subtract with borrow', flags: 'NVZC', undocumented: true },
    slo: { summary: 'Shift left, then OR with the accumulator', flags: 'NZC', undocumented: true },
    rla: { summary: 'Rotate left, then AND with the accumulator', flags: 'NZC', undocumented: true },
    sre: { summary: 'Shift right, then EOR with the accumulator', flags: 'NZC', undocumented: true },
    rra: { summary: 'Rotate right, then add with carry', flags: 'NVZC', undocumented: true },
    anc: { summary: 'AND with the accumulator, copying bit 7 into carry', flags: 'NZC', undocumented: true },
    alr: { summary: 'AND with the accumulator, then shift right', flags: 'NZC', undocumented: true },
    arr: { summary: 'AND with the accumulator, then rotate right', flags: 'NVZC', undocumented: true },
    xaa: { summary: 'AND the accumulator with X and an immediate; unstable on real hardware', flags: 'NZ', undocumented: true },
    lxa: { summary: 'AND an immediate into A and X; unstable on real hardware', flags: 'NZ', undocumented: true },
    axs: { summary: 'AND A with X, then subtract an immediate into X', flags: 'NZC', undocumented: true },
    las: { summary: 'AND memory with the stack pointer into A, X and S', flags: 'NZ', undocumented: true },
    shs: { summary: 'A AND X into the stack pointer, then store it AND the high byte + 1', undocumented: true },
    sha: { summary: 'Store A AND X AND the high byte + 1', undocumented: true },
    shx: { summary: 'Store X AND the high byte + 1', undocumented: true },
    shy: { summary: 'Store Y AND the high byte + 1', undocumented: true },
    jam: { summary: 'Halt the processor until reset', undocumented: true },

    // --- 65C02 ---
    bra: { summary: 'Branch always' },
    phx: { summary: 'Push X' },
    phy: { summary: 'Push Y' },
    plx: { summary: 'Pull X', flags: 'NZ' },
    ply: { summary: 'Pull Y', flags: 'NZ' },
    stz: { summary: 'Store zero' },
    trb: { summary: 'Test and reset bits against the accumulator', flags: 'Z' },
    tsb: { summary: 'Test and set bits against the accumulator', flags: 'Z' },
    ina: { summary: 'Increment the accumulator', flags: 'NZ' },
    dea: { summary: 'Decrement the accumulator', flags: 'NZ' },
    stp: { summary: 'Stop the clock until reset' },
    wai: { summary: 'Wait for an interrupt' },
    bbr: { summary: 'Branch if the given bit of a zero-page byte is clear' },
    bbs: { summary: 'Branch if the given bit of a zero-page byte is set' },
    rmb: { summary: 'Reset the given bit of a zero-page byte' },
    smb: { summary: 'Set the given bit of a zero-page byte' },

    // --- 65816 ---
    brl: { summary: 'Branch always, 16-bit relative' },
    cop: { summary: 'Co-processor software interrupt', flags: 'DI' },
    jml: { summary: 'Jump long, to a 24-bit address' },
    jsl: { summary: 'Jump to subroutine long, to a 24-bit address' },
    mvn: { summary: 'Block move, ascending' },
    mvp: { summary: 'Block move, descending' },
    pea: { summary: 'Push an effective absolute address' },
    pei: { summary: 'Push an effective indirect address' },
    per: { summary: 'Push an effective relative address' },
    phb: { summary: 'Push the data bank register' },
    phd: { summary: 'Push the direct page register' },
    phk: { summary: 'Push the program bank register' },
    plb: { summary: 'Pull the data bank register', flags: 'NZ' },
    pld: { summary: 'Pull the direct page register', flags: 'NZ' },
    rep: { summary: 'Reset the status bits given by the immediate mask', flags: 'NVMXDIZC' },
    sep: { summary: 'Set the status bits given by the immediate mask', flags: 'NVMXDIZC' },
    rtl: { summary: 'Return from a long subroutine' },
    tcd: { summary: 'Transfer the accumulator to the direct page register', flags: 'NZ' },
    tcs: { summary: 'Transfer the accumulator to the stack pointer' },
    tdc: { summary: 'Transfer the direct page register to the accumulator', flags: 'NZ' },
    tsc: { summary: 'Transfer the stack pointer to the accumulator', flags: 'NZ' },
    txy: { summary: 'Transfer X to Y', flags: 'NZ' },
    tyx: { summary: 'Transfer Y to X', flags: 'NZ' },
    wdm: { summary: 'Reserved for future expansion; acts as a two-byte NOP' },
    xba: { summary: 'Exchange the high and low bytes of the accumulator', flags: 'NZ' },
    xce: { summary: 'Exchange the carry and emulation flags', flags: 'C' },
};

/** Documentation for a mnemonic, or null when none is written for it. */
export function opcodeDoc(mnemonic: string): OpcodeDoc | null {
    return DOCS[mnemonic.toLowerCase()] ?? null;
}
