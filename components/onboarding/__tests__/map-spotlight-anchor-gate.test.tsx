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
 * unconditionally on its timeout, then `drive()` proceeding anyway:
 * driver.js's own `skipMissingElement` cascade-skips straight past the
 * absent search-step anchor to whichever later step happens to be ready,
 * so the tour's very first popover silently lands on step two or three.
 * The fix: `waitForAnchor` now reports whether it actually found the
 * anchor, and `startTour()` does not call `drive()` at all when it did
 * not — see MapSpotlight.tsx's doc comments for the full account.
 *
 * REVIEW FINDING (do not regress this): an earlier version of this file's
 * negative-path test passed unconditionally regardless of whether the
 * bail actually fires — falsified by changing MapSpotlight.tsx's
 * `if (!anchorReady)` to `if (false)` (bail disabled, tour always
 * drives) and observing the test stay green. Root cause: `startTour`'s
 * real (unmocked) `await import("driver.js")` takes a real, variable
 * amount of wall-clock time to resolve before `waitForAnchor` is even
 * CALLED — fake-time budget spent advancing the clock before that happens
 * is wasted (nothing is scheduled yet to advance), so a single fixed
 * "auto-start delay + anchor timeout" budget starting from render() could run
 * out before waitForAnchor's OWN countdown (which only starts once
 * IT is actually invoked) finishes. The negative test's `drive` was
 * therefore never actually reached one way or the other within budget —
 * it "passed" by simply not having gotten far enough to fail, in EITHER
 * app-code state.
 *
 * Fix: spy on document.querySelector to detect the exact moment
 * `waitForAnchor`'s internal `check()` starts querying the DOM for the
 * anchor selector (its first call), THEN advance a full dedicated budget
 * for the timeout FROM THAT POINT — so the budget spent on "waiting for
 * the real dynamic import to resolve" no longer eats into the budget
 * needed for the anchor-timeout countdown itself. Both tests now assert
 * that querySelector was actually reached (proving the async chain ran
 * far enough to matter) before asserting on drive()'s call count.
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

const SEARCH_ANCHOR_SELECTOR = '[data-tour="map-search"]';

/** Adds an element matching the real first tour step's anchor selector,
 *  with a non-zero jsdom-stubbed bounding box (jsdom has no layout engine;
 *  every real element reports an all-zero rect by default, which
 *  `waitForAnchor` would correctly treat as "not ready"). */
function mountSearchAnchor() {
  const el = document.createElement("div");
  el.setAttribute("data-tour", "map-search");
  document.body.appendChild(el);
  el.getBoundingClientRect = () =>
    ({ height: 40, width: 100, top: 0, left: 0, right: 100, bottom: 40, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return el;
}

/** Advances fake time in small steps (flushing real microtasks between
 *  each — the component's own `await import("driver.js")` included)
 *  until `querySelectorSpy` has been called with `SEARCH_ANCHOR_SELECTOR`
 *  at least once, meaning `waitForAnchor`'s internal `check()` has
 *  actually started polling. This absorbs however long the real dynamic
 *  import takes to resolve WITHOUT eating into the fixed budget the
 *  caller spends afterward on the anchor-timeout countdown itself — see
 *  this file's header comment for why that distinction matters. Fails
 *  loudly (via the outer test timeout) rather than looping forever if the
 *  anchor check is never reached at all. */
async function advanceUntilAnchorCheckStarts(
  querySelectorSpy: ReturnType<typeof vi.spyOn>,
  stepMs = 50,
) {
  while (!querySelectorSpy.mock.calls.some(([sel]: [string]) => sel === SEARCH_ANCHOR_SELECTOR)) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
}

/** Advances fake time in small steps for a fixed total duration, flushing
 *  real microtasks between each. Used AFTER `advanceUntilAnchorCheckStarts`
 *  confirms polling has begun, so this budget is spent entirely on the
 *  thing it is meant to cover. */
async function advanceFor(totalMs: number, stepMs = 250) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
}

describe("MapSpotlight — anchor-mount gate (hardening round)", () => {
  let querySelectorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
    vi.useFakeTimers();
    drive.mockClear();
    destroy.mockClear();
    querySelectorSpy = vi.spyOn(document, "querySelector");
  });

  afterEach(() => {
    cleanup();
    querySelectorSpy.mockRestore();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it(
    "does NOT start the tour when the search anchor never mounts within the wait window — red if the gate reverts to proceeding on timeout",
    async () => {
      window.localStorage.setItem("cie:first-visit-guide", RESOLVED_SITEWIDE);
      render(<MapSpotlight />);

      // [data-tour="map-search"] is never added to the DOM in this test —
      // wait for waitForAnchor to actually start looking for it, THEN
      // spend its full 60s timeout budget (plus margin) confirming it
      // keeps not finding it.
      await advanceUntilAnchorCheckStarts(querySelectorSpy);
      await advanceFor(60500);

      // Proves the async chain actually ran far enough to matter — not
      // just that the budget expired before anything happened.
      expect(querySelectorSpy).toHaveBeenCalledWith(SEARCH_ANCHOR_SELECTOR);
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

      await advanceUntilAnchorCheckStarts(querySelectorSpy);
      // One check tick is enough — the anchor is already there.
      await advanceFor(300);

      expect(querySelectorSpy).toHaveBeenCalledWith(SEARCH_ANCHOR_SELECTOR);
      expect(drive).toHaveBeenCalledTimes(1);
    },
    30000,
  );

  it("cancels a pending anchor wait when the map page unmounts", async () => {
    window.localStorage.setItem("cie:first-visit-guide", RESOLVED_SITEWIDE);
    const rendered = render(<MapSpotlight />);

    await advanceUntilAnchorCheckStarts(querySelectorSpy);
    rendered.unmount();
    mountSearchAnchor();
    await advanceFor(300);

    expect(drive).not.toHaveBeenCalled();
  });
});
