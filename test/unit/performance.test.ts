import { describe, it, beforeEach } from 'vitest';
import { perfMonitor } from '../../src/server/performance';
import { buildIndex } from '../helpers/doc';
import { findSymbolInfo } from '../../src/server/symbols';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Identifies the code state that produced a measurement, so results in
// performance-results.jsonl can be correlated with git history to see which
// commits actually moved the numbers. "-dirty" is appended if src/ has
// uncommitted changes, since those measurements aren't reproducible from the
// commit hash alone. Falls back to 'unknown' outside a git checkout.
function getCommitLabel(): string {
    const cwd = path.join(__dirname, '..', '..');
    try {
        const hash = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf-8' }).trim();
        const dirty = execSync('git status --porcelain -- src', { cwd, encoding: 'utf-8' }).trim().length > 0;
        return dirty ? `${hash}-dirty` : hash;
    } catch {
        return 'unknown';
    }
}

describe('Performance benchmarks', () => {
    beforeEach(() => {
        perfMonitor.clear();
        perfMonitor.enable();
    });

    it('baseline: measures findSymbolInfo performance', () => {
        const fixturePath = path.join(__dirname, '../fixtures/benchmark-large.asm');
        const source = fs.readFileSync(fixturePath, 'utf-8');

        const { documentIndex, docs } = buildIndex({ source });

        const iterations = 1000;
        const start = performance.now();

        // Perform lookups across different symbol types
        for (let i = 0; i < iterations; i++) {
            // Global symbol
            findSymbolInfo('start', docs[0].uri, 10, documentIndex);
            // Nested scope symbol
            findSymbolInfo('outer1.middle1.inner1.label21', docs[0].uri, 50, documentIndex);
            // Data label
            findSymbolInfo('sprite05', docs[0].uri, 100, documentIndex);
            // Code label with locals
            findSymbolInfo('code005', docs[0].uri, 200, documentIndex);
        }

        const duration = performance.now() - start;
        const avgMs = duration / (iterations * 4);  // 4 lookups per iteration
        const commit = getCommitLabel();

        console.log('\n=== PERFORMANCE RESULTS ===');
        console.log(`Commit: ${commit}`);
        console.log(`Total lookups: ${iterations * 4}`);
        console.log(`Total time: ${duration.toFixed(2)}ms`);
        console.log(`Average per lookup: ${avgMs.toFixed(4)}ms`);
        console.log('===========================\n');

        // Log to file for comparison
        const results = {
            timestamp: new Date().toISOString(),
            commit,
            iterations: iterations * 4,
            totalMs: duration,
            avgMs
        };

        const resultsPath = path.join(__dirname, '../performance-results.jsonl');
        fs.appendFileSync(resultsPath, JSON.stringify(results) + '\n');

        // Get perfMonitor stats if any
        const summary = perfMonitor.getSummary();
        if (summary['findSymbolInfo']) {
            console.log('PerfMonitor stats:', summary['findSymbolInfo']);
        }
    });
});
