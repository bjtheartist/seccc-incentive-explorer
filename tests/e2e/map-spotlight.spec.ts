import { expect, test, type Page } from "@playwright/test";
import { expectTourStep, waitForMapTourAnchor } from "./map-ready";

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

const DEMO_ADDRESS = "1500 E 87th St, Chicago, IL 60619";
/** On the 87th Street corridor — the block the demo address sits on. */
const DEMO_LAT = 41.7364;
const DEMO_LON = -87.5893;

/**
 * The demo search resolves through /api/geocode, which proxies OpenStreetMap
 * Nominatim — a third-party service with its own rate limits and outages. The
 * behaviour under test is the TOUR (does it type, submit, populate the dossier
 * and hand the page back), not Nominatim's uptime, so the geocode is pinned
 * here. Everything downstream of it — zone lookup, dossier, records — runs for
 * real against the app.
 */
async function pinDemoGeocode(page: Page) {
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ lat: DEMO_LAT, lon: DEMO_LON, displayName: DEMO_ADDRESS }),
    }),
  );
}

/** A visitor who resolved the sitewide guide but has never seen the map tour. */
async function openMapAsReturningVisitor(page: Page) {
  await page.addInitScript((sitewide) => {
    window.localStorage.setItem("cie:first-visit-guide", sitewide);
    window.localStorage.removeItem("cie:map-guide");
  }, RESOLVED_SITEWIDE);
  await pinDemoGeocode(page);
  await page.goto(`${baseURL}/map`);
}

const searchInput = (page: Page) => page.locator('[data-tour="map-search"] input');
const demoBadge = (page: Page) => page.getByTestId("map-tour-demo-badge");

test("walks the five stops, performing each one, and hands the page back on Done", async ({
  page,
}) => {
  test.setTimeout(240000);
  await openMapAsReturningVisitor(page);

  // Synchronize on the tour's OWN readiness signal first — the same
  // `[data-tour="map-search"]` anchor MapSpotlight.tsx's `waitForAnchor`
  // polls for before it calls drive(). This test previously waited only on
  // the popover, which folds the entire map data boot into one opaque
  // budget: CI run 33318436827 failed here with "element(s) not found" on
  // `.cie-driver-popover` while the map was still loading, and raising that
  // number just moved the boundary. See tests/e2e/map-ready.ts.
  await waitForMapTourAnchor(page);

  const popover = page.locator(".cie-driver-popover");
  await expect(popover).toBeVisible({ timeout: 20000 });

  /* ── Stop 1: it types the demo address and submits it ───────────── */
  await expectTourStep(popover, "Search this address");
  await expect(popover.locator(".driver-popover-progress-text")).toHaveText("Step 1 of 5");
  await expect(page.locator('[data-tour="map-search"]')).toHaveClass(/driver-active-element/);
  // The illustrative-only line rides on the popover itself, not a footnote.
  await expect(popover.locator(".cie-tour-note")).toContainText(/illustration only/i);

  // The stop performs: the box fills in with the demo address, and the badge
  // marking it as an example appears alongside it.
  await expect(searchInput(page)).toHaveValue(DEMO_ADDRESS, { timeout: 30000 });
  await expect(demoBadge(page)).toBeVisible();
  await expect(demoBadge(page)).toHaveText("Example, for illustration");

  /* ── Stop 2: the dossier the search populated ───────────────────── */
  await popover.getByRole("button", { name: "Next" }).click();
  await expectTourStep(popover, "Here's what touches it");
  const dossier = page.locator('[data-tour="map-dossier"]');
  await expect(dossier).toHaveClass(/driver-active-element/);
  // Performed: the section is opened, and it has real content in it.
  await expect(dossier).toHaveAttribute("open", "", { timeout: 30000 });
  await expect(dossier).toContainText(/nearby records|mapped programs to review/i, {
    timeout: 30000,
  });
  await expect(popover.locator(".driver-popover-description")).toContainText(
    /do not by themselves confirm eligibility or stacking/i,
  );
  await expect(demoBadge(page)).toBeVisible();

  /* ── Stop 3: a preset flips live, then is handed back ───────────── */
  const presets = page.locator('[data-tour="map-presets"]');
  const presetBefore = await presets
    .locator('button[data-preset-id][aria-pressed="true"]')
    .count();

  await popover.getByRole("button", { name: "Next" }).click();
  await expectTourStep(popover, "Swap the lens");
  await expect(presets).toHaveClass(/driver-active-element/);

  // Flipped on...
  await expect
    .poll(
      () => presets.locator('button[data-preset-id][aria-pressed="true"]').count(),
      { timeout: 20000 },
    )
    .toBeGreaterThan(presetBefore);
  // ...and handed back to exactly what was active before.
  await expect
    .poll(
      () => presets.locator('button[data-preset-id][aria-pressed="true"]').count(),
      { timeout: 20000 },
    )
    .toBe(presetBefore);

  /* ── Stop 4: the hint marker, not the whole canvas ──────────────── */
  await popover.getByRole("button", { name: "Next" }).click();
  await expectTourStep(popover, "Ask the map anything");
  const hint = page.locator('[data-tour="map-hint"]');
  await expect(hint).toHaveClass(/driver-active-element/);
  // The old build highlighted `map-canvas` here and dimmed the whole page.
  await expect(page.locator('[data-tour="map-canvas"]')).not.toHaveClass(
    /driver-active-element/,
  );
  const hintBox = await hint.boundingBox();
  const viewport = page.viewportSize()!;
  expect(hintBox!.width * hintBox!.height).toBeLessThan(
    0.6 * viewport.width * viewport.height,
  );

  /* ── Stop 5: the nav's Generate Report control ──────────────────── */
  await popover.getByRole("button", { name: "Next" }).click();
  await expectTourStep(popover, "Take it with you");
  await expect(page.locator('[data-tour="nav-report"]')).toHaveClass(/driver-active-element/);
  await expect(popover.locator(".driver-popover-progress-text")).toHaveText("Step 5 of 5");

  /* ── Done: the page goes back to how it was found ───────────────── */
  await popover.getByRole("button", { name: "Done" }).click();
  await expect(popover).toBeHidden();
  await expect(searchInput(page)).toHaveValue("");
  await expect(demoBadge(page)).toHaveCount(0);
  await expect(page.locator('[data-tour="map-hint"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="map-dossier-wrapper"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("cie:map-guide") || "null")),
    )
    .toMatchObject({ version: 2, status: "completed" });
});

test("every popover stays inside the viewport, clear of the sticky nav", async ({ page }) => {
  test.setTimeout(240000);
  await openMapAsReturningVisitor(page);
  await waitForMapTourAnchor(page);

  const popover = page.locator(".cie-driver-popover");
  await expect(popover).toBeVisible({ timeout: 20000 });
  const viewport = page.viewportSize()!;

  for (const title of [
    "Search this address",
    "Here's what touches it",
    "Swap the lens",
    "Ask the map anything",
    "Take it with you",
  ]) {
    await expectTourStep(popover, title);
    const box = await popover.boundingBox();
    expect(box, title).not.toBeNull();
    expect(box!.x, title).toBeGreaterThanOrEqual(0);
    expect(box!.y, title).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, title).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height, title).toBeLessThanOrEqual(viewport.height);

    // Whatever this stop is pointing at must be clear of the 56px sticky nav
    // — the production bug was stop one's anchor sitting UNDER it while the
    // popover floated off pointing at nothing. The last stop's anchor is the
    // nav's own Generate Report CTA, which lives inside that bar by
    // definition, so it is exempt by being inside it rather than by being
    // special-cased on title.
    const anchorClear = await page
      .locator(".driver-active-element")
      .first()
      .evaluate((el) => Boolean(el.closest("header")) || el.getBoundingClientRect().top >= 56);
    expect(anchorClear, `${title}: anchor clear of the sticky nav`).toBe(true);

    if (title !== "Take it with you") {
      await popover.getByRole("button", { name: "Next" }).click();
    }
  }
});

test("Escape ends the run, records a skip, and restores the pre-tour state", async ({ page }) => {
  test.setTimeout(240000);
  await openMapAsReturningVisitor(page);
  await waitForMapTourAnchor(page);

  const popover = page.locator(".cie-driver-popover");
  await expect(popover).toBeVisible({ timeout: 20000 });
  await expectTourStep(popover, "Search this address");
  await expect(searchInput(page)).toHaveValue(DEMO_ADDRESS, { timeout: 30000 });
  await expect(demoBadge(page)).toBeVisible();

  // Keyboard control: arrows move, Escape closes.
  //
  // driver.js drops keyboard input while its stage transition is still
  // running (it bails on `__transitionCallback`), so a single press timed into
  // that window is silently ignored — which is a property of the library, not
  // a broken tour. Press until the stop actually changes rather than sleeping
  // on a magic number; a surplus press at either end of the run is a no-op.
  const pressUntilStep = async (key: "ArrowRight" | "ArrowLeft", title: string) => {
    await expect
      .poll(
        async () => {
          const current = await popover.locator(".driver-popover-title").textContent();
          if (current === title) return current;
          await page.keyboard.press(key);
          return popover.locator(".driver-popover-title").textContent();
        },
        { timeout: 30000, intervals: [300, 500, 800] },
      )
      .toBe(title);
  };

  await pressUntilStep("ArrowRight", "Here's what touches it");
  await pressUntilStep("ArrowLeft", "Search this address");

  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(searchInput(page)).toHaveValue("");
  await expect(demoBadge(page)).toHaveCount(0);
  await expect(page.locator('[data-tour="map-hint"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("cie:map-guide") || "null")),
    )
    .toMatchObject({ version: 2, status: "skipped" });
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

test("the map header carries the only entry point, and it demotes once resolved", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.addInitScript((sitewide) => {
    window.localStorage.setItem("cie:first-visit-guide", sitewide);
    window.localStorage.setItem(
      "cie:map-guide",
      JSON.stringify({ version: 2, status: "skipped", updatedAt: "2026-09-01T00:00:00.000Z" }),
    );
  }, RESOLVED_SITEWIDE);
  await pinDemoGeocode(page);
  await page.goto(`${baseURL}/map`);

  // components/onboarding/MapSpotlight.tsx's own `startTour()` already holds
  // an AUTO-START run until the map's first tour anchor (map-search) has
  // mounted (its `waitForAnchor` helper) — but this is a MANUAL replay via
  // the button, not an auto-start, and driver.js's own per-step
  // `waitForElement` + `skipMissingElement: true` means clicking before that
  // anchor exists can skip step one entirely under CI runner load, landing
  // the popover on step two or three instead. Wait for the same anchor the
  // app itself gates on before triggering the replay, so this test is
  // asserting the replay mechanism, not racing map mount.
  await waitForMapTourAnchor(page);

  // Already resolved, so the pill has collapsed to the labelled replay icon.
  await expect(page.getByRole("button", { name: "Replay the map tour" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show me around" })).toHaveCount(0);
  // And the old link under the map is gone — one entry point, not three.
  await expect(page.getByRole("button", { name: "How to use this map" })).toHaveCount(0);
  // The sitewide tour's own entry point is a DIFFERENT surface and stays.
  await expect(page.getByRole("button", { name: "Site Tour" })).toHaveCount(1);

  await page.getByRole("button", { name: "Replay the map tour" }).click();
  const popover = page.locator(".cie-driver-popover");
  await expect(popover).toBeVisible({ timeout: 20000 });
  await expectTourStep(popover, "Search this address");
});

test.describe("mobile map tour", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("skips the closed legend's presets stop and the sheeted nav CTA", async ({ page }) => {
    test.setTimeout(240000);
    await openMapAsReturningVisitor(page);
    await waitForMapTourAnchor(page);

    const popover = page.locator(".cie-driver-popover");
    await expect(popover).toBeVisible({ timeout: 20000 });
    await expectTourStep(popover, "Search this address");
    await expect(searchInput(page)).toHaveValue(DEMO_ADDRESS, { timeout: 30000 });
    await expect(demoBadge(page)).toBeVisible();

    const box1 = await popover.boundingBox();
    expect(box1!.x).toBeGreaterThanOrEqual(0);
    expect(box1!.x + box1!.width).toBeLessThanOrEqual(390);

    await popover.getByRole("button", { name: "Next" }).click();
    await expectTourStep(popover, "Here's what touches it");

    // The legend starts closed on a phone, so its presets stop is skipped and
    // Next lands on the hint marker. The nav's Generate Report link lives in a
    // CLOSED sheet, so the last stop is skipped too and this one shows Done.
    await popover.getByRole("button", { name: "Next" }).click();
    await expectTourStep(popover, "Ask the map anything");
    const box3 = await popover.boundingBox();
    expect(box3!.x).toBeGreaterThanOrEqual(0);
    expect(box3!.x + box3!.width).toBeLessThanOrEqual(390);

    await popover.getByRole("button", { name: "Done" }).click();
    await expect(popover).toBeHidden();
    await expect(demoBadge(page)).toHaveCount(0);
    await expect(page.locator('[data-tour="map-hint"]')).toHaveCount(0);
  });
});
