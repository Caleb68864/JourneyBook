import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    // Defaults to the Vite dev server; override with E2E_BASE_URL to point at the
    // Docker-served app (http://localhost:8080) or any running instance.
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Do NOT start a web server automatically — tests assume the dev stack is running.
  // Run `pnpm dev:web` before executing `pnpm --filter @journeybook/web test:e2e`.
});
