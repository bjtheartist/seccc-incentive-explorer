import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("the guide opens on demand and preserves its draft across page navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("cie:first-visit-guide", JSON.stringify({ version: 1, status: "completed", updatedAt: new Date().toISOString() })));
  await page.route("**/api/concierge/status", (route) => route.fulfill({ json: { enabled: true } }));
  await page.route("**/api/analytics/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/programs");
  await expect(page.getByRole("complementary", { name: "Incentive Guide" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open Incentive Guide" }).click();
  const guide = page.getByRole("complementary", { name: "Incentive Guide" });
  await expect(guide).toBeVisible();
  await guide.getByRole("textbox").fill("Help me explore incentives");
  await guide.getByRole("button", { name: "Close Incentive Guide" }).click();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Generate Report", exact: true }).click();
  await expect(page).toHaveURL(/\/report/);
  await page.getByRole("button", { name: "Open Incentive Guide" }).click();
  await expect(guide.getByRole("textbox")).toHaveValue("Help me explore incentives");
  expect(errors).toEqual([]);
});
