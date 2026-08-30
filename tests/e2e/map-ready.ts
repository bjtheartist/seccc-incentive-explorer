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
