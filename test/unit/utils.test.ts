import { describe, it, expect } from 'vitest';
import {
    findDictKeys,
    stripDictKeys,
    findCommentBlockLines,
    splitTopLevel,
    parameterName,
    parseLineStructure,
    stripComment,
    stripStrings,
    getCommentStart,
    extractComment,
    getBlockComment,
    parseNumericValue,
    formatNumericValue,
    escapeRegex,
    detectCaseSensitivityPragma,
    detectDefinePragmas,
    detectCpu,
    tokenizeExpression
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

    // A ';' inside a string literal is not a comment. Ignoring that turned
    // `msg .text "a;b"` into the phantom documentation comment `b"`.
    it('ignores a semicolon inside a double-quoted string', () => {
        expect(extractComment('msg .text "a;b"')).toBeNull();
    });

    it('ignores a semicolon inside a single-quoted string', () => {
        expect(extractComment("msg .text 'x;y'")).toBeNull();
    });

    it('handles a doubled-quote escape before a semicolon', () => {
        expect(extractComment('msg .text "a"";"";b"')).toBeNull();
    });

    it('still finds a real comment after a string containing a semicolon', () => {
        expect(extractComment('msg .text "a;b" ; real comment')).toBe('real comment');
    });

    it('still finds a comment after a plain string', () => {
        expect(extractComment('msg .text "hello" ; greeting')).toBe('greeting');
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

describe('getBlockComment - strings', () => {
    it('does not attach a phantom comment from a semicolon inside a string', () => {
        expect(getBlockComment(['msg .text "a;b"'], 0)).toBeUndefined();
    });

    it('still attaches a real trailing comment', () => {
        expect(getBlockComment(['msg .text "a;b" ; the message'], 0)).toBe('the message');
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
});

describe('tokenizeExpression', () => {
    // Compare as "type:text" so both the split points and the classification are pinned
    const shape = (expr: string) => tokenizeExpression(expr).map(t => `${t.type}:${t.text}`);

    it('tokenizes integers, operators and parens', () => {
        expect(shape('2*(3+4)')).toEqual([
            'value:2', 'operator:*', 'paren:(', 'value:3', 'operator:+', 'value:4', 'paren:)'
        ]);
    });

    it('tokenizes the numeric bases', () => {
        expect(shape('$FF, 0xAB, %1010, 0b11, 12')).toEqual([
            'value:$FF', 'operator:,', 'value:0xAB', 'operator:,',
            'value:%1010', 'operator:,', 'value:0b11', 'operator:,', 'value:12'
        ]);
    });

    it('keeps a float as a single value', () => {
        expect(shape('360.0')).toEqual(['value:360.0']);
        expect(shape('.5')).toEqual(['value:.5']);
        expect(shape('1.')).toEqual(['value:1.']);
        expect(shape('360.0/4')).toEqual(['value:360.0', 'operator:/', 'value:4']);
    });

    it('keeps exponent notation as a single value', () => {
        expect(shape('1e2')).toEqual(['value:1e2']);
        expect(shape('2.5e-3')).toEqual(['value:2.5e-3']);
        expect(shape('1E+4')).toEqual(['value:1E+4']);
    });

    it('keeps a dotted reference as a single value', () => {
        expect(shape('tbl.lo')).toEqual(['value:tbl.lo']);
        expect(shape('scope.sub.val')).toEqual(['value:scope.sub.val']);
    });

    it('tokenizes macro arguments', () => {
        expect(shape('\\1')).toEqual(['value:\\1']);
        expect(shape('\\@')).toEqual(['value:\\@']);
        expect(shape('\\name')).toEqual(['value:\\name']);
        expect(shape('\\1 * 2')).toEqual(['value:\\1', 'operator:*', 'value:2']);
    });

    it('treats a string literal as one value', () => {
        expect(shape('"hello", "wor""ld"')).toEqual(['value:"hello"', 'operator:,', 'value:"wor""ld"']);
    });

    it('reports adjacent values for a genuinely missing operator', () => {
        expect(shape('1 2')).toEqual(['value:1', 'value:2']);
        expect(shape('1.5 2.5')).toEqual(['value:1.5', 'value:2.5']);
    });

    it('records the start offset of each token', () => {
        expect(tokenizeExpression('360.0 / x').map(t => t.start)).toEqual([0, 6, 8]);
    });
});

describe('detectCaseSensitivityPragma', () => {
    it('detects case-sensitive pragma', () => {
        expect(detectCaseSensitivityPragma('; 64tass-langserv: case-sensitive')).toBe(true);
    });

    it('detects case-insensitive pragma', () => {
        expect(detectCaseSensitivityPragma('; 64tass-langserv: case-insensitive')).toBe(false);
    });

    it('returns null when no pragma present', () => {
        const source = 'start\n        lda #1\n        rts';
        expect(detectCaseSensitivityPragma(source)).toBeNull();
    });

    it('matches case-insensitively and with varied whitespace', () => {
        expect(detectCaseSensitivityPragma(';   64TASS-LANGSERV:CASE-SENSITIVE')).toBe(true);
        expect(detectCaseSensitivityPragma(';64tass-langserv:   case-insensitive  ')).toBe(false);
    });

    it('finds the pragma anywhere in the file, not just the first line', () => {
        const source = 'start\n        lda #1\n; 64tass-langserv: case-sensitive\n        rts';
        expect(detectCaseSensitivityPragma(source)).toBe(true);
    });

    it('uses the first match when multiple pragmas are present', () => {
        const source = '; 64tass-langserv: case-sensitive\n; 64tass-langserv: case-insensitive';
        expect(detectCaseSensitivityPragma(source)).toBe(true);
    });

    it('does not match a similar-looking but non-pragma comment', () => {
        const source = '; this file needs 64tass-langserv: case-sensitive support eventually';
        expect(detectCaseSensitivityPragma(source)).toBeNull();
    });

    it('does not match plain 64tass directive comments', () => {
        expect(detectCaseSensitivityPragma('; case-sensitive mode is nice')).toBeNull();
    });

    it('handles strings with no special characters', () => {
        expect(escapeRegex('abc123')).toBe('abc123');
        expect(escapeRegex('label_name')).toBe('label_name');
    });
});

describe('detectDefinePragmas', () => {
    it('finds a define pragma', () => {
        expect(detectDefinePragmas('; 64tass-langserv: define linking = 0'))
            .toEqual([{ name: 'linking', value: '0', line: 0, nameStart: 26 }]);
    });

    it('accepts varied spacing and casing', () => {
        const found = detectDefinePragmas(';64tass-langserv:DEFINE  below_io=$01  ');
        expect(found).toHaveLength(1);
        expect(found[0].name).toBe('below_io');
        expect(found[0].value).toBe('$01');
    });

    it('finds several across the file and records their lines', () => {
        const found = detectDefinePragmas('; 64tass-langserv: define a = 1\nstart\n; 64tass-langserv: define b = 2');
        expect(found.map(d => [d.name, d.value, d.line])).toEqual([['a', '1', 0], ['b', '2', 2]]);
    });

    it('returns an empty list when absent', () => {
        expect(detectDefinePragmas('start\n        lda #1')).toEqual([]);
    });

    it('ignores prose mentioning the pragma', () => {
        expect(detectDefinePragmas('; we should define linking = 0 one day')).toEqual([]);
        expect(detectDefinePragmas('; 64tass-langserv: define')).toEqual([]);
    });

    it('does not confuse the case-sensitivity pragma for a define', () => {
        expect(detectDefinePragmas('; 64tass-langserv: case-sensitive')).toEqual([]);
    });
});

describe('detectCpu', () => {
    it('reads the .cpu directive', () => {
        expect(detectCpu('        .cpu "65816"\nstart')).toBe('65816');
        expect(detectCpu("        .cpu '65c02'\nstart")).toBe('65c02');
    });

    it('reads the cpu pragma', () => {
        expect(detectCpu('; 64tass-langserv: cpu 4510\nstart')).toBe('4510');
        expect(detectCpu(';64tass-langserv:CPU   45gs02  \nstart')).toBe('45gs02');
    });

    it('lowercases the name', () => {
        expect(detectCpu('        .cpu "65816"')).toBe('65816');
        expect(detectCpu('        .cpu "65C02"')).toBe('65c02');
    });

    it('returns null when the file says nothing', () => {
        expect(detectCpu('start\n        lda #1')).toBeNull();
    });

    it('takes whichever comes first', () => {
        expect(detectCpu('; 64tass-langserv: cpu 4510\n        .cpu "65816"')).toBe('4510');
        expect(detectCpu('        .cpu "65816"\n; 64tass-langserv: cpu 4510')).toBe('65816');
    });

    it('ignores prose that merely mentions cpu', () => {
        expect(detectCpu('; we use cpu 65816 here\nstart')).toBeNull();
    });
});

describe('splitTopLevel', () => {
    it('splits on top-level separators', () => {
        expect(splitTopLevel('a, b, c').map(s => s.trim())).toEqual(['a', 'b', 'c']);
    });

    it('ignores separators inside brackets', () => {
        expect(splitTopLevel('a = [1,2,3], b = 9').map(s => s.trim())).toEqual(['a = [1,2,3]', 'b = 9']);
        expect(splitTopLevel('a = range(0,4), b').map(s => s.trim())).toEqual(['a = range(0,4)', 'b']);
    });

    it('ignores separators inside strings', () => {
        expect(splitTopLevel('a = "x,y", b').map(s => s.trim())).toEqual(['a = "x,y"', 'b']);
    });

    it('handles a doubled quote as an escape', () => {
        expect(splitTopLevel('a = "say ""hi"", ok", b')).toHaveLength(2);
    });

    it('returns one part when there is no separator', () => {
        expect(splitTopLevel('single')).toEqual(['single']);
    });
});

describe('parameterName', () => {
    it('returns a plain name', () => {
        expect(parameterName('ptr')).toBe('ptr');
    });

    it('drops a type annotation', () => {
        expect(parameterName('_data : binary')).toBe('_data');
    });

    it('drops a default value', () => {
        expect(parameterName('count = 5')).toBe('count');
    });

    it('drops both', () => {
        expect(parameterName(' n : int = 5 ')).toBe('n');
    });

    it('returns null when there is no identifier', () => {
        expect(parameterName('   ')).toBeNull();
    });
});

describe('findCommentBlockLines', () => {
    const inside = (source: string) => [...findCommentBlockLines(source.split('\n'))].sort((a, b) => a - b);

    it('returns the interior of a block', () => {
        expect(inside('        .comment\n        junk\n        .endc')).toEqual([1]);
    });

    it('excludes the delimiting lines, which are ordinary', () => {
        // A label on the .comment line is defined (verified), and both lines must
        // still pair up for the unclosed-block check.
        expect(inside('lbl     .comment\n        junk\n        .endcomment')).toEqual([1]);
    });

    it('accepts either closer', () => {
        expect(inside('        .comment\n        a\n        .endcomment')).toEqual([1]);
        expect(inside('        .comment\n        a\n        .endc')).toEqual([1]);
    });

    it('nests', () => {
        const source = ['        .comment', '  a', '        .comment', '  b', '        .endc', '  c', '        .endc', '  d'].join('\n');
        expect(inside(source)).toEqual([1, 3, 5]);
    });

    it('runs to the end of the file when never closed', () => {
        expect(inside('        .comment\n  a\n  b')).toEqual([1, 2]);
    });

    it('returns nothing when there is no block', () => {
        expect(inside('start\n        lda #1')).toEqual([]);
    });

    it('is not fooled by a directive-looking word inside a string', () => {
        expect(inside('        .text "not a .comment here"\n        nop')).toEqual([]);
    });
});

describe('stripDictKeys', () => {
    it('blanks a dotted key inside braces', () => {
        expect(stripDictKeys('d = {.MAP: 1}')).toBe('d = {    : 1}');
    });

    it('preserves length so columns stay right', () => {
        const source = 'COLORING = {.MAP: last == 0, .TILE: last == 1}';
        expect(stripDictKeys(source)).toHaveLength(source.length);
    });

    it('blanks every key of a multi-entry literal', () => {
        expect(stripDictKeys('{.A: 1, .B: 2}')).toBe('{  : 1,   : 2}');
    });

    it('leaves a macro call outside braces alone', () => {
        expect(stripDictKeys('        #setup 1, 2')).toBe('        #setup 1, 2');
        expect(stripDictKeys('        .mymacro 1')).toBe('        .mymacro 1');
    });

    it('leaves a dotted reference that is not a key alone', () => {
        expect(stripDictKeys('        lda tbl.lo')).toBe('        lda tbl.lo');
        expect(stripDictKeys('{.A: tbl.lo}')).toBe('{  : tbl.lo}');
    });

    it('ignores braces inside a string', () => {
        const source = '        .text "{.A: 1}"';
        expect(stripDictKeys(source)).toBe(source);
    });

    it('handles nested braces', () => {
        expect(stripDictKeys('{.A: {.B: 1}}')).toBe('{  : {  : 1}}');
    });

    it('leaves a string key alone', () => {
        expect(stripDictKeys('{"a": 1}')).toBe('{"a": 1}');
    });
});

describe('findDictKeys', () => {
    it('finds the keys of a dict literal', () => {
        expect(findDictKeys('{.MAP: 1, .CHAR: 2}').map(k => k.name)).toEqual(['MAP', 'CHAR']);
    });

    it('reports where each key starts', () => {
        const source = 'D = {.MAP: 1}';
        const [key] = findDictKeys(source);
        expect(source.slice(key.start, key.start + key.length)).toBe('.MAP');
    });

    it('finds none outside braces', () => {
        expect(findDictKeys('        .mymacro 1')).toEqual([]);
    });

    it('ignores braces inside a string', () => {
        expect(findDictKeys('        .text "{.A: 1}"')).toEqual([]);
    });
});
