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
            ],
            reporter: ['text-summary', 'html', 'lcov'],
            reportsDirectory: 'coverage',
        },
    },
});
