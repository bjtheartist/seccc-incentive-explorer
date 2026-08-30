import { defineConfig } from "@playwright/test";

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
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
