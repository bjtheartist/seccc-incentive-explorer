import { expect, test, type Page } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Mapbox GL needs WebGL, which headless Chromium only provides through
// SwiftShader software rendering — without these flags the map page crashes
// at Map construction and none of these scenarios can run.
test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

const RESOLVED_SITEWIDE = JSON.stringify({
  version: 1,
  status: "completed",
  updatedAt: "2026-08-10T00:00:00.000Z",
});

/** A visitor who resolved the sitewide guide but has never seen the map tour. */
async function openMapAsReturningVisitor(page: Page) {
  await page.addInitScript((sitewide) => {
    window.localStorage.setItem("cie:first-visit-guide", sitewide);
    window.localStorage.removeItem("cie:map-guide");
  }, RESOLVED_SITEWIDE);
  await page.goto(`${baseURL}/map`);
}

test("auto-starts at the search step once the map has mounted, and completes to a preference", async ({
  page,
}) => {
  test.setTimeout(150000);
  await openMapAsReturningVisitor(page);

  // The tour holds its start until the map's search control mounts (tiles
  // up), so the first visible popover must be step one — never a mid-tour
  // step that skipped past still-loading anchors.
  const popover = page.locator(".cie-driver-popover");
  await expect(popover).toBeVisible({ timeout: 75000 });
  await expect(popover.locator(".driver-popover-title")).toHaveText("Start with an address");
  await expect(popover.locator(".driver-popover-progress-text")).toHaveText("Step 1 of 4");
  await expect(page.locator('[data-tour="map-search"]')).toHaveClass(/driver-active-element/);

  for (const [title, target] of [
    ["Layers, in bundles", "map-presets"],
    ["The map answers clicks", "map-canvas"],
    ["The citywide picture", "map-glance"],
  ] as const) {
    await popover.getByRole("button", { name: "Next" }).click();
    await expect(popover.locator(".driver-popover-title")).toHaveText(title);
    await expect(page.locator(`[data-tour="${target}"]`)).toHaveClass(/driver-active-element/);
  }

  await popover.getByRole("button", { name: "Done" }).click();
  await expect(popover).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("cie:map-guide") || "null")),
    )
    .toMatchObject({ version: 1, status: "completed" });
});

test("stays silent for a first-time visitor — the sitewide welcome owns that visit", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("cie:first-visit-guide");
    window.localStorage.removeItem("cie:map-guide");
  });
  await page.goto(`${baseURL}/map`);

  await expect(page.getByRole("dialog", { name: /find what may apply/i })).toBeVisible();
  // Give the map tour's auto-start delay time to have fired if it (wrongly)
  // were going to, then confirm no spotlight run began under the dialog.
  await page.waitForTimeout(2500);
  await expect(page.locator(".cie-driver-popover")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.localStorage.getItem("cie:map-guide")),
  ).toBeNull();
});

test("the replay button restarts the tour even after it was skipped", async ({ page }) => {
  test.setTimeout(150000);
  await page.addInitScript((sitewide) => {
    window.localStorage.setItem("cie:first-visit-guide", sitewide);
    window.localStorage.setItem(
      "cie:map-guide",
      JSON.stringify({ version: 1, status: "skipped", updatedAt: "2026-08-01T00:00:00.000Z" }),
    );
  }, RESOLVED_SITEWIDE);
  await page.goto(`${baseURL}/map`);

  // components/onboarding/MapSpotlight.tsx's own `startTour()` already holds
  // an AUTO-START run until the map's first tour anchor (map-search) has
  // mounted (its `waitForAnchor` helper) — but this is a MANUAL replay via
  // the button, not an auto-start, and driver.js's own per-step
  // `waitForElement: 1500` + `skipMissingElement: true` means clicking
  // before that anchor exists can skip step one entirely under CI runner
  // load, landing the popover on step two or three instead. Wait for the
  // same anchor the app itself gates on before triggering the replay, so
  // this test is asserting the replay mechanism, not racing map mount.
  await expect(page.getByTestId("map-search")).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "How to use this map" }).click();
  const popover = page.locator(".cie-driver-popover");
  await expect(popover).toBeVisible({ timeout: 15000 });
  await expect(popover.locator(".driver-popover-title")).toHaveText("Start with an address");
});

test.describe("mobile map tour", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("skips the closed legend's presets stop and keeps popovers inside the viewport", async ({
    page,
  }) => {
    test.setTimeout(150000);
    await openMapAsReturningVisitor(page);

    // Same anchor-readiness wait as the replay test above — the mobile
    // layout's different mount order made this race more often than the
    // desktop auto-start test just above, which relies solely on the app's
    // own internal `waitForAnchor` gate.
    await expect(page.getByTestId("map-search")).toBeVisible({ timeout: 60000 });
    const popover = page.locator(".cie-driver-popover");
    await expect(popover).toBeVisible({ timeout: 15000 });
    await expect(popover.locator(".driver-popover-title")).toHaveText("Start with an address");

    // The legend starts closed on a phone, so its presets stop is skipped and
    // Next lands on the canvas step.
    const box1 = await popover.boundingBox();
    expect(box1!.x).toBeGreaterThanOrEqual(0);
    expect(box1!.x + box1!.width).toBeLessThanOrEqual(390);

    await popover.getByRole("button", { name: "Next" }).click();
    await expect(popover.locator(".driver-popover-title")).toHaveText("The map answers clicks");

    await popover.getByRole("button", { name: "Next" }).click();
    await expect(popover.locator(".driver-popover-title")).toHaveText("The citywide picture");
    const box3 = await popover.boundingBox();
    expect(box3!.x).toBeGreaterThanOrEqual(0);
    expect(box3!.x + box3!.width).toBeLessThanOrEqual(390);

    await popover.getByRole("button", { name: "Done" }).click();
    await expect(popover).toBeHidden();
  });
});
