import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        testTimeout: 10000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                // Test helpers are not product code
                'test/**',
                // Client entry point: pure VS Code wiring, nothing to unit test
                'src/extension.ts',
                // Benchmark instrumentation, not product behaviour
                'src/server/performance.ts',
            ],
            reporter: ['text-summary', 'html', 'lcov'],
            reportsDirectory: 'coverage',
        },
    },
});
