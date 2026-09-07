import { expect, test, type Page } from "@playwright/test";
import { expectTourStep, waitForMapTourAnchor } from "./map-ready";

// Exercise the real map and spotlight; isolate requests from service-worker caches.
test.use({
  serviceWorkers: "block",
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});

const titles = [
  "Start with your location",
  "Choose the layers you need",
  "Explore a location",
  "Take it with you",
];
const searchInput = (page: Page) => page.locator('[data-tour="map-search"] input');

async function openMap(page: Page, resolved = false) {
  await page.addInitScript((alreadyResolved) => {
    const preference = { status: "completed", updatedAt: new Date().toISOString() };
    localStorage.setItem("cie:first-visit-guide", JSON.stringify({ ...preference, version: 1 }));
    if (alreadyResolved) localStorage.setItem("cie:map-guide", JSON.stringify({ ...preference, version: 2 }));
    else localStorage.removeItem("cie:map-guide");
  }, resolved);
  await page.route("**/api/analytics/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/map");
  await waitForMapTourAnchor(page);
}

test("waits for navigation, without demo typing, layer toggles, or overlay-click advancement", async ({ page }) => {
  test.setTimeout(180000);
  const demoRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(geocode\?|businesses\?|zones\/geojson\/)/.test(request.url())) demoRequests.push(request.url());
  });
  await openMap(page);
  const popover = page.locator(".cie-driver-popover");
  await expectTourStep(popover, titles[0]);
  await expect(popover.locator(".cie-tour-note")).toContainText("Take your time");
  await expect(popover.locator(".driver-popover-progress-text")).toHaveText("Step 1 of 4");

  // Deliberate dwell longer than the old typing and preset-flip timers.
  await page.waitForTimeout(2500);
  await expectTourStep(popover, titles[0]);
  await expect(searchInput(page)).toHaveValue("");
  await page.locator(".driver-overlay path").click({ position: { x: 10, y: 10 } });
  await expectTourStep(popover, titles[0]);

  await popover.getByRole("button", { name: "Next" }).click();
  await expectTourStep(popover, titles[1]);
  await page.waitForTimeout(1600);
  await expectTourStep(popover, titles[1]);
  await expect(page.locator('[data-tour="map-presets"] button[aria-pressed="true"]')).toHaveCount(0);
  await popover.getByRole("button", { name: "Back" }).click();
  await expectTourStep(popover, titles[0]);

  for (const title of titles.slice(1)) {
    await popover.getByRole("button", { name: "Next" }).click();
    await expectTourStep(popover, title);
  }
  await expect(popover.locator(".driver-popover-progress-text")).toHaveText("Step 4 of 4");
  await popover.getByRole("button", { name: "Done" }).click();
  await expect(popover).toBeHidden();
  await expect(searchInput(page)).toHaveValue("");
  await expect(page.getByTestId("map-tour-demo-badge")).toHaveCount(0);
  await expect(page.locator('[data-tour="map-hint"]')).toHaveCount(0);
  expect(demoRequests).toEqual([]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cie:map-guide") || "null")))
    .toMatchObject({ version: 2, status: "completed" });
});

test("replay and Escape preserve the visitor's own search, selected point, and layer", async ({ page }) => {
  test.setTimeout(180000);
  await page.route("**/api/businesses?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/geocode?**", (route) => route.fulfill({ json: {
    lat: 41.7364, lon: -87.5893, displayName: "1500 E 87th St, Chicago",
  } }));
  await page.route("**/api/zones/geojson/tif", (route) => route.fulfill({ json: { type: "FeatureCollection", features: [] } }));
  await openMap(page, true);
  const input = searchInput(page);
  await input.fill("1500 E 87th St");
  await page.getByTestId("map-search-results").getByRole("button", { name: /1500 E 87th St/ }).click();
  await expect(page.locator(".mapboxgl-marker")).toBeVisible();
  const value = await input.inputValue();
  const tif = page.getByRole("checkbox", { name: /^TIF District/ });
  await tif.locator("..").locator("span").first().click();
  await expect(tif).toBeChecked();

  await page.getByRole("button", { name: "Replay the map tour" }).click();
  const popover = page.locator(".cie-driver-popover");
  await expectTourStep(popover, titles[0]);
  await popover.getByRole("button", { name: "Next" }).click();
  await expectTourStep(popover, titles[1]);
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(input).toHaveValue(value);
  await expect(tif).toBeChecked();
  await expect(page.locator(".mapboxgl-marker")).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cie:map-guide") || "null")))
    .toMatchObject({ version: 2, status: "skipped" });
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px map tour`, () => {
    test.use({ viewport });
    test("shows four stable, correctly placed controls with working Back and Done", async ({ page }) => {
      test.setTimeout(180000);
      await openMap(page);
      const popover = page.locator(".cie-driver-popover");
      for (const [index, title] of titles.entries()) {
        await expectTourStep(popover, title);
        await expect(popover.locator(".driver-popover-progress-text")).toHaveText(`Step ${index + 1} of 4`);
        const box = (await popover.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        const anchor = page.locator(".driver-active-element").first();
        await expect(anchor).toBeVisible();
        const rect = (await anchor.boundingBox())!;
        expect(rect.width * rect.height).toBeLessThan(0.6 * viewport.width * viewport.height);
        expect(await anchor.evaluate((el) => Boolean(el.closest("header")) || el.getBoundingClientRect().top >= 56)).toBe(true);
        if (index === 3) {
          await expect(anchor).toHaveAttribute("data-tour", viewport.width < 768 ? "nav-menu" : "nav-report");
          await popover.getByRole("button", { name: "Done" }).click();
        } else {
          await popover.getByRole("button", { name: "Next" }).click();
        }
      }
      await expect(popover).toBeHidden();
      await expect(page.getByRole("button", { name: "Replay the map tour" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Show me around" })).toHaveCount(0);
    });
  });
}

test("leaves first-time visitors with just the sitewide welcome", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("cie:first-visit-guide");
    localStorage.removeItem("cie:map-guide");
  });
  await page.goto("/map");
  await expect(page.getByRole("dialog", { name: /find what may apply/i })).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.locator(".cie-driver-popover")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("cie:map-guide"))).toBeNull();
});
