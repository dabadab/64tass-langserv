import { Location, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { LabelDefinition, DocumentIndex } from './types';

export function getWordAtPosition(document: TextDocument, position: Position): string | null {
    const text = document.getText();
    const lines = text.split('\n');
    const line = lines[position.line];

    if (!line) return null;

    let start = position.character;
    let end = position.character;

    while (start > 0 && /[a-zA-Z0-9_.]/.test(line[start - 1])) {
        start--;
    }

    while (end < line.length && /[a-zA-Z0-9_.]/.test(line[end])) {
        end++;
    }

    const word = line.substring(start, end);
    return word.length > 0 ? word : null;
}

export function findSymbolInfo(
    word: string,
    fromUri: string,
    fromLine: number,
    documentIndex: Map<string, DocumentIndex>
): LabelDefinition | null {
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
    // All stored names are lowercase for case-insensitive matching
    const lookupName = lookupWord.toLowerCase();

    const isLocalSymbol = lookupWord.startsWith('_');

    // Handle dotted references like "scope.symbol"
    if (lookupWord.includes('.')) {
        const parts = lookupName.split('.');
        const targetName = parts[parts.length - 1];
        const targetPath = parts.slice(0, -1).join('.');

        for (const [, index] of documentIndex) {
            for (const label of index.labels) {
                if (label.name === targetName) {
                    // Check if scope path matches or ends with the target path
                    if (label.scopePath === targetPath ||
                        label.scopePath?.endsWith('.' + targetPath)) {
                        return label;
                    }
                }
            }
        }
        return null;
    }

    // Local symbol lookup: must match same document, same scopePath, same localScope
    if (isLocalSymbol) {
        for (const label of fromIndex.labels) {
            if (label.name === lookupName && label.isLocal &&
                label.scopePath === currentScopePath &&
                label.localScope === currentLocalScope) {
                return label;
            }
        }
        return null;
    }

    // Regular symbol lookup: search current scope, then parent scopes
    // First, try exact scope match
    for (const [, index] of documentIndex) {
        for (const label of index.labels) {
            if (label.name === lookupName && !label.isLocal && label.scopePath === currentScopePath) {
                return label;
            }
        }
    }

    // Then try parent scopes up to global
    let scopeToTry = currentScopePath;
    while (scopeToTry !== null) {
        const lastDot = scopeToTry.lastIndexOf('.');
        scopeToTry = lastDot >= 0 ? scopeToTry.substring(0, lastDot) : null;

        for (const [, index] of documentIndex) {
            for (const label of index.labels) {
                if (label.name === lookupName && !label.isLocal && label.scopePath === scopeToTry) {
                    return label;
                }
            }
        }
    }

    // Finally try global scope
    for (const [, index] of documentIndex) {
        for (const label of index.labels) {
            if (label.name === lookupName && !label.isLocal && label.scopePath === null) {
                return label;
            }
        }
    }

    return null;
}

export function findDefinition(
    word: string,
    fromUri: string,
    fromLine: number,
    documentIndex: Map<string, DocumentIndex>
): Location | null {
    const label = findSymbolInfo(word, fromUri, fromLine, documentIndex);
    if (label) {
        return Location.create(label.uri, label.range);
    }
    return null;
}

// Check if a symbol is a parameter in the current scope or any parent scope
// All parameter names are stored lowercase
export function isParameter(symName: string, scopePath: string | null, index: DocumentIndex): boolean {
    const symNameLower = symName.toLowerCase();
    // Check exact scope
    if (scopePath) {
        const params = index.parametersAtScope.get(scopePath);
        if (params && params.includes(symNameLower)) {
            return true;
        }
        // Check parent scopes
        let parent = scopePath;
        while (parent.includes('.')) {
            parent = parent.substring(0, parent.lastIndexOf('.'));
            const parentParams = index.parametersAtScope.get(parent);
            if (parentParams && parentParams.includes(symNameLower)) {
                return true;
            }
        }
    }
    return false;
}
