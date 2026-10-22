import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The cloud build box ships its own Chromium; CI installs Playwright's.
const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// Override with E2E_PORT when several checkouts run end-to-end tests at once.
const PORT = Number(process.env.E2E_PORT) || 4399;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    ...devices['Desktop Chrome'],
    launchOptions: {
      executablePath: existsSync(local) ? local : undefined,
      args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: {
    command: `npx vite build && node server/relay.mjs`,
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
