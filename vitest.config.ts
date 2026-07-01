import { defineConfig } from 'vitest/config';

// Integration tests run against a dedicated Postgres database so they never touch
// dev data. The test env is injected here (before any module import) because
// src/config/env.ts reads process.env at import time.
export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './test/globalSetup.ts',
    fileParallelism: false, // tests share one DB; run serially to avoid cross-talk
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        `postgresql://${process.env.USER}@localhost:5432/tour_marketplace_test?schema=public`,
      JWT_ACCESS_SECRET: 'test_access_secret_at_least_16_chars',
      JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_16_chars',
      PUBLIC_BASE_URL: 'http://localhost:4000',
      NOTIFY_CHANNEL: 'off',
    },
  },
});
