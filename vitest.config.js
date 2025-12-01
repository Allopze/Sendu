import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['backend/tests/**/*.test.js'],
        exclude: ['node_modules', 'frontend'],
        testTimeout: 10000,
        hookTimeout: 10000
    }
});
