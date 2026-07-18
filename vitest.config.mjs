import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    fileParallelism: false, // port 3000 and the sessions_test folder are shared between files
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js', 'server.js'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
