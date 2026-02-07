import { describe, it, expect } from 'vitest';
import { createDoc, buildIndex } from '../helpers/doc';

describe('Security: Regex injection prevention', () => {
    it('handles dotted symbol names safely', () => {
        // Dotted names can be problematic if not escaped properly
        // The dot (.) is a regex metacharacter that matches any character
        // Without proper escaping, "a.b" would match "axb", "a_b", etc.
        const source = `
outer .proc
    inner .proc
        value = 42
    .pend
.pend
main
        lda #outer.inner.value
        `;

        // This test verifies that the parser and symbol lookup work correctly
        // with dotted names without regex injection issues
        const { documentIndex, docs } = buildIndex({ source });
        const doc = documentIndex.get(docs[0].uri);

        // Should parse without errors
        expect(doc).toBeDefined();
        expect(doc!.labels.length).toBeGreaterThan(0);

        // Should find symbols with dots in their scope paths
        const valueLabel = doc!.labels.find(l => l.name === 'value');
        expect(valueLabel).toBeDefined();
    });

    it('prevents ReDoS with pathological symbol names', () => {
        // Ensure we don't have exponential time complexity
        const longName = 'a'.repeat(1000);
        const source = `${longName} = 1\n        lda #${longName}`;

        const start = performance.now();
        const { documentIndex } = buildIndex({ source });
        const duration = performance.now() - start;

        // Should complete quickly (< 100ms for such simple code)
        expect(duration).toBeLessThan(100);
        expect(documentIndex.size).toBe(1);
    });
});
