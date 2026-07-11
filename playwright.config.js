import { defineConfig, devices } from '@playwright/test';

// e2e for chapters 13/14 (WebAuthn / Passkey). CDP virtual authenticators are
// Chromium-only, so the suite runs on Chromium alone.
const PORT = process.env.E2E_PORT ?? '3100';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node src/server.js',
    env: { PORT },
    port: Number(PORT),
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
