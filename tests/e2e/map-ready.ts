import { expect, type Page } from "@playwright/test";

/**
 * Hardening round: geometry reads against Mapbox-owned controls (the logo,
 * attribution, and anything repositioned on resize) and reads taken right
 * after a map interaction (record select, view toggle, a tap that queries
 * a feature) raced mapbox-gl's own internal settle timing — flaky under CI
 * runner load, not locally. components/vacancy/CaseWorkspaceMap.tsx and
 * components/map/MapView.tsx both now mirror mapbox's "idle" event (fires
 * once all pending style/tile/camera work is done, and gets reset by
 * movestart/zoomstart/resize) into a `data-map-idle` attribute on their map
 * container. Wait on THAT instead of a fixed sleep or the canvas merely
 * existing — this is a real readiness signal, not a longer guess.
 */
export async function waitForMapIdle(page: Page, timeout = 15000) {
  await expect(page.locator("[data-map-idle]").first()).toHaveAttribute("data-map-idle", "true", {
    timeout,
  });
}

/**
 * The map tour's OWN readiness signal, and the only one worth waiting on
 * before asserting anything about the spotlight.
 *
 * `[data-tour="map-search"]` is `MAP_TOUR_STEPS[0].selector` — the exact
 * element components/onboarding/MapSpotlight.tsx polls for in `waitForAnchor`
 * before it will call driver.js's `drive()`. It is NOT the map merely being
 * on screen: MapView renders MapSearch behind its `loaded` state, and
 * `setLoaded(true)` is the last line of a `map.on("load")` handler that first
 * fetches and adds every zone layer, the zoning districts, parcels and vacant
 * properties. So the popover's latency is the whole data boot, not Mapbox's
 * style load — which is why `data-map-idle` (mapbox's own `idle` event, fired
 * much earlier) is the wrong gate here and `waitForMapIdle` above is not used
 * by the tour specs.
 *
 * The three CI flakes this replaces were all the same shape: a spec waiting
 * on a DOWNSTREAM signal (the driver.js popover) with a budget SMALLER than
 * the app's own anchor-wait window, so the assertion expired on a map that
 * was slow rather than broken and reported "element(s) not found" on the
 * popover instead of naming the real cause. Waiting on the anchor first
 * localizes a slow map to a slow-map failure, and keeps the popover
 * assertion that follows about the tour.
 */
export const MAP_TOUR_ANCHOR_SELECTOR = '[data-tour="map-search"]';

/**
 * Deliberately under MapSpotlight's ANCHOR_READY_TIMEOUT_MS (120s) so the
 * app's gate is never the thing that expires first: if this wait times out,
 * the map genuinely did not finish booting, and the tour would not have
 * started either.
 */
export const MAP_TOUR_ANCHOR_TIMEOUT_MS = 90000;

/** Waits for the anchor the tour itself gates on. */
export async function waitForMapTourAnchor(page: Page) {
  await expect(page.locator(MAP_TOUR_ANCHOR_SELECTOR)).toBeVisible({
    timeout: MAP_TOUR_ANCHOR_TIMEOUT_MS,
  });
}

/**
 * Waits for the popover to be showing THIS SPECIFIC step, rather than reading
 * whichever step happens to be current. Budgeted for driver.js's per-step
 * `waitForElement: 1500` + `skipMissingElement: true` (a skipped stop can take
 * a step transition up to ~1.5s) plus the stage animation, which the default
 * 5s expect timeout only just covered — the "Received: Start with an address"
 * / "Received: Layers, in bundles" mismatches in CI runs 33286098220 and
 * 33318436827 were read mid-transition on that default budget.
 */
export async function expectTourStep(
  popover: ReturnType<Page["locator"]>,
  title: string,
) {
  await expect(popover.locator(".driver-popover-title")).toHaveText(title, {
    timeout: 15000,
  });
}
