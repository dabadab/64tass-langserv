import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { TASS_PATH, TASS_EXISTS } from '../helpers/compiler';
import { assemble } from '../../src/server/assembler';

/**
 * The assembler runner against the real thing: a broken fixture whose errors are
 * split across a root and its include, so both the parsing and the per-file
 * routing are checked on genuine 64tass output rather than a transcription of it.
 */
const DIR = path.join(__dirname, '..', 'fixtures', 'assembler-errors');

describe.skipIf(!TASS_EXISTS)('running the assembler', () => {
    it('reports each file\'s errors against that file', async () => {
        const result = await assemble({ assemblerPath: TASS_PATH, file: path.join(DIR, 'main.asm') });

        expect(result.failure).toBeNull();
        const main = result.diagnostics.get(pathToFileURL(path.join(DIR, 'main.asm')).toString());
        const sub = result.diagnostics.get(pathToFileURL(path.join(DIR, 'sub.inc')).toString());

        expect(main?.map(d => d.range.start.line)).toEqual([5]);
        expect(main?.[0].message).toContain('8 bit');
        expect(sub?.map(d => d.range.start.line)).toEqual([2]);
        expect(sub?.[0].message).toBe("no indirect x indexed addressing mode for opcode 'lda'");
    });

    it('reports a run that could not happen at all', async () => {
        const result = await assemble({
            assemblerPath: path.join(DIR, 'no-such-assembler'),
            file: path.join(DIR, 'main.asm'),
        });
        expect(result.failure).not.toBeNull();
        expect(result.diagnostics.size).toBe(0);
    });
});
