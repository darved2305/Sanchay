import { createRequire } from 'node:module';

const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM || import.meta.url);
const { defineConfig } = require('playwright/test');

export default defineConfig({
  testDir: '.',
  testMatch: 'browser_smoke.spec.mjs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: '/private/tmp/sanchaya-browser-artifacts/results.json' }]],
  outputDir: '/private/tmp/sanchaya-browser-artifacts/test-output',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:5173',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
