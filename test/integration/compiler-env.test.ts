import { describe, it, expect } from 'vitest';
import { TASS_EXISTS, REQUIRE_TASS } from '../helpers/compiler';

describe('compiler test environment', () => {
    it('exposes whether the assembler was found', () => {
        expect(typeof TASS_EXISTS).toBe('boolean');
    });

    // The point of T4: a missing assembler must not quietly produce a green run.
    // With REQUIRE_TASS set, importing the helper throws before this can run, so
    // reaching here with the flag set means the binary really is present.
    it('has the assembler available when REQUIRE_TASS is set', () => {
        if (REQUIRE_TASS) expect(TASS_EXISTS).toBe(true);
        else expect(REQUIRE_TASS).toBe(false);
    });
});
