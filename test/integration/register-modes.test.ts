import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TASS_EXISTS, compile } from '../helpers/compiler';
import { registerModesForCpu, opcodesForCpu } from '../../src/server/constants';

/**
 * The register-mode table was probed from the assembler, and a flaw in that probe
 * silently dropped `ldx s` for the 65816. These tests check the shipped table back
 * against 64tass so a bad probe cannot go unnoticed again.
 */
const CPU_FLAG: Record<string, string[]> = {
    '6502': ['--m6502'], '65c02': ['--m65c02'], '65816': ['--m65816'], '4510': ['--m4510'],
};

function assembles(cpu: string, source: string): boolean {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '64tass-rm-'));
    try {
        const file = path.join(dir, 'p.asm');
        fs.writeFileSync(file, `        * = $1000\n        ${source}\n`);
        return !/error:/.test(compile(file, CPU_FLAG[cpu] ?? []).stderr);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe.skipIf(!TASS_EXISTS)('register modes match the assembler', () => {
    it.each(Object.keys(CPU_FLAG))('every pair the table lists is accepted on %s', (cpu) => {
        const rejected: string[] = [];
        for (const [opcode, registers] of Object.entries(registerModesForCpu(cpu))) {
            for (const register of registers) {
                if (!assembles(cpu, `${opcode} ${register}`)) rejected.push(`${opcode} ${register}`);
            }
        }
        expect(rejected).toEqual([]);
    });

    it('lists ldx s (TSX) for every CPU that has it', () => {
        // The case the original probe missed
        for (const cpu of Object.keys(CPU_FLAG)) {
            expect(assembles(cpu, 'ldx s'), `${cpu}: ldx s should assemble`).toBe(true);
            expect(registerModesForCpu(cpu).ldx, `${cpu} table`).toContain('s');
        }
    });

    it('does not list a pair the assembler rejects', () => {
        for (const cpu of Object.keys(CPU_FLAG)) {
            expect(assembles(cpu, 'sta x')).toBe(false);
            expect(registerModesForCpu(cpu).sta ?? []).not.toContain('x');
        }
    });

    it('every opcode in the table exists for that CPU', () => {
        for (const cpu of Object.keys(CPU_FLAG)) {
            for (const opcode of Object.keys(registerModesForCpu(cpu))) {
                expect(opcodesForCpu(cpu).has(opcode), `${cpu}: ${opcode}`).toBe(true);
            }
        }
    });
});
