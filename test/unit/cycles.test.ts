import { describe, it, expect } from 'vitest';
import { cyclesFor, hasCycleData } from '../../src/server/cycles';
import { addressingModesFor } from '../../src/server/addressing';
import { opcodesForCpu } from '../../src/server/constants';

describe('cyclesFor', () => {
    /** [opcode, cycles, variance] - spot checks across the instruction set. */
    it.each([
        [0xA9, 2, 'fixed'],    // lda #
        [0xA5, 3, 'fixed'],    // lda zp
        [0xB5, 4, 'fixed'],    // lda zp,x
        [0xAD, 4, 'fixed'],    // lda abs
        [0xBD, 4, 'page'],     // lda abs,x - pays only when it crosses
        [0xB9, 4, 'page'],     // lda abs,y
        [0xA1, 6, 'fixed'],    // lda (zp,x)
        [0xB1, 5, 'page'],     // lda (zp),y
        [0x9D, 5, 'fixed'],    // sta abs,x - stores always pay it
        [0x99, 5, 'fixed'],    // sta abs,y
        [0x91, 6, 'fixed'],    // sta (zp),y
        [0x0A, 2, 'fixed'],    // asl a
        [0x0E, 6, 'fixed'],    // asl abs
        [0x1E, 7, 'fixed'],    // asl abs,x - read-modify-write is flat
        [0x4C, 3, 'fixed'],    // jmp abs
        [0x6C, 5, 'fixed'],    // jmp (abs)
        [0x20, 6, 'fixed'],    // jsr
        [0x60, 6, 'fixed'],    // rts
        [0x40, 6, 'fixed'],    // rti
        [0x00, 7, 'fixed'],    // brk
        [0x48, 3, 'fixed'],    // pha
        [0x68, 4, 'fixed'],    // pla
        [0xEA, 2, 'fixed'],    // nop
        [0xD0, 2, 'branch'],   // bne
        [0x10, 2, 'branch'],   // bpl
        [0x02, 0, 'jam'],      // jam
    ])('opcode $%i', (opcode, cycles, variance) => {
        const info = cyclesFor('6502i', opcode)!;
        expect(info.cycles).toBe(cycles);
        expect(info.variance).toBe(variance);
    });

    it('covers all 256 opcode bytes', () => {
        for (let opcode = 0; opcode <= 0xFF; opcode++) {
            expect(cyclesFor('6502i', opcode), `$${opcode.toString(16)}`).not.toBeNull();
        }
    });

    it('gives the same timing to every NMOS target', () => {
        for (const cpu of ['6502', '6502i', 'default']) {
            expect(hasCycleData(cpu), cpu).toBe(true);
            expect(cyclesFor(cpu, 0xBD)).toEqual({ cycles: 4, variance: 'page' });
        }
    });

    it('reports no data for targets whose timing is not modelled', () => {
        // The CMOS and 16-bit parts retime instructions; the 65816 additionally
        // depends on register widths, so nothing is claimed for them.
        for (const cpu of ['65c02', 'r65c02', 'w65c02', '65816', '65ce02', '4510', '45gs02', '65el02', '65dtv02']) {
            expect(hasCycleData(cpu), cpu).toBe(false);
            expect(cyclesFor(cpu, 0xA9), cpu).toBeNull();
        }
    });

    it('only marks a page penalty where indexing can cross one', () => {
        // A page penalty on a non-indexed form would be a transcription slip.
        for (let opcode = 0; opcode <= 0xFF; opcode++) {
            if (cyclesFor('6502i', opcode)!.variance !== 'page') continue;
            const forms = [...opcodesForCpu('6502i')]
                .flatMap(m => addressingModesFor('6502i', m))
                .filter(([, byte]) => byte === opcode)
                .map(([pattern]) => pattern);
            for (const pattern of forms) {
                expect(pattern, `$${opcode.toString(16)} "${pattern}"`).toMatch(/,\s*[xy]|\),\s*y/);
            }
        }
    });

    it('only marks a branch penalty on a relative form', () => {
        for (let opcode = 0; opcode <= 0xFF; opcode++) {
            if (cyclesFor('6502i', opcode)!.variance !== 'branch') continue;
            const forms = [...opcodesForCpu('6502i')]
                .flatMap(m => addressingModesFor('6502i', m))
                .filter(([, byte]) => byte === opcode)
                .map(([pattern]) => pattern);
            for (const pattern of forms) expect(pattern).toBe('<label>');
        }
    });
});

describe('cycle table lines up with the probed opcode bytes', () => {
    /**
     * The cycle table is transcribed from published references; the addressing
     * table is probed from the assembler. Neither can check the other's cycle
     * counts, but every form 64tass accepts must at least have an entry, which
     * catches a table shifted against the wrong opcodes.
     */
    it('has an entry for every form the assembler accepts', () => {
        const missing: string[] = [];
        for (const mnemonic of opcodesForCpu('6502i')) {
            for (const [pattern, opcode] of addressingModesFor('6502i', mnemonic)) {
                if (!cyclesFor('6502i', opcode)) missing.push(`${mnemonic} ${pattern}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('agrees that a branch opcode is the relative form', () => {
        for (const mnemonic of ['bne', 'beq', 'bcc', 'bcs', 'bpl', 'bmi', 'bvc', 'bvs']) {
            const [[pattern, opcode]] = addressingModesFor('6502i', mnemonic);
            expect(pattern).toBe('<label>');
            expect(cyclesFor('6502i', opcode)!.variance).toBe('branch');
        }
    });
});
