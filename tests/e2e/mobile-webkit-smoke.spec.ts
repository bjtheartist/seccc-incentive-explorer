import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_REPORT_URL } from "../../lib/first-visit-guide";
import { waitForMapIdle } from "./map-ready";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const COMPLETED_GUIDE = JSON.stringify({
  version: 1,
  status: "completed",
  updatedAt: "2026-08-30T00:00:00.000Z",
});

// The two tours version their preferences INDEPENDENTLY on purpose, so the
// fixtures cannot share one object: lib/map-guide.ts is at v2 after the
// walkthrough rebuild, and a v1 map preference reads as "never seen" — which
// would auto-start the tour over these smoke assertions.
const COMPLETED_MAP_GUIDE = JSON.stringify({
  version: 2,
  status: "completed",
  updatedAt: "2026-09-04T00:00:00.000Z",
});

async function dismissGuides(page: Page) {
  await page.addInitScript(
    ([completed, mapCompleted]) => {
      window.localStorage.setItem("cie:first-visit-guide", completed);
      window.localStorage.setItem("cie:map-guide", mapCompleted);
      window.sessionStorage.removeItem("cie:first-visit-spotlight-pending");
    },
    [COMPLETED_GUIDE, COMPLETED_MAP_GUIDE],
  );
}

test.describe("Mobile Safari / WebKit smoke", () => {
  test("keeps the homepage primary path inside an iPhone viewport", async ({ page }) => {
    await dismissGuides(page);
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Chicago");
    await expect(page.locator('[data-tour="address-search"] input')).toBeVisible();
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  });

  test("opens a tapped map location fully below the search bar", async ({ page }) => {
    test.setTimeout(180000);
    await dismissGuides(page);
    await page.goto(`${baseURL}/map`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("map-search")).toBeVisible({ timeout: 90000 });
    await waitForMapIdle(page, 45000);

    const canvas = page.locator('[data-tour="map-canvas"]');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.touchscreen.tap(
      canvasBox!.x + canvasBox!.width * 0.5,
      canvasBox!.y + canvasBox!.height * 0.62,
    );

    const dossier = page.getByRole("complementary", {
      name: "Selected map location details",
    });
    await expect(dossier).toBeVisible({ timeout: 60000 });

    const searchBox = await page.getByTestId("map-search").boundingBox();
    const dossierBox = await dossier.boundingBox();
    expect(searchBox).not.toBeNull();
    expect(dossierBox).not.toBeNull();
    expect(dossierBox!.y).toBeGreaterThanOrEqual(searchBox!.y + searchBox!.height + 8);

    const headerCovered = await dossier.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 12);
      return topmost ? !element.contains(topmost) : true;
    });
    expect(headerCovered).toBe(false);
  });

  test("keeps the vacancy list, selected record, and map switch usable", async ({ page }) => {
    test.setTimeout(180000);
    await dismissGuides(page);
    await page.goto(
      `${baseURL}/vacancy/60617?case=property-review&view=list#case-results`,
      { waitUntil: "domcontentloaded" },
    );

    const search = page.getByPlaceholder("Search address or PIN");
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill("20261090420000");
    const row = page
      .locator("section[aria-labelledby='case-workspace-title'] ul button")
      .filter({ hasText: "20261090420000" })
      .first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.click();

    const selectedRecord = page.getByTestId("case-workspace-selected-record");
    await expect(selectedRecord).toBeVisible();
    await expect(selectedRecord.locator('[aria-label="Property sources"] a')).toHaveCount(3);
    await expect(
      selectedRecord.getByRole("region", { name: "Choose an analysis" }).locator("a"),
    ).toHaveCount(3);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "map", exact: true }).click();
    await expect(page.locator(".mapboxgl-canvas")).toBeVisible({ timeout: 60000 });
    await page.getByRole("button", { name: "list", exact: true }).click();
    await expect(search).toBeVisible();
  });

  test("copies a stateful report link from the primary report actions", async ({ page }) => {
    await dismissGuides(page);
    // This deterministic shim verifies report-share wiring and the generated
    // stateful URL. Safari's clipboard permission prompt is outside this lane.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            window.sessionStorage.setItem("cie:e2e-copied-report-url", value);
          },
        },
      });
    });
    await page.goto(`${baseURL}${SAMPLE_REPORT_URL}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#verdict")).toBeVisible({ timeout: 45000 });

    const share = page.locator(".report-actions").getByRole("button", {
      name: "Share Report",
    });
    await share.scrollIntoViewIfNeeded();
    await share.click();
    await expect(page.getByRole("button", { name: "Link Copied!" })).toBeVisible();

    const copiedUrl = await page.evaluate(() =>
      window.sessionStorage.getItem("cie:e2e-copied-report-url"),
    );
    expect(copiedUrl).toContain("/report?");
    expect(copiedUrl).toContain("wv=2");
  });
});
