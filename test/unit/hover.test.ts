import { describe, it, expect } from 'vitest';
import { buildHover, opcodeHover, symbolHover } from '../../src/server/hover';
import { buildIndex } from '../helpers/doc';

function text(hover: ReturnType<typeof buildHover>): string {
    return (hover?.contents as { value: string })?.value ?? '';
}

describe('opcodeHover', () => {
    it('describes a mnemonic and lists its addressing modes', () => {
        const t = text(opcodeHover('lda', '6502'));
        expect(t).toContain('**LDA**');
        expect(t).toContain('Load the accumulator');
        expect(t).toContain('`N Z`');
        expect(t).toContain('`$A9`');
        expect(t).toContain('`#$hh`');
    });

    it('is case-insensitive about the mnemonic', () => {
        expect(text(opcodeHover('LDA', '6502'))).toContain('**LDA**');
    });

    it('shows only the modes the target CPU has', () => {
        expect(text(opcodeHover('lda', '6502'))).not.toContain('$hhhhhh');
        expect(text(opcodeHover('lda', '65816'))).toContain('$hhhhhh');
        expect(text(opcodeHover('lda', '65c02'))).toContain('`($hh)`');
        expect(text(opcodeHover('lda', '6502'))).not.toContain('`($hh)`');
    });

    it('returns nothing for a mnemonic the CPU does not have', () => {
        expect(opcodeHover('bra', '6502')).toBeNull();
        expect(opcodeHover('bra', '65c02')).not.toBeNull();
    });

    it('returns nothing for a word that is not a mnemonic', () => {
        expect(opcodeHover('mylabel', '6502')).toBeNull();
    });

    it('marks an undocumented opcode as such', () => {
        // lax exists on 6502i, not on plain 6502
        expect(text(opcodeHover('lax', '6502i'))).toContain('undocumented');
        expect(text(opcodeHover('lda', '6502i'))).not.toContain('undocumented');
        expect(opcodeHover('lax', '6502')).toBeNull();
    });

    it('still lists modes for a mnemonic with no written description', () => {
        // The 65CE02/4510 additions are deliberately undescribed; the verified
        // addressing table is shown regardless.
        const t = text(opcodeHover('tza', '4510'));
        expect(t).toContain('**TZA**');
        expect(t).toContain('Addressing modes');
    });

    it('names the CPU the modes belong to', () => {
        expect(text(opcodeHover('lda', '65816'))).toContain('`65816`');
    });
});

describe('symbolHover', () => {
    it('shows a label with its scope and value', () => {
        const { documentIndex, docs } = buildIndex({ source: 'outer   .block\nval     = $FF\n        .bend' });
        const t = text(symbolHover('val', docs[0].uri, 1, documentIndex, false));
        expect(t).toContain('**val**');
        expect(t).toContain('in outer');
        expect(t).toContain('$FF');
    });

    it('returns nothing for an unknown symbol', () => {
        const { documentIndex, docs } = buildIndex({ source: 'start\n        rts' });
        expect(symbolHover('nope', docs[0].uri, 1, documentIndex, false)).toBeNull();
    });
});

describe('buildHover', () => {
    it('prefers a label over a mnemonic of the same name', () => {
        // A label may legitimately be named after an opcode; the definition is the
        // more useful answer when both exist.
        const { documentIndex, docs } = buildIndex({ source: 'inc     = $10\n        lda inc' });
        const t = text(buildHover('inc', docs[0].uri, 1, documentIndex, false, '6502'));
        expect(t).toContain('**inc**');
        expect(t).not.toContain('Addressing modes');
    });

    it('falls back to the mnemonic when no label matches', () => {
        const { documentIndex, docs } = buildIndex({ source: 'start\n        lda #1' });
        expect(text(buildHover('lda', docs[0].uri, 1, documentIndex, false, '6502'))).toContain('Addressing modes');
    });

    it('returns nothing for a word that is neither', () => {
        const { documentIndex, docs } = buildIndex({ source: 'start\n        rts' });
        expect(buildHover('zzz', docs[0].uri, 1, documentIndex, false, '6502')).toBeNull();
    });
});
