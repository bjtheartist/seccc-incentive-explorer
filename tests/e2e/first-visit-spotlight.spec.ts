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

test("welcome offers one primary path and the demoted static preview", async ({ page }) => {
  await openFreshGuide(page);

  await expect(page.getByRole("button", { name: "Show me around" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explore on my own" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview the four steps here instead" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview the workflow" })).toHaveCount(0);
});

test("tours the homepage, hands off to the sample report, and returns to the address", async ({
  page,
}) => {
  test.setTimeout(120000);
  await openFreshGuide(page);
  await page.getByRole("button", { name: "Show me around" }).click();

  const popover = page.locator(".cie-driver-popover");
  await expect(popover).toBeVisible();
  await expect(popover.locator(".driver-popover-title")).toHaveText(
    "Start with a Chicago address",
  );
  await expect(popover.locator(".driver-popover-progress-text")).toHaveText("Step 1 of 6");
  // The opening stop has no Back control to dead-end on.
  await expect(popover.getByRole("button", { name: "Back" })).toHaveCount(0);
  await expect(page.locator('[data-tour="address-search"]')).toHaveClass(/driver-active-element/);

  await popover.getByRole("button", { name: "Next" }).click();
  await expect(popover.locator(".driver-popover-title")).toHaveText("Three ways in");
  await expect(page.locator('[data-tour="project-paths"]')).toHaveClass(/driver-active-element/);

  await popover.getByRole("button", { name: "Next" }).click();
  await expect(popover.locator(".driver-popover-title")).toHaveText("See a real snapshot first");

  // The handoff: leg one ends by opening the sample report.
  await popover.getByRole("button", { name: "Open the sample report" }).click();
  await expect(page).toHaveURL(/\/report\?.*source=welcome_tour/);

  // The tour's sample report renders without the email gate.
  await expect(page.locator("#verdict")).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole("heading", { name: "Your report is ready" })).toHaveCount(0);

  // Leg two resumes on the rendered snapshot.
  await expect(popover).toBeVisible({ timeout: 15000 });
  await expect(popover.locator(".driver-popover-title")).toHaveText("Findings, in plain terms");
  await expect(popover.locator(".driver-popover-progress-text")).toHaveText("Step 4 of 6");

  await popover.getByRole("button", { name: "Next" }).click();
  await expect(popover.locator(".driver-popover-title")).toHaveText(
    "Organize it around your goals",
  );
  await expect(page.locator('[data-tour="report-refine"]')).toHaveClass(/driver-active-element/);

  await popover.getByRole("button", { name: "Next" }).click();
  await expect(popover.locator(".driver-popover-title")).toHaveText("Leave with someone to call");
  await expect(popover.locator(".driver-popover-progress-text")).toHaveText("Step 6 of 6");

  // Completion routes to the visitor's own address, focused and recorded.
  await popover.getByRole("button", { name: "Use my address" }).click();
  await expect(page).toHaveURL(`${baseURL}/#address-search`);
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

test("a stray overlay click advances instead of ending the run", async ({ page }) => {
  await openFreshGuide(page);
  await page.getByRole("button", { name: "Show me around" }).click();

  const popover = page.locator(".cie-driver-popover");
  await expect(popover.locator(".driver-popover-title")).toHaveText(
    "Start with a Chicago address",
  );

  await page.locator("svg.driver-overlay").click({ position: { x: 10, y: 10 }, force: true });
  await expect(popover.locator(".driver-popover-title")).toHaveText("Three ways in");
  await expect(popover).toBeVisible();
});

test.describe("mobile spotlight", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps each home-leg popover inside the phone viewport", async ({ page }) => {
    await openFreshGuide(page);
    await page.getByRole("button", { name: "Show me around" }).click();

    const popover = page.locator(".cie-driver-popover");
    for (let step = 0; step < 3; step += 1) {
      await expect(popover).toBeVisible();
      const box = await popover.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844);

      if (step < 2) {
        await popover.getByRole("button", { name: "Next" }).click();
      }
    }
  });
});
