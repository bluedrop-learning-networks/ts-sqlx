import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@bluedrop-learning-networks/ts-sqlx-core': path.resolve(__dirname, 'packages/core/src'),
      '@bluedrop-learning-networks/ts-sqlx-language-server': path.resolve(__dirname, 'packages/language-server/src'),
      '@bluedrop-learning-networks/ts-sqlx-test-utils': path.resolve(__dirname, 'packages/test-utils/src'),
    },
  },
});
