// @vitest-environment jsdom
/**
 * Hardening round: pins the firmed anchor-mount gate in
 * components/onboarding/MapSpotlight.tsx's `waitForAnchor` +
 * `startTour()`. Kept in its own file (not added to
 * map-spotlight.test.tsx) because that file's `vi.mock("driver.js", ...)`
 * is file-scoped and deliberately forces every import to THROW, to
 * exercise the load-failure path — these tests need driver.js to succeed
 * so `drive()` is a real, spyable call, and vitest module mocks can't
 * differ by describe block within one file.
 *
 * Live measurement (6 concurrent Chromium tabs sharing one machine,
 * reproducing the class of contention a slow real device or a busy CI
 * runner can also hit) showed the OLD `waitForAnchor` resolving
 * unconditionally on its 20s timeout, then `drive()` proceeding anyway:
 * driver.js's own `skipMissingElement` cascade-skips straight past the
 * absent search-step anchor to whichever later step happens to be ready,
 * so the tour's very first popover silently lands on step two or three.
 * The fix: `waitForAnchor` now reports whether it actually found the
 * anchor, and `startTour()` does not call `drive()` at all when it did
 * not — see MapSpotlight.tsx's doc comments for the full account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MapSpotlight } from "@/components/onboarding/MapSpotlight";
import { MAP_GUIDE_STORAGE_KEY } from "@/lib/map-guide";

// vi.mock(...) factories are hoisted above all other module-level code, so
// the mocks they close over must be created through vi.hoisted() — a plain
// `const drive = vi.fn()` here would be a temporal-dead-zone reference at
// the point the hoisted factory actually runs.
const { drive, destroy } = vi.hoisted(() => ({ drive: vi.fn(), destroy: vi.fn() }));

vi.mock("driver.js", () => ({
  driver: vi.fn(() => ({
    isActive: () => false,
    drive,
    destroy,
  })),
}));

const RESOLVED_SITEWIDE = JSON.stringify({
  version: 1,
  status: "completed",
  updatedAt: "2026-08-10T00:00:00.000Z",
});

/** Adds an element matching `[data-tour="map-search"]` — the real first
 *  tour step's anchor — with a non-zero jsdom-stubbed bounding box (jsdom
 *  has no layout engine; every real element reports an all-zero rect by
 *  default, which `waitForAnchor` would correctly treat as "not ready"). */
function mountSearchAnchor() {
  const el = document.createElement("div");
  el.setAttribute("data-tour", "map-search");
  document.body.appendChild(el);
  el.getBoundingClientRect = () =>
    ({ height: 40, width: 100, top: 0, left: 0, right: 100, bottom: 40, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return el;
}

/** Advances fake time in small steps rather than one large jump, flushing
 *  real microtasks (the component's own `await import("driver.js")`
 *  included) between each — avoids a real timing-synchronization pitfall
 *  where one big `advanceTimersByTimeAsync` call can race a genuine async
 *  dynamic import against the fake-timer clock. */
async function tick(totalMs: number, stepMs = 50) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
}

describe("MapSpotlight — anchor-mount gate (hardening round)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
    vi.useFakeTimers();
    drive.mockClear();
    destroy.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it(
    "does NOT start the tour when the search anchor never mounts within the wait window — red if the gate reverts to proceeding on timeout",
    async () => {
      window.localStorage.setItem("cie:first-visit-guide", RESOLVED_SITEWIDE);
      render(<MapSpotlight />);

      // Past the 900ms auto-start delay, then the full 20s anchor-ready
      // window — [data-tour="map-search"] is never added to the DOM.
      await tick(21000, 500);

      expect(drive).not.toHaveBeenCalled();
      // No outcome recorded either — mirrors the failed-driver.js-import
      // path: a later trigger (another page load, or the replay button)
      // gets a fresh, unraced attempt rather than this one silently
      // standing in as "shown".
      expect(window.localStorage.getItem(MAP_GUIDE_STORAGE_KEY)).toBeNull();
    },
    30000,
  );

  it(
    "DOES start the tour once the search anchor mounts with layout before the timeout — the gate opens, it isn't just permanently shut",
    async () => {
      window.localStorage.setItem("cie:first-visit-guide", RESOLVED_SITEWIDE);
      // Anchor already present with layout by the time the auto-start
      // delay elapses — the ordinary "map finished loading before the
      // tour's own wait window" case.
      mountSearchAnchor();
      render(<MapSpotlight />);

      await tick(1200);

      expect(drive).toHaveBeenCalledTimes(1);
    },
  );
});
