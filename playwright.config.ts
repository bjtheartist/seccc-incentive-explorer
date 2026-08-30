import { defineConfig, devices } from "@playwright/test";

const crossBrowserSmokeFiles = [
  "**/mobile-webkit-smoke.spec.ts",
  "**/firefox-smoke.spec.ts",
];

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  retries: 1,
  // The CI e2e job (.github/workflows/ci.yml) uploads playwright-report/ and
  // test-results/ on failure — an HTML report needs to actually be written
  // for that step to have anything real to attach. `open: "never"` so a
  // local `npm run test:e2e` never tries to launch a browser tab either.
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: crossBrowserSmokeFiles,
      use: { browserName: "chromium" },
    },
    {
      name: "mobile-webkit-smoke",
      testMatch: ["**/mobile-webkit-smoke.spec.ts", "**/report-lazy-pdf.spec.ts"],
      workers: 1,
      use: {
        ...devices["iPhone 13"],
      },
    },
    {
      name: "firefox-smoke",
      testMatch: "**/firefox-smoke.spec.ts",
      use: {
        ...devices["Desktop Firefox"],
      },
    },
  ],
});
