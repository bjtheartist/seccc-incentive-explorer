import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_REPORT_URL } from "../../lib/first-visit-guide";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

async function markGuideComplete(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "cie:first-visit-guide",
      JSON.stringify({
        version: 1,
        status: "completed",
        updatedAt: "2026-08-30T00:00:00.000Z",
      }),
    );
    window.sessionStorage.removeItem("cie:first-visit-spotlight-pending");
  });
}

test.describe("Firefox public smoke", () => {
  test("opens the first-visit path and hands control to the homepage", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("cie:first-visit-guide");
      window.sessionStorage.removeItem("cie:first-visit-spotlight-pending");
    });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });

    const guide = page.getByRole("dialog", { name: /find what may apply/i });
    await expect(guide).toBeVisible();
    await guide.getByRole("button", { name: "Explore on my own" }).click();
    await expect(guide).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Find Chicago Incentives");
    await expect(page.locator('[data-tour="address-search"] input')).toBeVisible();
  });

  test("renders the public program directory", async ({ page }) => {
    await markGuideComplete(page);
    await page.goto(`${baseURL}/programs`, { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { level: 1, name: "Incentive Programs" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Chicago Incentive Explorer · One-Page Overview",
      }),
    ).toBeVisible();
    const overview = page.locator("#cheat-sheet");
    await expect(overview.getByText("Federal", { exact: true }).first()).toBeVisible();
    await expect(overview.getByText("State", { exact: true }).first()).toBeVisible();
  });

  test("renders the sample report and opens its download action", async ({ page }) => {
    await markGuideComplete(page);
    await page.goto(`${baseURL}${SAMPLE_REPORT_URL}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#verdict")).toBeVisible({ timeout: 45000 });

    const actions = page.locator(".report-actions");
    await expect(actions.getByRole("button", { name: "Download PDF" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Save to Workspace" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Email Report" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Share Report" })).toBeVisible();

    await actions.getByRole("button", { name: "Download PDF" }).click();
    await expect(page.getByRole("heading", { name: "Download Report" })).toBeVisible();
  });
});
