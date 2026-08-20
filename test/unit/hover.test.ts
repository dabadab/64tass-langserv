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

    it('shows cycle counts on an NMOS target', () => {
        const t = text(opcodeHover('lda', '6502i'));
        expect(t).toContain('| Operand | Opcode | Cycles |');
        expect(t).toContain('| `#$hh` | `$A9` | 2 |');
        expect(t).toContain('| `$hhhh` | `$AD` | 4 |');
    });

    it('marks the forms that pay an extra cycle on a page cross', () => {
        const t = text(opcodeHover('lda', '6502i'));
        expect(t).toContain('| `$hhhh,x` | `$BD` | 4* |');
        expect(t).toContain('+1 cycle if the indexed address crosses a page boundary');
    });

    it('does not mark an indexed store, which always pays it', () => {
        const t = text(opcodeHover('sta', '6502i'));
        expect(t).toContain('| `$hhhh,x` | `$9D` | 5 |');
        expect(t).not.toContain('5*');
    });

    it('marks a branch with its own penalty', () => {
        const t = text(opcodeHover('bne', '6502i'));
        expect(t).toContain('| `<label>` | `$D0` | 2** |');
        expect(t).toContain('+1 cycle if the branch is taken, +2 if it also crosses a page');
    });

    it('shows a jamming opcode as having no count', () => {
        const t = text(opcodeHover('jam', '6502i'));
        expect(t).toContain('| `(implied)` | `$02` | -- |');
        expect(t).toContain('locks the processor up');
    });

    it('explains only the markers it actually used', () => {
        // jsr has no conditional timing at all, so neither footnote belongs.
        const t = text(opcodeHover('jsr', '6502i'));
        expect(t).not.toContain('page boundary');
        expect(t).not.toContain('branch is taken');
    });

    it('falls back to instruction length where timing is not modelled', () => {
        const t = text(opcodeHover('lda', '65816'));
        expect(t).toContain('| Operand | Opcode | Bytes |');
        expect(t).toContain('| `$hhhhhh` | `$AF` | 4 |');
        expect(t).not.toContain('Cycles');
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

    it('shows the documentation comment of a plain constant', () => {
        // Not just scopes: this is what a user actually writes most of the time.
        const { documentIndex, docs } = buildIndex({ source: 'counter = $10   ; how many trees\n        lda #counter' });
        expect(text(symbolHover('counter', docs[0].uri, 1, documentIndex, false))).toContain('how many trees');
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
        const t = text(buildHover('inc', docs[0], 1, documentIndex, false, '6502'));
        expect(t).toContain('**inc**');
        expect(t).not.toContain('Addressing modes');
    });

    it('falls back to the mnemonic when no label matches', () => {
        const { documentIndex, docs } = buildIndex({ source: 'start\n        lda #1' });
        expect(text(buildHover('lda', docs[0], 1, documentIndex, false, '6502'))).toContain('Addressing modes');
    });

    it('returns nothing for a word that is neither', () => {
        const { documentIndex, docs } = buildIndex({ source: 'start\n        rts' });
        expect(buildHover('zzz', docs[0], 1, documentIndex, false, '6502')).toBeNull();
    });
});

describe('closerHover', () => {
    const hoverOn = (source: string, word: string, line: number) => {
        const { documentIndex, docs } = buildIndex({ source });
        return text(buildHover(word, docs[0], line, documentIndex, false));
    };

    it('names the scope a .pend closes', () => {
        expect(hoverOn('myproc  .proc\n        rts\n        .pend', '.pend', 2))
            .toContain('Closes **myproc**');
    });

    it('says where the scope opened', () => {
        expect(hoverOn('myproc  .proc\n        rts\n        .pend', '.pend', 2))
            .toContain('opened on line 1');
    });

    it.each([
        ['.pend', '.proc'],
        ['.bend', '.block'],
        ['.endm', '.macro'],
        ['.endf', '.function'],
        ['.endn', '.namespace'],
    ])('handles %s closing %s', (closer, opener) => {
        const source = `named   ${opener}\n        ${closer}`;
        const shown = hoverOn(source, closer, 1);
        expect(shown).toContain('Closes **named**');
        expect(shown).toContain(`\`${opener}\``);
    });

    it('picks the innermost opener when scopes nest', () => {
        const source = 'outer   .block\ninner   .proc\n        .pend\n        .bend';
        expect(hoverOn(source, '.pend', 2)).toContain('Closes **inner**');
        expect(hoverOn(source, '.bend', 3)).toContain('Closes **outer**');
    });

    it('describes an unnamed block by its directive', () => {
        const shown = hoverOn('        .if 1\n        nop\n        .endif', '.endif', 2);
        expect(shown).toContain('`.if`');
        expect(shown).toContain('opened on line 1');
        expect(shown).not.toContain('Closes **');
    });

    it('does not mistake a loop variable for the block name', () => {
        // ".for i = 0, ..." records i as a loop variable, not as the name of the
        // block, so .next must not claim to be closing "i".
        const shown = hoverOn('        .for i = 0, i < 3, i = i + 1\n        .next', '.next', 1);
        expect(shown).not.toContain('**i**');
        expect(shown).toContain('`.for`');
    });

    it('returns nothing for an unmatched closer', () => {
        const { documentIndex, docs } = buildIndex({ source: '        .bend' });
        expect(buildHover('.bend', docs[0], 0, documentIndex, false)).toBeNull();
    });

    it('answers before a symbol that happens to share the name', () => {
        // findSymbolInfo strips a leading dot to look up a macro, so a symbol
        // called "pend" would otherwise answer for ".pend".
        const source = 'pend    = 1\nmyproc  .proc\n        .pend';
        expect(hoverOn(source, '.pend', 2)).toContain('Closes **myproc**');
    });
});
