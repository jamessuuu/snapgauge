import { defineConfig, devices } from "@playwright/test";

/**
 * The e2e:smoke stage (SPEC §10 M5 green gate — replaces the CI no-op from
 * M0). Runs against a real production build (`next build && next start`),
 * not the dev server: the "renders with JS disabled" test needs real
 * server-rendered HTML, and a production build is what actually ships.
 */
export default defineConfig({
  testDir: "./e2e",
  // The boards/ fixture the board.spec.ts dead-man-banner test needs is
  // planted by e2e/run-e2e.mjs BEFORE this config is even loaded — not via
  // globalSetup, which runs AFTER webServer starts (too late for a fixture
  // the static build must see; microsoft/playwright#7597).
  fullyParallel: true,
  forbidOnly: process.env.CI === "true",
  retries: process.env.CI === "true" ? 1 : 0,
  ...(process.env.CI === "true" ? { workers: 1 } : {}),
  reporter: process.env.CI === "true" ? "line" : "html",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: process.env.CI !== "true",
    timeout: 180_000,
  },
});
