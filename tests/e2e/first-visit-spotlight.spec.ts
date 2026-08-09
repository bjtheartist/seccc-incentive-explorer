import { expect, test, type Page } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

async function openFreshGuide(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.removeItem("cie:first-visit-guide");
    window.sessionStorage.removeItem("cie:first-visit-spotlight-pending");
  });
  await page.goto(baseURL);
  await expect(page.getByRole("dialog", { name: /find what may apply/i })).toBeVisible();
}

test("walks through live homepage targets and returns focus to the address", async ({ page }) => {
  await openFreshGuide(page);
  await page.getByRole("button", { name: "Show me around" }).click();

  const popover = page.locator(".cie-driver-popover");
  await expect(popover).toBeVisible();
  await expect(popover.locator(".driver-popover-title")).toHaveText(
    "Start with a Chicago address",
  );
  await expect(page.locator('[data-tour="address-search"]')).toHaveClass(/driver-active-element/);

  for (const [title, target] of [
    ["Choose the path that fits your goal", "project-paths"],
    ["Try the workflow without an address", "sample-addresses"],
    ["Review findings and decide what to verify", "report-preview"],
  ] as const) {
    await popover.getByRole("button", { name: "Next" }).click();
    await expect(popover.locator(".driver-popover-title")).toHaveText(title);
    await expect(page.locator(`[data-tour="${target}"]`)).toHaveClass(/driver-active-element/);
  }

  await popover.getByRole("button", { name: "Use my address" }).click();
  await expect(popover).toBeHidden();
  await expect(page.locator('[data-tour="address-search"] input')).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("cie:first-visit-guide") || "null")),
    )
    .toMatchObject({ version: 1, status: "completed" });
});

test("replays from another public route and resumes the spotlight on the homepage", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "cie:first-visit-guide",
      JSON.stringify({
        version: 1,
        status: "completed",
        updatedAt: "2026-08-08T12:00:00.000Z",
      }),
    );
  });
  await page.goto(`${baseURL}/programs`);

  await page.getByRole("button", { name: "Site Tour" }).click();
  await expect(page.getByRole("dialog", { name: /find what may apply/i })).toBeVisible();
  await page.getByRole("button", { name: "Show me around" }).click();

  await expect(page).toHaveURL(`${baseURL}/#address-search`);
  await expect(page.locator(".cie-driver-popover")).toBeVisible();
  await expect(page.locator(".driver-popover-title")).toHaveText(
    "Start with a Chicago address",
  );
});

test.describe("mobile spotlight", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps each tour popover inside the phone viewport", async ({ page }) => {
    await openFreshGuide(page);
    await page.getByRole("button", { name: "Show me around" }).click();

    const popover = page.locator(".cie-driver-popover");
    for (let step = 0; step < 4; step += 1) {
      await expect(popover).toBeVisible();
      const box = await popover.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844);

      if (step < 3) {
        await popover.getByRole("button", { name: "Next" }).click();
      }
    }
  });
});
