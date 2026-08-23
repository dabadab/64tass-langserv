import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { TASS_PATH, TASS_EXISTS, TABLES_MATCH_TASS, CPU_FLAG } from '../helpers/compiler';
import { CPU_NAMES, opcodesForCpu } from '../../src/server/constants';
import { findAddressingProblem } from '../../src/server/operands';
import { findOversizedImmediate } from '../../src/server/diagnostics';
import { DocumentIndex } from '../../src/server/types';

/**
 * The addressing-mode diagnostic, checked against the assembler for every
 * mnemonic of every target in every operand shape - about 25,000 lines.
 *
 * What must hold is ONE-SIDED: the extension must never report a form 64tass
 * accepts. The reverse is expected and fine - `pei ($10)` assembles but reads
 * back from the disassembly as a plain address, and forms whose only error is
 * about the VALUE (`lda #$1234`) are not this check's business either.
 *
 * Gated on the assembler version like the other generated-table suites: the
 * verdicts come from `addressing.ts`, which describes one specific build.
 */
const OPERANDS = [
    '$10', '$1234', '$10,x', '$10,y', '$10,z', '$10,s',
    '($10)', '($10),x', '($10),y', '($10),z', '($10),s',
    '($10,x)', '($10,y)', '($10,s)', '($10,s),y', '($10,x),y',
    '[$10]', '[$10],x', '[$10],y', '[$10],z',
];

/** Lines 64tass rejected, by line number, with the message. */
function assemble(cpu: string, lines: string[], dir: string): Map<number, string> {
    const file = path.join(dir, `check_${cpu}.asm`);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    let output = '';
    try {
        execFileSync(TASS_PATH, ['--quiet', '-o', '/dev/null', CPU_FLAG[cpu], file],
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
        output = (e as { stderr?: string }).stderr ?? '';
    }
    const rejected = new Map<number, string>();
    for (const match of output.matchAll(/\.asm:(\d+):\d+: error: (.*)/g)) {
        rejected.set(Number(match[1]), match[2]);
    }
    return rejected;
}

describe.skipIf(!TASS_EXISTS || !TABLES_MATCH_TASS)('addressing diagnostic against the assembler', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tass-addr-'));

    it.each(CPU_NAMES)('reports nothing %s accepts', (cpu) => {
        const lines = ['        *= $1000', 'lbl     nop'];
        const cases: [string, string][] = [];
        for (const mnemonic of [...opcodesForCpu(cpu)].sort()) {
            for (const operand of OPERANDS) {
                lines.push(`        ${mnemonic} ${operand}`);
                cases.push([mnemonic, operand]);
            }
        }
        const rejected = assemble(cpu, lines, dir);

        const falsePositives = cases
            .map(([mnemonic, operand], i) => ({ mnemonic, operand, error: rejected.get(i + 3) }))
            .filter(({ mnemonic, operand, error }) =>
                error === undefined && findAddressingProblem(cpu, mnemonic, operand) !== null)
            .map(({ mnemonic, operand }) => `${mnemonic} ${operand}`);

        expect(falsePositives).toEqual([]);
    });

    const IMMEDIATES = ['#$10', '#$1234', '#255', '#256', '#-1', '#-129', '#<$1234', '#>$1234'];

    it.each(CPU_NAMES)('reports no immediate %s accepts', (cpu) => {
        const lines = ['        *= $1000', 'lbl     nop'];
        const cases: [string, string][] = [];
        for (const mnemonic of [...opcodesForCpu(cpu)].sort()) {
            for (const operand of IMMEDIATES) {
                lines.push(`        ${mnemonic} ${operand}`);
                cases.push([mnemonic, operand]);
            }
        }
        const rejected = assemble(cpu, lines, dir);
        const empty = new Map<string, DocumentIndex>();

        const falsePositives = cases
            .map(([mnemonic, operand], i) => ({ mnemonic, operand, error: rejected.get(i + 3) }))
            .filter(({ mnemonic, operand, error }) => error === undefined
                && findOversizedImmediate(cpu, mnemonic, operand, 'file:///x.asm', 0, empty, false) !== null)
            .map(({ mnemonic, operand }) => `${mnemonic} ${operand}`);

        expect(falsePositives).toEqual([]);
    });

    it('does report the forms 64tass rejects outright', () => {
        // The other half: silence everywhere would also pass the test above.
        expect(findAddressingProblem('6502i', 'lda', '($10),x')?.message)
            .toBe("no indirect x indexed addressing mode for opcode 'lda'");
        expect(findAddressingProblem('6502i', 'ldx', '$10,x')?.message)
            .toBe("no x indexed addressing mode for opcode 'ldx'");
        expect(findOversizedImmediate('6502i', 'lda', '#$1234', 'file:///x.asm', 0, new Map(), false))
            .toBe('4660 does not fit in 8 bits');
    });
});
