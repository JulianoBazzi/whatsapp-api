import { defineConfig } from 'vitest/config';

// Docker end-to-end suite: builds whatsapp-api:e2e and drives a real container (OrbStack/Docker).
// Separate config on purpose — the `.e2e.js` suffix keeps these files out of `pnpm test` and CI.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.js'],
    globalSetup: ['tests/e2e/globalSetup.js'],
    fileParallelism: false, // one Chromium at a time; image.e2e.js also spawns short-lived containers
    testTimeout: 60000,
    hookTimeout: 120000,
    reporters: ['verbose'],
  },
});
