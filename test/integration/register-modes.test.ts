import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TASS_EXISTS, TASS_PATH, TABLES_MATCH_TASS, CPU_FLAG, compile } from '../helpers/compiler';
import * as cp from 'child_process';
import { registerModesForCpu, opcodesForCpu } from '../../src/server/constants';
import { indexRegistersFor, CommaContext } from '../../src/server/completions';

/**
 * The register-mode table was probed from the assembler, and a flaw in that probe
 * silently dropped `ldx s` for the 65816. These tests check the shipped table back
 * against 64tass so a bad probe cannot go unnoticed again.
 */
const PROBED_CPUS = ['6502', '6502i', '65c02', '65816', '4510'];

function assembles(cpu: string, source: string): boolean {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '64tass-rm-'));
    try {
        const file = path.join(dir, 'p.asm');
        fs.writeFileSync(file, `        * = $1000\n        ${source}\n`);
        return !/error:/.test(compile(file, [CPU_FLAG[cpu]]).stderr);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe.skipIf(!TASS_EXISTS || !TABLES_MATCH_TASS)('register modes match the assembler', () => {
    it.each(PROBED_CPUS)('every pair the table lists is accepted on %s', (cpu) => {
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
        for (const cpu of PROBED_CPUS) {
            expect(assembles(cpu, 'ldx s'), `${cpu}: ldx s should assemble`).toBe(true);
            expect(registerModesForCpu(cpu).ldx, `${cpu} table`).toContain('s');
        }
    });

    it('does not list a pair the assembler rejects', () => {
        for (const cpu of PROBED_CPUS) {
            expect(assembles(cpu, 'sta x')).toBe(false);
            expect(registerModesForCpu(cpu).sta ?? []).not.toContain('x');
        }
    });

    it('every opcode in the table exists for that CPU', () => {
        for (const cpu of PROBED_CPUS) {
            for (const opcode of Object.keys(registerModesForCpu(cpu))) {
                expect(opcodesForCpu(cpu).has(opcode), `${cpu}: ${opcode}`).toBe(true);
            }
        }
    });
});

/**
 * Assemble one instruction and return the assembler's own disassembly of it, or
 * null if it does not assemble. The monitor column is what separates a real
 * index from an addressing-size override: `lda $10,x` disassembles as `lda $10,x`
 * but `lda $10,b` as plain `lda $0010` - the `,b` only forces 16-bit addressing
 * and does not index at all.
 */
function monitorFor(cpu: string, source: string): string | null {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '64tass-idx-'));
    try {
        const file = path.join(dir, 'p.asm');
        const listing = path.join(dir, 'l.txt');
        fs.writeFileSync(file, `        * = $1000\n        .as\n        .xs\n        ${source}\n`);
        try {
            cp.execSync(`${TASS_PATH} --quiet ${CPU_FLAG[cpu]} -o /dev/null -L ${listing} ${file} 2>/dev/null`);
        } catch {
            return null;
        }
        for (const line of fs.readFileSync(listing, 'utf-8').split('\n')) {
            if (!line.startsWith('.')) continue;
            const parts = line.split('\t').filter(s => s.length > 0);
            if (parts.length >= 3) return parts[2].trim();
        }
        return null;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe.skipIf(!TASS_EXISTS)('index register completion matches the assembler', () => {
    /**
     * The completion offered after a comma is derived from the addressing table.
     * This checks that derivation against the assembler in both directions: every
     * register offered really indexes, and no register that really indexes is
     * left out.
     *
     * The `,b` `,d` `,k` `,r` suffixes are deliberately not offered. They
     * assemble, but they are addressing-size and bank overrides rather than
     * indices - the assembler disassembles `lda $10,b` as a plain absolute
     * `lda $0010` - so they are excluded here too.
     */
    const CASES: [cpu: string, mnemonic: string, before: string, after: string][] = [
        ['6502', 'lda', '$10', ''],
        ['6502', 'ldx', '$10', ''],
        ['6502', 'inc', '$10', ''],
        ['6502', 'sta', '$10', ''],
        ['65816', 'lda', '$10', ''],
        ['4510', 'lda', '$10', ''],
        ['6502', 'lda', '($10', ')'],
        ['6502', 'lda', '($10)', ''],
        ['4510', 'lda', '($10)', ''],
        ['65816', 'lda', '($10', ')'],
    ];

    it.each(CASES)('%s: %s %s,_%s', (cpu, mnemonic, before, after) => {
        const context: CommaContext = after !== '' ? 'inside' : before.endsWith(')') ? 'after-close' : 'plain';
        const offered = indexRegistersFor(cpu, mnemonic, context);

        /**
         * Does this letter actually index here, by the assembler's own account?
         *
         * The instruction may still need finishing after the cursor - the 65816's
         * only stack-indirect form is `lda ($10,s),y`, so `($10,s)` on its own is
         * rejected - hence the optional tail.
         */
        const indexes = (register: string) => {
            for (const tail of ['', ',y', ',z']) {
                const monitor = monitorFor(cpu, `${mnemonic} ${before},${register}${after}${tail}`);
                if (monitor !== null && new RegExp(`,\\s*${register}\\b`, 'i').test(monitor)) return true;
            }
            return false;
        };

        expect(offered.filter(r => !indexes(r)), 'offered but does not index').toEqual([]);
        const missed = 'abdikpqrsxyz'.split('').filter(r => !offered.includes(r) && indexes(r));
        expect(missed, 'indexes but was not offered').toEqual([]);
    }, 60000);
});
