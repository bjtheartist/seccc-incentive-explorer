import { expect, test, type Page } from "@playwright/test";
import { waitForMapIdle } from "./map-ready";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Mapbox GL needs WebGL; headless Chromium only provides it through SwiftShader.
test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

const RESOLVED_SITEWIDE = JSON.stringify({
  version: 1,
  status: "completed",
  updatedAt: "2026-08-10T00:00:00.000Z",
});
const RESOLVED_MAP = JSON.stringify({
  version: 1,
  status: "completed",
  updatedAt: "2026-08-10T00:00:00.000Z",
});

/** A phone visitor who has dismissed both guided tours. */
async function openMapOnPhone(page: Page) {
  await page.addInitScript(
    ([sitewide, mapGuide]) => {
      window.localStorage.setItem("cie:first-visit-guide", sitewide);
      window.localStorage.setItem("cie:map-guide", mapGuide);
    },
    [RESOLVED_SITEWIDE, RESOLVED_MAP],
  );
  await page.goto(`${baseURL}/map`, { waitUntil: "domcontentloaded" });
  // Against production over the network with SwiftShader WebGL the search
  // control can take ~35s to mount; local builds take a few seconds.
  await expect(page.getByTestId("map-search")).toBeVisible({ timeout: 90000 });
  // Let the map settle before tapping — a real mapbox "idle" readiness
  // signal (components/map/MapView.tsx's data-map-idle) instead of a fixed
  // sleep. A tap computed against a map that's still loading tiles/settling
  // its initial camera can land on the wrong feature (or none), which is
  // exactly what made this flaky under CI runner load: the same pixel
  // sometimes resolves a different geographic point depending on timing.
  await waitForMapIdle(page, 30000);
}

test("tapping the map on a phone opens the location dossier fully below the search bar", async ({
  page,
}) => {
  test.setTimeout(180000);
  await openMapOnPhone(page);

  const canvas = page.locator('[data-tour="map-canvas"]');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  // Tap well inside the map, away from every overlay.
  await page.touchscreen.tap(box!.x + box!.width * 0.5, box!.y + box!.height * 0.62);

  const dossier = page.getByRole("complementary", { name: "Selected map location details" });
  await expect(dossier).toBeVisible({ timeout: 60000 });

  const search = await page.getByTestId("map-search").boundingBox();
  const card = await dossier.boundingBox();
  expect(search).not.toBeNull();
  expect(card).not.toBeNull();

  // The regression this guards: search bar and dossier once shared the same
  // top offset, so the search field covered the tapped location's title.
  const searchBottom = search!.y + search!.height;
  expect(card!.y, "dossier top must sit below the search bar's bottom edge").toBeGreaterThanOrEqual(
    searchBottom + 8,
  );

  // And the header inside the card is actually the topmost thing at its own
  // position — nothing overlays it.
  const headerCovered = await dossier.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const probe = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 12);
    return probe ? !el.contains(probe) : true;
  });
  expect(headerCovered, "another overlay is painted over the dossier header").toBe(false);
});
