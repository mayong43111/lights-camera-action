import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5190', trace: { mode: 'retain-on-failure', screenshots: false } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 960 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    {
      command: `${process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'} tests/serve_frontend.py --port 4190 --no-browser`,
      url: 'http://127.0.0.1:4190/healthz',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev:client -- --port 5190 --strictPort',
      url: 'http://127.0.0.1:5190',
      env: { STUDIO_API_URL: 'http://127.0.0.1:4190' },
      reuseExistingServer: false,
    },
  ],
});