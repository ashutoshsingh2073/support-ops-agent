import { defineConfig, devices } from "@playwright/test";

// End-to-end: real browser → Vite proxy → real Express backend (mock LLM mode).
// Uses its own ports so it never touches a dev server you already have running.
const BACKEND_PORT = 3100;
const FRONTEND_PORT = 5174;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // the backend keeps state in memory; tests run in a known order
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `npx tsx src/server.ts`,
      cwd: "..",
      env: { PORT: String(BACKEND_PORT), LLM_PROVIDER: "mock", RATE_LIMIT_PER_MINUTE: "1000" },
      url: `http://localhost:${BACKEND_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npx vite --port ${FRONTEND_PORT} --strictPort`,
      env: { BACKEND_URL: `http://localhost:${BACKEND_PORT}` },
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
