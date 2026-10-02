import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', timeout: 30000, fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-720', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'desktop-1080', use: { viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
