import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        // Build output, dependencies and the example corpus are not ours to lint
        ignores: ['out/**', 'coverage/**', 'node_modules/**', 'example/**', 'esbuild.js'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        rules: {
            // The codebase deliberately uses `any` at the LSP configuration boundary,
            // where the client sends untyped JSON.
            '@typescript-eslint/no-explicit-any': 'warn',
            // Unused args are allowed when prefixed with _, which the LSP handlers use
            // for parameters they must declare but don't read.
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrors: 'none',
            }],
        },
    },
);
