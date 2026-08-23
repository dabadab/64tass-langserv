import {
    Location,
    Position,
    Range,
    WorkspaceEdit,
    TextEdit,
    AnnotatedTextEdit,
    ChangeAnnotation,
    TextDocumentEdit,
    OptionalVersionedTextDocumentIdentifier,
    DocumentHighlight,
    DocumentHighlightKind
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { LabelDefinition, DocumentIndex } from './types';
import { parseLineStructure, escapeRegex } from './utils';

/**
 * Normalize a name for matching based on case sensitivity
 */
function normalizeName(name: string, caseSensitive: boolean): string {
    return caseSensitive ? name : name.toLowerCase();
}

// Ordered list of scope paths to search, from the given scope outward to global
// (null), e.g. "outer.inner" -> ["outer.inner", "outer", null].
function getScopeChain(scopePath: string | null): (string | null)[] {
    const chain: (string | null)[] = [scopePath];
    let current = scopePath;
    while (current !== null) {
        const lastDot = current.lastIndexOf('.');
        current = lastDot >= 0 ? current.substring(0, lastDot) : null;
        chain.push(current);
    }
    return chain;
}

export function getWordAtPosition(document: TextDocument, position: Position): string | null {
    const text = document.getText();
    const lines = text.split('\n');
    const line = lines[position.line];

    if (!line) return null;

    let start = position.character;
    let end = position.character;

    const char = line[position.character];

    // Special handling for anonymous labels (+ or -)
    if (char === '+' || char === '-') {
        // Extend to capture all consecutive + or - symbols
        while (start > 0 && (line[start - 1] === '+' || line[start - 1] === '-')) {
            start--;
        }
        while (end < line.length && (line[end] === '+' || line[end] === '-')) {
            end++;
        }
        const word = line.substring(start, end);
        // Only return if all chars are the same (+++, not +-)
        if (word.length > 0 && word.split('').every(c => c === word[0])) {
            return word;
        }
        return null;
    }

    // Regular alphanumeric word detection
    while (start > 0 && /[a-zA-Z0-9_.]/.test(line[start - 1])) {
        start--;
    }

    while (end < line.length && /[a-zA-Z0-9_.]/.test(line[end])) {
        end++;
    }

    const word = line.substring(start, end);
    if (word.length === 0) return null;

    // Dotted references (e.g. "scope.member") are ambiguous: clicking on an
    // earlier segment (the scope prefix) should resolve to that segment alone,
    // not the whole path - otherwise it's impossible to target the prefix
    // symbol itself (e.g. renaming "scope" in "scope.member").
    // Clicking on the last segment keeps the full dotted path, since that's
    // what scope-qualified lookup (findSymbolInfo) needs to resolve it.
    if (word.includes('.')) {
        const cursorOffset = position.character - start;
        const segments = word.split('.');
        let segStart = 0;
        for (let i = 0; i < segments.length; i++) {
            const segEnd = segStart + segments[i].length;
            const isLast = i === segments.length - 1;
            if (isLast || cursorOffset <= segEnd) {
                return isLast ? word : segments.slice(0, i + 1).join('.');
            }
            segStart = segEnd + 1; // skip the '.'
        }
    }

    return word;
}

/**
 * Find an anonymous label by direction and distance.
 *
 * @param direction - '+' for forward, '-' for backward
 * @param distance - How many labels to skip (1 for +, 2 for ++, etc.)
 * @param fromUri - URI of the document containing the reference
 * @param fromLine - Line number of the reference
 * @param documentIndex - Document index map
 * @returns The target anonymous label, or null if not found
 */
export function findAnonymousLabel(
    direction: '+' | '-',
    distance: number,
    fromUri: string,
    fromLine: number,
    documentIndex: Map<string, DocumentIndex>
): LabelDefinition | null {
    const fromIndex = documentIndex.get(fromUri);
    if (!fromIndex) return null;

    const currentScopePath = fromIndex.scopeAtLine.get(fromLine)?.scopePath ?? null;

    // Anonymous labels follow the ordinary scope chain, NOT local (_name) scoping:
    // one defined in an enclosing scope is reachable from a nested .proc/.block,
    // but one defined inside a scope is not reachable from outside it or from a
    // sibling scope. Named code labels do not delimit them at all (verified
    // against the assembler), so localScope is deliberately not consulted here.
    const visibleScopes = new Set(getScopeChain(currentScopePath));
    const candidates = fromIndex.labels.filter(l =>
        l.isAnonymous &&
        l.name === direction &&
        visibleScopes.has(l.scopePath)
    );

    if (direction === '+') {
        // Forward: find labels AFTER current line
        const forward = candidates
            .filter(l => l.range.start.line > fromLine)
            .sort((a, b) => a.range.start.line - b.range.start.line);

        // Return the nth label forward (distance - 1 because arrays are 0-indexed)
        return forward[distance - 1] || null;
    } else {
        // Backward: find labels BEFORE current line
        const backward = candidates
            .filter(l => l.range.start.line < fromLine)
            .sort((a, b) => b.range.start.line - a.range.start.line); // Reverse order

        // Return the nth label backward
        return backward[distance - 1] || null;
    }
}

/**
 * How a qualified reference's scope may be reached, given where it is written.
 *
 * `reachable` are full scope paths the WRITTEN path can name from this point.
 * 64tass resolves it through the ordinary scope chain (verified): from global,
 * `keyboard.scan` does not find a `keyboard` nested inside `qwe` - only
 * `qwe.keyboard.scan` does - while the same reference from inside `qwe`, or from
 * a sibling scope within it, resolves fine. So these are matched exactly.
 *
 * `substituted` are scopes the name STANDS FOR rather than names:
 *   - a .dstruct/.dunion instance exposes its type's members ("p1.posx" is
 *     "pt.posx")
 *   - a label on a macro call, or assigned from a function, exposes that
 *     macro's or function's labels - and for `.endf <name>`, the scope the
 *     function actually hands back
 * The identity is already pinned by the substitution, so these are matched
 * loosely, as the tail of a nested path.
 */
function scopeCandidates(
    targetPath: string,
    fromScope: string | null,
    documentIndex: Map<string, DocumentIndex>,
    unit?: ReadonlySet<string>
): { reachable: string[]; substituted: string[] } {
    const reachable = getScopeChain(fromScope)
        .map(scope => (scope ? `${scope}.${targetPath}` : targetPath));

    // Both maps are keyed by FULL path, so the lookup happens on each path the
    // reference could be naming, not on its first segment: two `p1` instances in
    // different scopes are different instances. Every document in the unit is
    // consulted - stopping at the first would make the answer depend on indexing
    // order - and only those, or a `.dstruct` type from an unrelated program
    // would decide what `p1.member` means here.
    const substituted = reachable.flatMap(full => substitutionsFor(full, documentIndex, unit));
    return { reachable, substituted };
}

/**
 * What a full scope path may stand for, if some prefix of it was instantiated or
 * assigned. The longest matching prefix wins, and the remainder is carried over:
 * `RESULT.INNER` is the instance `RESULT` plus `.INNER` within it.
 */
function substitutionsFor(
    full: string,
    documentIndex: Map<string, DocumentIndex>,
    unit?: ReadonlySet<string>
): string[] {
    const parts = full.split('.');
    for (let take = parts.length; take > 0; take--) {
        const prefix = parts.slice(0, take).join('.');
        const remainder = parts.slice(take).join('.');
        const suffix = remainder ? `.${remainder}` : '';
        const found: string[] = [];

        for (const [uri, index] of documentIndex) {
            if (unit && !unit.has(uri)) continue;
            const declaredType = index.structInstances.get(prefix);
            if (declaredType) found.push(declaredType + suffix);

            const memberSource = index.labelDefinedByMacro.get(prefix);
            if (memberSource) {
                // A function whose `.endf` hands back a scope of its own exposes
                // that scope's members, not its top-level ones.
                for (const [otherUri, other] of documentIndex) {
                    if (unit && !unit.has(otherUri)) continue;
                    const returned = other.functionReturnScope.get(memberSource);
                    if (returned) found.push(returned + suffix);
                }
                found.push(memberSource + suffix);
            }
        }
        if (found.length > 0) return found;
    }
    return [];
}

/** Does this label live in one of the scopes a reference may be naming? */
function inCandidateScope(
    scopePath: string | null | undefined,
    candidates: { reachable: string[]; substituted: string[] }
): boolean {
    if (candidates.reachable.includes(scopePath ?? '')) return true;
    return candidates.substituted.some(candidate =>
        scopePath === candidate || scopePath?.endsWith(`.${candidate}`));
}

/**
 * Every symbol reachable as `scopePath.member`, for completing a qualified
 * reference once the dot has been typed.
 *
 * Resolves the scope the same way findSymbolInfo does, so an instance name or a
 * label standing in for a macro's or function's scope offers that scope's
 * members. Local (`_name`) and anonymous labels are left out: neither is
 * reachable through a dot.
 */
export function collectScopeMembers(
    scopePath: string,
    documentIndex: Map<string, DocumentIndex>,
    visibleUris?: ReadonlySet<string>,
    fromScope: string | null = null
): LabelDefinition[] {
    const candidates = scopeCandidates(scopePath, fromScope, documentIndex, visibleUris);
    const seen = new Set<string>();
    const members: LabelDefinition[] = [];
    for (const [uri, index] of documentIndex) {
        if (visibleUris && !visibleUris.has(uri)) continue;
        for (const label of index.labels) {
            if (label.isLocal || label.isAnonymous || seen.has(label.name)) continue;
            if (!inCandidateScope(label.scopePath, candidates)) continue;
            seen.add(label.name);
            members.push(label);
        }
    }
    return members;
}

/**
 * The documents a lookup may consult: the file itself first, then the rest of its
 * compilation unit - and NOTHING else, once a unit is given.
 *
 * A unit is a restriction, so a name that only exists in an unrelated program is
 * not found at all, rather than found in a file that has nothing to do with this
 * one. Two programs that both define `music` used to resolve to whichever was
 * indexed first.
 *
 * The caller decides whether to pass one, and only does when the include graph is
 * known to be complete - see `unitFor` in server.ts. With no unit every document
 * is searched, which is what every caller that has no graph to consult (and every
 * unit test) gets.
 */
function documentsToSearch(
    documentIndex: Map<string, DocumentIndex>,
    fromUri: string,
    unit?: ReadonlySet<string>
): DocumentIndex[] {
    const own: DocumentIndex[] = [];
    const sameUnit: DocumentIndex[] = [];
    const rest: DocumentIndex[] = [];
    for (const [uri, index] of documentIndex) {
        if (uri === fromUri) own.push(index);
        else if (unit?.has(uri)) sameUnit.push(index);
        else rest.push(index);
    }
    return unit ? [...own, ...sameUnit] : [...own, ...rest];
}

export function findSymbolInfo(
    word: string,
    fromUri: string,
    fromLine: number,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive = false,
    // Set false when already resolving through a `.with`, so expanding a name
    // against the imported scopes cannot expand it again and again.
    applyWith = true,
    // Documents assembled together with fromUri. RESTRICTS the search - see
    // documentsToSearch. Omitted means "no reliable graph", and everything is
    // searched, which is the old behaviour.
    unit?: ReadonlySet<string>
): LabelDefinition | null {
    // Check if word is an anonymous label reference
    if (/^[+-]+$/.test(word)) {
        const direction = word[0] as '+' | '-';
        const distance = word.length;
        return findAnonymousLabel(direction, distance, fromUri, fromLine, documentIndex);
    }

    const fromIndex = documentIndex.get(fromUri);
    if (!fromIndex) return null;

    const lineScope = fromIndex.scopeAtLine.get(fromLine);
    const currentScopePath = lineScope?.scopePath ?? null;
    const currentLocalScope = lineScope?.localScope ?? null;

    // Handle macro calls like ".macroname" - strip leading dot
    // (macros are defined as "name .macro" but called as ".name")
    let lookupWord = word;
    if (word.startsWith('.') && !word.includes('.', 1)) {
        lookupWord = word.substring(1);
    }

    // Normalize for matching
    lookupWord = normalizeName(lookupWord, caseSensitive);

    const isLocalSymbol = word.startsWith('_'); // Use original word for this check

    // Scopes imported by an enclosing `.with`, innermost first. They accumulate:
    // `.with b` inside `.with a` searches a.b, so the whole run is joined rather
    // than each tried alone (verified). Resolving the joined path reuses the
    // qualified-reference handling below, which knows how to reach a nested scope.
    const resolveViaWith = (): LabelDefinition | null => {
        if (!applyWith) return null;
        const imported = lineScope?.withScopes ?? [];
        for (let i = imported.length - 1; i >= 0; i--) {
            const path = imported.slice(0, i + 1).join('.');
            const found = findSymbolInfo(
                `${path}.${lookupWord}`, fromUri, fromLine, documentIndex, caseSensitive, false, unit);
            if (found) return found;
        }
        return null;
    };

    // Handle dotted references like "scope.symbol"
    if (lookupWord.includes('.')) {
        const parts = lookupWord.split('.');
        const targetName = parts[parts.length - 1];
        const targetPath = parts.slice(0, -1).join('.');

        const candidates = scopeCandidates(targetPath, currentScopePath, documentIndex, unit);
        for (const index of documentsToSearch(documentIndex, fromUri, unit)) {
            for (const label of index.labelsByName.get(targetName) ?? []) {
                if (inCandidateScope(label.scopePath, candidates)) return label;
            }
        }
        // A qualified name can also be relative to a `.with`: inside `.with MAPDATA`,
        // "CHARS.DATA" means "MAPDATA.CHARS.DATA".
        return resolveViaWith();
    }

    // Local symbol lookup: must match same document, same scopePath, same localScope
    if (isLocalSymbol) {
        for (const label of fromIndex.labelsByName.get(lookupWord) ?? []) {
            if (label.isLocal &&
                label.scopePath === currentScopePath &&
                label.localScope === currentLocalScope) {
                return label;
            }
        }
        return null;
    }

    // Regular symbol lookup: search current scope, then parent scopes, out to global
    for (const scopeToTry of getScopeChain(currentScopePath)) {
        for (const index of documentsToSearch(documentIndex, fromUri, unit)) {
            for (const label of index.labelsByName.get(lookupWord) ?? []) {
                if (!label.isLocal && label.scopePath === scopeToTry) {
                    return label;
                }
            }
        }
    }

    // Finally, anything an enclosing `.with` brought into view.
    return resolveViaWith();
}

/**
 * Collect every non-local label visible from a given point in a document, plus
 * every local (`_name`) symbol valid in its current localScope - i.e. everything
 * findSymbolInfo could resolve a bare (non-dotted) reference to from this point,
 * gathered instead of stopping at the first match. Used for symbol completion.
 * Closer scopes shadow same-named labels from farther out (nearest wins).
 */
export function collectVisibleLabels(
    fromUri: string,
    fromLine: number,
    documentIndex: Map<string, DocumentIndex>,
    // Documents assembled together with fromUri. Anything outside is a separate
    // compilation unit whose symbols are not in scope here - see
    // IncludeGraph.compilationUnit. Omitted means "no restriction".
    visibleUris?: ReadonlySet<string>
): LabelDefinition[] {
    const fromIndex = documentIndex.get(fromUri);
    if (!fromIndex) return [];

    const lineScope = fromIndex.scopeAtLine.get(fromLine);
    const currentScopePath = lineScope?.scopePath ?? null;
    const currentLocalScope = lineScope?.localScope ?? null;

    const seen = new Set<string>();
    const results: LabelDefinition[] = [];

    // Local symbols valid at this point (same document, same scopePath + localScope)
    for (const label of fromIndex.labels) {
        if (label.isLocal && !label.isAnonymous &&
            label.scopePath === currentScopePath && label.localScope === currentLocalScope) {
            if (!seen.has(label.name)) {
                seen.add(label.name);
                results.push(label);
            }
        }
    }

    // Non-local symbols, nearest scope first so closer definitions shadow farther ones.
    // Anonymous labels are excluded: "+"/"-" are never completed by name.
    for (const scopeToTry of getScopeChain(currentScopePath)) {
        for (const [uri, index] of documentIndex) {
            if (visibleUris && !visibleUris.has(uri)) continue;
            for (const label of index.labels) {
                if (!label.isLocal && !label.isAnonymous && label.scopePath === scopeToTry && !seen.has(label.name)) {
                    seen.add(label.name);
                    results.push(label);
                }
            }
        }
    }

    return results;
}

/**
 * Collect the names of .function/.macro parameters visible from a given point
 * in a document (its own scope's parameters, plus any enclosing scope's -
 * parameters are valid throughout the body they were declared for, same as
 * isParameter() checks one name at a time). Used for symbol completion.
 */
export function collectVisibleParameters(
    fromUri: string,
    fromLine: number,
    documentIndex: Map<string, DocumentIndex>
): string[] {
    const fromIndex = documentIndex.get(fromUri);
    if (!fromIndex) return [];

    const currentScopePath = fromIndex.scopeAtLine.get(fromLine)?.scopePath ?? null;

    const seen = new Set<string>();
    const results: string[] = [];
    for (const scopeToTry of getScopeChain(currentScopePath)) {
        if (scopeToTry === null) continue; // parameters always belong to a named scope
        for (const [, index] of documentIndex) {
            for (const param of index.parametersAtScope.get(scopeToTry) ?? []) {
                if (!seen.has(param)) {
                    seen.add(param);
                    results.push(param);
                }
            }
        }
    }
    return results;
}

export function findDefinition(
    word: string,
    fromUri: string,
    fromLine: number,
    documentIndex: Map<string, DocumentIndex>,
    caseSensitive = false,
    /** Documents assembled together with fromUri, to prefer over unrelated ones. */
    unit?: ReadonlySet<string>
): Location | null {
    const label = findSymbolInfo(word, fromUri, fromLine, documentIndex, caseSensitive, true, unit);
    if (label) {
        return Location.create(label.uri, label.range);
    }
    return null;
}

/**
 * Whether a symbol can be renamed at all.
 *
 * Anonymous labels (+ / -) cannot: they have no name, and references to them are
 * resolved by direction and distance rather than by text. Renaming one would
 * rewrite the definition while leaving every "bne -" pointing at nothing.
 */
export function isRenameable(symbol: LabelDefinition): boolean {
    return !symbol.isAnonymous;
}

/**
 * A syntactically valid 64tass symbol name: a letter or underscore followed by
 * letters, digits or underscores (verified against the assembler - it rejects a
 * leading digit, a hyphen, whitespace and the empty string).
 */
const VALID_SYMBOL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Whether `name` can be used as a symbol name, i.e. is a legal rename target. */
export function isValidSymbolName(name: string): boolean {
    return VALID_SYMBOL_NAME.test(name);
}

/**
 * Compute the workspace edit for renaming a symbol across all indexed documents.
 * Returns null if the symbol cannot be renamed (see isRenameable).
 *
 * Handles three kinds of references for non-local symbols:
 *  - bare occurrences of the name
 *  - macro-call style: ".name" (leading dot, single segment)
 *  - dotted-chain occurrences, where the name is one segment of a longer path
 *    (e.g. renaming "scope" in "scope.member", or "member" in "scope.member").
 *    Each segment is verified independently via findSymbolInfo so that renaming
 *    a scope prefix never touches a member name sharing the reference, and vice versa.
 *
 * @param symbol - The label definition being renamed (its own definition is included in the edits)
 * @param newName - The new name to substitute
 * @param documentIndex - Document index map (all indexed documents are searched for references)
 * @param getDocumentText - Returns the current text of a document by URI (open buffer or disk), or null if unavailable
 * @param caseSensitive - Whether symbol matching is case-sensitive
 */
export interface SymbolOccurrence {
    uri: string;
    range: Range;
    /** Inside a comment rather than code */
    inComment: boolean;
    /** This occurrence is the symbol's own definition */
    isDefinition: boolean;
}

/**
 * Every place a symbol appears across the indexed documents.
 *
 * The single scanner behind rename, find-references and document highlight, so
 * all three agree on what counts as an occurrence. Handles, for non-local symbols:
 *  - macro-call style ".name" (leading dot, single segment)
 *  - dotted chains, where the name is one segment of a longer path: each segment
 *    is verified independently via findSymbolInfo, so "scope" in "scope.member"
 *    is distinguished from "member".
 * Comment occurrences are reported too, flagged via `inComment`, since rename
 * offers them separately and the others ignore them.
 *
 * @param restrictToUri limit the scan to one document (used by document highlight)
 */
export function findSymbolOccurrences(
    symbol: LabelDefinition,
    documentIndex: Map<string, DocumentIndex>,
    getDocumentText: (uri: string) => string | null,
    caseSensitive = false,
    restrictToUri?: string,
    // Documents assembled together with the symbol's own. Restricts the scan, so
    // renaming cannot rewrite a same-named symbol in an unrelated program.
    unit?: ReadonlySet<string>
): SymbolOccurrence[] {
    const occurrences: SymbolOccurrence[] = [];
    const seen = new Set<string>();

    const add = (uri: string, range: Range, inComment: boolean) => {
        const key = `${uri}:${range.start.line}:${range.start.character}`;
        if (seen.has(key)) return;
        seen.add(key);
        occurrences.push({ uri, range, inComment, isDefinition: isSelfDefinition(uri, range.start.line, range.start.character) });
    };

    function isSelfDefinition(uri: string, lineNum: number, col: number): boolean {
        return uri === symbol.uri && lineNum === symbol.range.start.line && col === symbol.range.start.character;
    }

    function resolvesToSymbol(word: string, uri: string, lineNum: number): boolean {
        // Use the case sensitivity this specific document was actually indexed
        // with (which may differ per compilation unit via a pragma), falling
        // back to the caller-supplied default if it isn't indexed at all.
        const refSymbol = findSymbolInfo(word, uri, lineNum, documentIndex,
            documentIndex.get(uri)?.caseSensitive ?? caseSensitive, true, unit);
        return !!refSymbol && refSymbol.uri === symbol.uri &&
            refSymbol.range.start.line === symbol.range.start.line &&
            refSymbol.range.start.character === symbol.range.start.character;
    }

    // The definition itself, when it is in scope for this scan
    if (!restrictToUri || restrictToUri === symbol.uri) {
        add(symbol.uri, symbol.range, false);
    }

    const symbolName = symbol.name;
    // Safe: symbol name from user file, sanitized via escapeRegex()
    const escapedName = escapeRegex(symbolName);

    for (const [uri, index] of documentIndex) {
        if (restrictToUri && uri !== restrictToUri) continue;
        if (unit && !unit.has(uri)) continue;

        const docContent = getDocumentText(uri);
        if (docContent === null) continue;

        const lines = docContent.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            const { code, commentStart } = parseLineStructure(line);

            if (code.trim() !== '') {
                if (symbol.isLocal) {
                    // Safe: symbol name from user file, sanitized via escapeRegex()
                    const pattern = new RegExp(`\\b${escapedName}\\b`, 'g');
                    let match;
                    while ((match = pattern.exec(code)) !== null) {
                        const startCol = match.index;
                        if (isSelfDefinition(uri, lineNum, startCol)) continue;

                        const lineScope = index.scopeAtLine.get(lineNum);
                        const lineScopePath = lineScope?.scopePath ?? null;
                        const lineLocalScope = lineScope?.localScope ?? null;
                        if (lineScopePath !== symbol.scopePath || lineLocalScope !== symbol.localScope) {
                            continue;
                        }

                        add(uri, Range.create(
                            Position.create(lineNum, startCol),
                            Position.create(lineNum, startCol + symbolName.length)
                        ), false);
                    }
                } else {
                    // Macro-call style reference: ".name" (leading dot, single segment)
                    // Safe: symbol name from user file, sanitized via escapeRegex()
                    const macroCallPattern = new RegExp(`\\.${escapedName}\\b(?!\\.[a-zA-Z_])`, 'g');
                    let macroMatch;
                    while ((macroMatch = macroCallPattern.exec(code)) !== null) {
                        const startCol = macroMatch.index + 1; // skip the leading dot
                        if (!resolvesToSymbol(macroMatch[0], uri, lineNum)) continue;

                        add(uri, Range.create(
                            Position.create(lineNum, startCol),
                            Position.create(lineNum, startCol + symbolName.length)
                        ), false);
                    }

                    // Bare / dotted-chain references: "name", "name.member", "scope.name", "scope.name.member"
                    const chainPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*/g;
                    let chainMatch;
                    while ((chainMatch = chainPattern.exec(code)) !== null) {
                        const segments = chainMatch[0].split('.');
                        const chainStart = chainMatch.index;

                        let segStart = 0;
                        for (let i = 0; i < segments.length; i++) {
                            const seg = segments[i];
                            const segStartCol = chainStart + segStart;
                            segStart += seg.length + 1; // skip the '.'

                            // Use this document's own effective case sensitivity, not
                            // necessarily the caller-supplied default (see resolvesToSymbol)
                            const docCaseSensitive = index.caseSensitive;
                            if (normalizeName(seg, docCaseSensitive) !== normalizeName(symbolName, docCaseSensitive)) {
                                continue;
                            }
                            if (isSelfDefinition(uri, lineNum, segStartCol)) continue;

                            const prefix = segments.slice(0, i + 1).join('.');
                            if (!resolvesToSymbol(prefix, uri, lineNum)) continue;

                            add(uri, Range.create(
                                Position.create(lineNum, segStartCol),
                                Position.create(lineNum, segStartCol + seg.length)
                            ), false);
                        }
                    }
                }
            }

            // Comment occurrences (reported for every symbol, flagged as such)
            if (commentStart >= 0) {
                const comment = line.substring(commentStart);
                // Safe: symbol name from user file, sanitized via escapeRegex()
                const commentPattern = new RegExp(`\\b${escapedName}\\b`, 'g');
                let match;
                while ((match = commentPattern.exec(comment)) !== null) {
                    const startCol = commentStart + match.index;
                    add(uri, Range.create(
                        Position.create(lineNum, startCol),
                        Position.create(lineNum, startCol + symbolName.length)
                    ), true);
                }
            }
        }
    }

    return occurrences;
}

/**
 * Locations referencing a symbol (LSP textDocument/references).
 * Comment occurrences are excluded: they are text, not references.
 */
export function findReferences(
    symbol: LabelDefinition,
    documentIndex: Map<string, DocumentIndex>,
    getDocumentText: (uri: string) => string | null,
    includeDeclaration: boolean,
    caseSensitive = false,
    unit?: ReadonlySet<string>
): Location[] {
    return findSymbolOccurrences(symbol, documentIndex, getDocumentText, caseSensitive, undefined, unit)
        .filter(o => !o.inComment && (includeDeclaration || !o.isDefinition))
        .map(o => Location.create(o.uri, o.range));
}

/**
 * Occurrences of a symbol within one document (LSP textDocument/documentHighlight),
 * with the definition distinguished from its uses.
 */
export function findDocumentHighlights(
    symbol: LabelDefinition,
    uri: string,
    documentIndex: Map<string, DocumentIndex>,
    getDocumentText: (uri: string) => string | null,
    caseSensitive = false,
    unit?: ReadonlySet<string>
): DocumentHighlight[] {
    return findSymbolOccurrences(symbol, documentIndex, getDocumentText, caseSensitive, uri, unit)
        .filter(o => !o.inComment)
        .map(o => DocumentHighlight.create(
            o.range,
            o.isDefinition ? DocumentHighlightKind.Write : DocumentHighlightKind.Read
        ));
}

/**
 * Compute the workspace edit for renaming a symbol across all indexed documents.
 * Returns null if the symbol cannot be renamed (see isRenameable) or the new name
 * is not a valid symbol name.
 */
export function computeRenameEdits(
    symbol: LabelDefinition,
    newName: string,
    documentIndex: Map<string, DocumentIndex>,
    getDocumentText: (uri: string) => string | null,
    caseSensitive = false,
    unit?: ReadonlySet<string>
): WorkspaceEdit | null {
    // Refused here rather than only in the LSP handler, so no caller can produce
    // an edit that silently corrupts the source: an anonymous label has no name to
    // replace, and an invalid new name would write un-assemblable text everywhere.
    if (!isRenameable(symbol)) return null;
    if (!isValidSymbolName(newName)) return null;

    const codeEdits: Map<string, TextEdit[]> = new Map();
    const commentEdits: Map<string, AnnotatedTextEdit[]> = new Map();

    for (const occurrence of findSymbolOccurrences(symbol, documentIndex, getDocumentText, caseSensitive, undefined, unit)) {
        const bucket = occurrence.inComment ? commentEdits : codeEdits;
        if (!bucket.has(occurrence.uri)) bucket.set(occurrence.uri, []);
        if (occurrence.inComment) {
            commentEdits.get(occurrence.uri)!.push(
                AnnotatedTextEdit.replace(occurrence.range, newName, 'commentRename'));
        } else {
            codeEdits.get(occurrence.uri)!.push(TextEdit.replace(occurrence.range, newName));
        }
    }

    // Build the workspace edit
    if (commentEdits.size > 0) {
        // Use documentChanges with annotations to force preview
        const documentChanges: TextDocumentEdit[] = [];
        const changeAnnotations: { [id: string]: ChangeAnnotation } = {
            'commentRename': {
                label: 'Rename in comments',
                needsConfirmation: true,
                description: 'Also rename occurrences in comments'
            }
        };

        const allUris = new Set([...codeEdits.keys(), ...commentEdits.keys()]);
        for (const uri of allUris) {
            const edits: (TextEdit | AnnotatedTextEdit)[] = [];
            const uriCodeEdits = codeEdits.get(uri);
            if (uriCodeEdits) edits.push(...uriCodeEdits);
            const uriCommentEdits = commentEdits.get(uri);
            if (uriCommentEdits) edits.push(...uriCommentEdits);
            if (edits.length > 0) {
                documentChanges.push({
                    textDocument: OptionalVersionedTextDocumentIdentifier.create(uri, null),
                    edits
                });
            }
        }

        return { documentChanges, changeAnnotations };
    } else {
        const changes: { [uri: string]: TextEdit[] } = {};
        for (const [uri, edits] of codeEdits) {
            changes[uri] = edits;
        }
        return { changes };
    }
}

// Check if a symbol is a parameter in the current scope or any parent scope
// Parameter names are stored in canonical form
export function isParameter(symName: string, scopePath: string | null, index: DocumentIndex, caseSensitive = false): boolean {
    const normalizedName = normalizeName(symName, caseSensitive);
    // Check exact scope
    if (scopePath) {
        const params = index.parametersAtScope.get(scopePath);
        if (params && params.includes(normalizedName)) {
            return true;
        }
        // Check parent scopes
        let parent = scopePath;
        while (parent.includes('.')) {
            parent = parent.substring(0, parent.lastIndexOf('.'));
            const parentParams = index.parametersAtScope.get(parent);
            if (parentParams && parentParams.includes(normalizedName)) {
                return true;
            }
        }
    }
    return false;
}
