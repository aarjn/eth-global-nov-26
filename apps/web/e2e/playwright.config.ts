import { defineConfig } from "@playwright/test";

// Run from apps/web:  bun node_modules/@playwright/test/cli.js test -c e2e/playwright.config.ts
// (see docs/verification.md). Chromium 1248 from ~/.cache/ms-playwright matches @playwright/test 1.64.0.
const baseURL = process.env.E2E_BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  outputDir: "../test-results", // git-ignored (apps/web/test-results/)
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "../playwright-report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: { args: ["--no-sandbox"] },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
});
