import { describe, it, expect } from 'vitest';
import {
    parseLineStructure,
    stripComment,
    stripStrings,
    getCommentStart,
    extractComment,
    getBlockComment,
    parseNumericValue,
    formatNumericValue,
    escapeRegex
} from '../../src/server/utils';

describe('parseLineStructure', () => {
    it('returns full line as code when no comment', () => {
        const result = parseLineStructure('lda #$FF');
        expect(result.code).toBe('lda #$FF');
        expect(result.commentStart).toBe(-1);
    });

    it('returns code and comment position for simple comment', () => {
        const result = parseLineStructure('lda #$FF ; load acc');
        expect(result.code).toBe('lda #$FF ');
        expect(result.commentStart).toBe(9);
    });

    it('preserves semicolon inside double-quoted string', () => {
        const result = parseLineStructure('.text "a;b"');
        expect(result.code).toBe('.text "a;b"');
        expect(result.commentStart).toBe(-1);
    });

    it('preserves semicolon inside single-quoted string', () => {
        const result = parseLineStructure(".text 'a;b'");
        expect(result.code).toBe(".text 'a;b'");
        expect(result.commentStart).toBe(-1);
    });

    it('handles doubled quote escape then comment', () => {
        const result = parseLineStructure('.text "a""b" ; comment');
        expect(result.code).toBe('.text "a""b" ');
        expect(result.commentStart).toBe(13);
    });

    it('handles comment-only line', () => {
        const result = parseLineStructure('; this is a comment');
        expect(result.code).toBe('');
        expect(result.commentStart).toBe(0);
    });

    it('handles empty line', () => {
        const result = parseLineStructure('');
        expect(result.code).toBe('');
        expect(result.commentStart).toBe(-1);
    });

    it('finds first semicolon outside strings', () => {
        const result = parseLineStructure('lda #1 ; a ; b');
        expect(result.code).toBe('lda #1 ');
        expect(result.commentStart).toBe(7);
    });

    it('handles unclosed string', () => {
        const result = parseLineStructure('.text "abc');
        expect(result.code).toBe('.text "abc');
        expect(result.commentStart).toBe(-1);
    });

    it('handles comment after string', () => {
        const result = parseLineStructure('.text "hello" ; msg');
        expect(result.code).toBe('.text "hello" ');
        expect(result.commentStart).toBe(14);
    });
});

describe('stripComment', () => {
    it('returns line unchanged when no comment', () => {
        expect(stripComment('lda #$FF')).toBe('lda #$FF');
    });

    it('strips simple comment', () => {
        expect(stripComment('lda #$FF ; load acc')).toBe('lda #$FF ');
    });

    it('preserves semicolon inside double-quoted string', () => {
        expect(stripComment('.text "a;b"')).toBe('.text "a;b"');
    });

    it('preserves semicolon inside single-quoted string', () => {
        expect(stripComment(".text 'a;b'")).toBe(".text 'a;b'");
    });

    it('handles doubled double-quote escape then comment', () => {
        expect(stripComment('.text "a""b" ; comment')).toBe('.text "a""b" ');
    });

    it('handles doubled single-quote escape then comment', () => {
        expect(stripComment(".text 'a''b' ; comment")).toBe(".text 'a''b' ");
    });

    it('strips comment after string', () => {
        expect(stripComment('.text "hello" ; msg')).toBe('.text "hello" ');
    });

    it('strips comment-only line', () => {
        expect(stripComment('; this is a comment')).toBe('');
    });

    it('returns empty string for empty line', () => {
        expect(stripComment('')).toBe('');
    });

    it('strips at first semicolon outside strings', () => {
        expect(stripComment('lda #1 ; a ; b')).toBe('lda #1 ');
    });

    it('returns full line for unclosed string (no semicolon found)', () => {
        expect(stripComment('.text "abc')).toBe('.text "abc');
    });
});

describe('stripStrings', () => {
    it('returns line unchanged when no strings', () => {
        expect(stripStrings('lda #1')).toBe('lda #1');
    });

    it('replaces double-quoted string content with spaces', () => {
        const result = stripStrings('.text "abc"');
        expect(result).toBe('.text "   "');
    });

    it('replaces single-quoted string content with spaces', () => {
        const result = stripStrings(".text 'abc'");
        expect(result).toBe(".text '   '");
    });

    it('handles doubled quote escape', () => {
        const result = stripStrings('.text "a""b"');
        // "a""b" -> opening quote kept, a->space, ""->two spaces, b->space, closing quote kept
        expect(result).toBe('.text "    "');
    });

    it('preserves line length', () => {
        const input = '.text "hello", \'world\'';
        expect(stripStrings(input).length).toBe(input.length);
    });

    it('handles multiple strings on one line', () => {
        const result = stripStrings('.byte "a", "b"');
        expect(result).toBe('.byte " ", " "');
    });
});

describe('getCommentStart', () => {
    it('returns -1 when no comment', () => {
        expect(getCommentStart('lda #1')).toBe(-1);
    });

    it('returns index of semicolon', () => {
        expect(getCommentStart('nop ; comment')).toBe(4);
    });

    it('returns -1 when semicolon is inside string', () => {
        expect(getCommentStart('.text "a;b"')).toBe(-1);
    });

    it('returns correct index after string', () => {
        const line = '.text "a" ; c';
        expect(getCommentStart(line)).toBe(10);
    });

    it('returns 0 for comment-only line', () => {
        expect(getCommentStart('; comment')).toBe(0);
    });
});

describe('extractComment', () => {
    it('returns null when no semicolon', () => {
        expect(extractComment('lda #1')).toBeNull();
    });

    it('strips one leading space', () => {
        expect(extractComment('; hello')).toBe('hello');
    });

    it('returns comment without leading space if none present', () => {
        expect(extractComment(';hello')).toBe('hello');
    });

    it('returns null for empty comment', () => {
        expect(extractComment(';')).toBeNull();
    });

    it('returns null for comment with only whitespace', () => {
        expect(extractComment(';   ')).toBeNull();
    });

    it('extracts inline comment', () => {
        expect(extractComment('lda #1 ; load value')).toBe('load value');
    });
});

describe('getBlockComment', () => {
    it('returns same-line comment', () => {
        expect(getBlockComment(['label ; doc'], 0)).toBe('doc');
    });

    it('returns single comment line above', () => {
        expect(getBlockComment(['; doc', 'label'], 1)).toBe('doc');
    });

    it('joins multiple comment lines above', () => {
        const lines = ['; line1', '; line2', 'label'];
        expect(getBlockComment(lines, 2)).toBe('line1  \nline2');
    });

    it('returns comment line below', () => {
        expect(getBlockComment(['label', '; doc below'], 0)).toBe('doc below');
    });

    it('joins multiple comment lines below', () => {
        const lines = ['label', '; line1', '; line2'];
        expect(getBlockComment(lines, 0)).toBe('line1  \nline2');
    });

    it('prefers same-line over above', () => {
        const lines = ['; above', 'label ; inline'];
        expect(getBlockComment(lines, 1)).toBe('inline');
    });

    it('prefers above over below', () => {
        const lines = ['; above', 'label', '; below'];
        expect(getBlockComment(lines, 1)).toBe('above');
    });

    it('returns undefined when no comment', () => {
        expect(getBlockComment(['label'], 0)).toBeUndefined();
    });

    it('stops at non-comment line above', () => {
        const lines = ['; c1', 'code', '; c2', 'label'];
        expect(getBlockComment(lines, 3)).toBe('c2');
    });
});

describe('parseNumericValue', () => {
    it('parses hex with $ prefix', () => {
        expect(parseNumericValue('$FF')).toBe(255);
    });

    it('parses hex with 0x prefix', () => {
        expect(parseNumericValue('0xFF')).toBe(255);
    });

    it('parses hex with 0X prefix (case insensitive)', () => {
        expect(parseNumericValue('0XAB')).toBe(171);
    });

    it('parses binary with % prefix', () => {
        expect(parseNumericValue('%10101010')).toBe(170);
    });

    it('parses binary with 0b prefix', () => {
        expect(parseNumericValue('0b11111111')).toBe(255);
    });

    it('parses decimal', () => {
        expect(parseNumericValue('42')).toBe(42);
    });

    it('parses negative decimal', () => {
        expect(parseNumericValue('-1')).toBe(-1);
    });

    it('parses zero', () => {
        expect(parseNumericValue('0')).toBe(0);
    });

    it('trims whitespace', () => {
        expect(parseNumericValue('  $FF  ')).toBe(255);
    });

    it('returns null for non-numeric', () => {
        expect(parseNumericValue('hello')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseNumericValue('')).toBeNull();
    });

    it('returns null for hex digits without prefix', () => {
        expect(parseNumericValue('FF')).toBeNull();
    });

    it('returns null for invalid hex', () => {
        expect(parseNumericValue('$GG')).toBeNull();
    });

    it('returns null for invalid binary', () => {
        expect(parseNumericValue('%102')).toBeNull();
    });
});

describe('formatNumericValue', () => {
    it('formats 255', () => {
        expect(formatNumericValue(255)).toBe('%11111111, 255, $FF');
    });

    it('formats zero', () => {
        expect(formatNumericValue(0)).toBe('%0, 0, $0');
    });

    it('formats negative', () => {
        expect(formatNumericValue(-1)).toBe('-%1, -1, -$1');
    });

    it('formats power of 2', () => {
        expect(formatNumericValue(256)).toBe('%100000000, 256, $100');
    });
});

describe('escapeRegex', () => {
    it('escapes all special regex characters', () => {
        const input = '.*+?^${}()|[]\\';
        const escaped = escapeRegex(input);
        // Should be able to use in RegExp without error
        expect(() => new RegExp(escaped)).not.toThrow();
        // Should match literal string, not as regex pattern
        const pattern = new RegExp(escaped);
        expect(pattern.test(input)).toBe(true);
    });

    it('escapes dot character', () => {
        const escaped = escapeRegex('a.b');
        const pattern = new RegExp(escaped);
        expect(pattern.test('a.b')).toBe(true);
        expect(pattern.test('axb')).toBe(false); // . should not match any char
    });

    it('escapes asterisk character', () => {
        const escaped = escapeRegex('a*b');
        const pattern = new RegExp(escaped);
        expect(pattern.test('a*b')).toBe(true);
        expect(pattern.test('ab')).toBe(false); // * should not mean zero or more
        expect(pattern.test('aaaaab')).toBe(false);
    });

    it('escapes plus character', () => {
        const escaped = escapeRegex('a+b');
        const pattern = new RegExp(escaped);
        expect(pattern.test('a+b')).toBe(true);
        expect(pattern.test('ab')).toBe(false); // + should not mean one or more
    });

    it('escapes parentheses', () => {
        const escaped = escapeRegex('(abc)');
        const pattern = new RegExp(escaped);
        expect(pattern.test('(abc)')).toBe(true);
    });

    it('escapes square brackets', () => {
        const escaped = escapeRegex('[abc]');
        const pattern = new RegExp(escaped);
        expect(pattern.test('[abc]')).toBe(true);
        expect(pattern.test('a')).toBe(false); // [abc] should not match character class
    });

    it('handles symbol names from 64tass code', () => {
        // Real-world test: symbol names that could be problematic
        const symbols = ['_local', 'label.sub', 'my$var', 'x+y'];
        symbols.forEach(sym => {
            const escaped = escapeRegex(sym);
            const pattern = new RegExp(`\\b${escaped}\\b`);
            expect(() => pattern.test('some code')).not.toThrow();
        });
    });

    it('throws TypeError for non-string input', () => {
        expect(() => escapeRegex(null as any)).toThrow(TypeError);
        expect(() => escapeRegex(undefined as any)).toThrow(TypeError);
        expect(() => escapeRegex(123 as any)).toThrow(TypeError);
    });

    it('handles empty string', () => {
        expect(escapeRegex('')).toBe('');
    });

    it('handles strings with no special characters', () => {
        expect(escapeRegex('abc123')).toBe('abc123');
        expect(escapeRegex('label_name')).toBe('label_name');
    });
});
