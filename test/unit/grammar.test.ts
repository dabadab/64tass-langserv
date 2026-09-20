import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The TextMate grammar decides colour only, so it has no module to import - but
 * its patterns are still regexes with rules behind them, and these are the rules
 * the manual states. Applied here with JS regexes: Oniguruma differs in corners
 * none of this touches.
 */
const GRAMMAR = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'syntaxes', '64tass.tmLanguage.json'), 'utf-8'));

/** The scope the first matching rule of `group` gives `text`, whole. */
function scopeOf(group: string, text: string): string | null {
    for (const pattern of GRAMMAR.repository[group].patterns) {
        const match = text.match(new RegExp(pattern.match));
        if (match && match[0] === text) {
            return pattern.name ?? pattern.captures['1'].name;
        }
    }
    return null;
}

describe('the grammar, on numbers', () => {
    // Every form the manual documents, each verified to assemble.
    it.each([
        ['$ff', 'constant.numeric.hex.64tass'],
        ['$ff_ff', 'constant.numeric.hex.64tass'],
        ['%1010', 'constant.numeric.binary.64tass'],
        ['%1010_1010', 'constant.numeric.binary.64tass'],
        ['42', 'constant.numeric.decimal.64tass'],
        ['1_000', 'constant.numeric.decimal.64tass'],
        ['3.66e1', 'constant.numeric.float.64tass'],
        ['.5', 'constant.numeric.float.64tass'],
        ['12.2p8', 'constant.numeric.float.64tass'],
        ['$1.8p4', 'constant.numeric.float.hex.64tass'],
        ['%1.1p2', 'constant.numeric.float.binary.64tass'],
    ])('colours %s', (text, scope) => {
        expect(scopeOf('numbers', text)).toBe(scope);
    });

    it('leaves a name that merely contains digits alone', () => {
        for (const name of ['tbl_2', 'x2', 'sprite1']) {
            expect(scopeOf('numbers', name), name).toBeNull();
        }
    });
});

describe('the grammar, on strings', () => {
    it('marks a byte string prefix as its own token', () => {
        expect(scopeOf('strings', 'b"oeU"')).toBe('storage.type.string.64tass');
        expect(scopeOf('strings', "x'fce2'")).toBe('storage.type.string.64tass');
    });

    it('colours a plain string as one', () => {
        expect(scopeOf('strings', '"plain"')).toBe('string.quoted.double.64tass');
        expect(scopeOf('strings', "'plain'")).toBe('string.quoted.single.64tass');
    });

    it('does not take the tail of a name for a prefix', () => {
        // `sym"abc"` is "an operator is expected" to the assembler, not a byte
        // string, so the `m` must not colour as one.
        expect(scopeOf('strings', 'sym"abc"')).toBeNull();
    });
});
