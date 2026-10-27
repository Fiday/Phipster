import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    launchOptions: process.env.CHROMIUM_EXECUTABLE_PATH ? {
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    } : {},
  },
  webServer: [
    { command: 'npm run start -w server', url: 'http://127.0.0.1:3000/api/health', env: { HOST: '127.0.0.1', PORT: '3000', DB_PATH: '.test-data/browser.sqlite' } },
    { command: 'npm run dev -w client -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', env: { VITE_SPOTIFY_CLIENT_ID: 'browser-test-client' } },
  ],
});
