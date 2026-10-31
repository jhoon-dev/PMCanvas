import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  outputDir: './test-results/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:4177',
    locale: 'ko-KR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4177 --strictPort',
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: false,
  },
});
