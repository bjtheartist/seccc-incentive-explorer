import { expect, test, type Page, type Route } from "@playwright/test";

// Real Mapbox canvas + production components; hold optional upstream data so
// readiness cannot pass merely because the network happened to be fast.
// Block service workers so intercepted source failures cannot be bypassed by
// the worker's independent network requests or persistent API cache.
test.use({ serviceWorkers: "block", launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });
const geometry = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { name: "Test district", community: "TEST", zone_class: "B1-2" },
    geometry: { type: "Polygon", coordinates: [[[-87.64, 41.84], [-87.62, 41.84], [-87.62, 41.86], [-87.64, 41.86], [-87.64, 41.84]]] } }],
};
const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

async function prepare(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const preference = { status: "completed", updatedAt: new Date().toISOString() };
    localStorage.setItem("cie:first-visit-guide", JSON.stringify({ ...preference, version: 1 }));
    localStorage.setItem("cie:map-guide", JSON.stringify({ ...preference, version: 2 }));
  });
  await page.route("**/api/analytics/**", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/concierge/status", (route) => json(route, { enabled: false }));
  await page.route("**/api/census?**", (route) => json(route, {}));
  await page.route("**/api/parcel?**", (route) => json(route, {}));
  await page.route("**/api/representatives?**", (route) => json(route, {}));
  const optional: Route[] = [];
  await page.route(/data\.cityofchicago\.org\/resource\/(igwz-8jzy|dj47-wfun)\.geojson/, (route) => { optional.push(route); });
  return { errors, optional };
}

async function openMap(page: Page) {
  await page.goto("/map");
  await expect(page.getByTestId("map-search")).toBeVisible({ timeout: 30000 });
}

test("search and controls work while boundaries and zoning are still pending", async ({ page }) => {
  const { errors, optional } = await prepare(page);
  const zoneRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/zones/geojson/")) zoneRequests.push(request.url()); });
  await page.route("**/api/businesses?**", (route) => json(route, []));
  await page.route("**/api/geocode?**", (route) => json(route, { lat: 41.85, lon: -87.63, displayName: "1500 E 87th St, Chicago" }));
  await openMap(page);
  expect(optional).toHaveLength(2);
  expect(zoneRequests).toEqual([]);
  await expect(page.getByRole("button", { name: "Replay the map tour" })).toBeVisible();
  const input = page.getByTestId("map-search").getByRole("textbox");
  await input.fill("1500 E 87th St");
  await expect(page.getByTestId("map-search-results")).toContainText("1500 E 87th St, Chicago");
  // Late data populates the reserved layers and enables the same zoning UI.
  for (const route of optional) await json(route, geometry);
  await expect(page.locator("#map-zoning-family-filter")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("loads only selected layers, honors deselection during loading, and reuses data", async ({ page }) => {
  const { errors } = await prepare(page);
  const pending: Route[] = [];
  await page.route("**/api/zones/geojson/**", (route) => { pending.push(route); });
  await openMap(page);
  const tif = page.getByRole("checkbox", { name: /^TIF District/ });
  await tif.locator("..").locator("span").first().click();
  await expect.poll(() => pending.length).toBe(1);
  expect(pending[0].request().url()).toContain("/api/zones/geojson/tif");
  await expect(page.getByRole("status").filter({ hasText: "Loading TIF District" })).toBeVisible();
  await tif.locator("..").locator("span").first().click();
  await json(pending[0], geometry);
  await expect(tif).not.toBeChecked();
  await tif.locator("..").locator("span").first().click();
  await expect(page.getByRole("status").filter({ hasText: "Loading TIF District" })).toHaveCount(0);
  await expect(tif).toBeChecked();
  expect(pending).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("a failed selected layer reports its failure and can be retried", async ({ page }) => {
  await prepare(page);
  let attempts = 0;
  await page.route("**/api/zones/geojson/tif", (route) => json(route, ++attempts === 1 ? {} : geometry, attempts === 1 ? 503 : 200));
  await page.route("**/data/zones/tif-districts.geojson", (route) => json(route, {}, 503));
  await openMap(page);
  const tif = page.getByRole("checkbox", { name: /^TIF District/ });
  await tif.locator("..").locator("span").first().click();
  await expect(page.getByRole("status").filter({ hasText: "Could not load TIF District" })).toBeVisible();
  await tif.locator("..").locator("span").first().click();
  await tif.locator("..").locator("span").first().click();
  await expect.poll(() => attempts).toBe(2);
  await expect(page.getByRole("status").filter({ hasText: /Loading TIF|Could not load TIF/ })).toHaveCount(0);
  await expect(tif).toBeChecked();
});
