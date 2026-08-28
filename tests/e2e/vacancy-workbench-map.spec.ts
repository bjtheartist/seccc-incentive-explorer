import { expect, test } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    ...(process.env.PLAYWRIGHT_CHROME_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE }
      : {}),
  },
});

type Box = { x: number; y: number; width: number; height: number };

function boxesOverlap(first: Box, second: Box): boolean {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

for (const width of [320, 360, 640, 667]) {
  test(`vacancy map controls remain separate at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      const completed = JSON.stringify({
        version: 1,
        status: "completed",
        updatedAt: "2026-08-27T00:00:00.000Z",
      });
      window.localStorage.setItem("cie:first-visit-guide", completed);
      window.localStorage.setItem("cie:map-guide", completed);
    });
    await page.goto(`${baseURL}/vacancy/60617?case=public-land&view=map#case-results`, {
      waitUntil: "domcontentloaded",
    });

    const canvas = page.locator(".mapboxgl-canvas");
    await expect(canvas).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole("button", { name: "Map layers" })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("case-workspace-search-area")).toHaveCount(0);

    await page.locator(".mapboxgl-ctrl-zoom-in").click();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      canvasBox!.x + canvasBox!.width / 2 + 36,
      canvasBox!.y + canvasBox!.height / 2,
      { steps: 4 },
    );
    await page.mouse.up();
    await expect(page.getByTestId("case-workspace-search-area")).toBeVisible();

    const searchBox = await page.getByTestId("case-workspace-search-area").boundingBox();
    const layersBox = await page.getByRole("button", { name: "Map layers" }).boundingBox();
    expect(searchBox).not.toBeNull();
    expect(layersBox).not.toBeNull();
    expect(boxesOverlap(searchBox!, layersBox!), "search and layer controls must not overlap").toBe(
      false,
    );

    await page.getByRole("button", { name: "list", exact: true }).click();
    await page.locator("section[aria-labelledby='case-workspace-title'] ul button").first().click();
    await page.getByRole("button", { name: "map", exact: true }).click();

    const legend = page.getByTestId("case-workspace-map-legend");
    const selectedAction = page.getByTestId("case-workspace-selected-action");
    await expect(legend).toBeVisible();
    await expect(selectedAction).toBeVisible();

    const legendBox = await legend.boundingBox();
    const selectedBox = await selectedAction.boundingBox();
    const mapboxLogoBox = await page.locator(".mapboxgl-ctrl-logo").boundingBox();
    const mapboxAttributionBox = await page.locator(".mapboxgl-ctrl-attrib").boundingBox();
    expect(legendBox).not.toBeNull();
    expect(selectedBox).not.toBeNull();
    expect(mapboxLogoBox).not.toBeNull();
    expect(mapboxAttributionBox).not.toBeNull();
    expect(boxesOverlap(legendBox!, selectedBox!), "legend and selected action must not overlap").toBe(
      false,
    );
    expect(boxesOverlap(legendBox!, mapboxLogoBox!), "legend must not cover the Mapbox logo").toBe(
      false,
    );
    expect(
      boxesOverlap(selectedBox!, mapboxAttributionBox!),
      "selected action must not cover Mapbox attribution",
    ).toBe(false);
  });
}

test("desktop vacancy map actions clear Mapbox bottom controls", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    const completed = JSON.stringify({
      version: 1,
      status: "completed",
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    window.localStorage.setItem("cie:first-visit-guide", completed);
    window.localStorage.setItem("cie:map-guide", completed);
  });
  await page.goto(`${baseURL}/vacancy/60617?case=public-land&view=map#case-results`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.locator(".mapboxgl-canvas")).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("case-workspace-map-layers")).toBeVisible();
  await page.locator("section[aria-labelledby='case-workspace-title'] ul button").first().click();

  const legendBox = await page.getByTestId("case-workspace-map-legend").boundingBox();
  const selectedBox = await page.getByTestId("case-workspace-selected-action").boundingBox();
  const mapboxLogoBox = await page.locator(".mapboxgl-ctrl-logo").boundingBox();
  const mapboxAttributionBox = await page.locator(".mapboxgl-ctrl-attrib").boundingBox();
  expect(legendBox).not.toBeNull();
  expect(selectedBox).not.toBeNull();
  expect(mapboxLogoBox).not.toBeNull();
  expect(mapboxAttributionBox).not.toBeNull();
  expect(boxesOverlap(legendBox!, mapboxLogoBox!), "legend must clear the Mapbox logo").toBe(false);
  expect(
    boxesOverlap(selectedBox!, mapboxAttributionBox!),
    "selected action must clear Mapbox attribution",
  ).toBe(false);
});
