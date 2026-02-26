/**
 * playwright.config.js
 *
 * Playwright configuration for UI snapshot tests.
 * Place in the repository root.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir:   "tests/ui",
  outputDir: "tests/ui/__results__",

  snapshotDir: "tests/ui/__snapshots__",
  snapshotPathTemplate: "{snapshotDir}/{arg}{ext}",

  use: {
    baseURL:             process.env.BASE_URL || "http://localhost:3000",
    screenshot:          "on",
    video:               "retain-on-failure",
    trace:               "retain-on-failure",
    actionTimeout:       10_000,
    navigationTimeout:   30_000,
  },

  projects: [
    {
      name:  "chromium",
      use:   { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use:  { ...devices["Pixel 5"] },
    },
  ],

  // Retry failed tests once in CI
  retries: process.env.CI ? 1 : 0,

  reporter: [
    ["list"],
    ["html", { outputFolder: "tests/ui/__report__", open: "never" }],
  ],
});
