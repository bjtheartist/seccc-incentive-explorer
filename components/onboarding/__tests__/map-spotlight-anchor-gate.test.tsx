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
 * "auto-start delay + 20s timeout" budget starting from render() could run
 * out before waitForAnchor's OWN 20s countdown (which only starts once
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
 *
 * LOAD-AWARE START (follow-up round): main's e2e job then failed the
 * WHOLE map-spotlight family together on one run (auto-start, replay, AND
 * mobile tour) — a globally slow runner, not the single-test race #237
 * fixed. Structural cause: once the 20s anchor window (ANCHOR_READY_TIMEOUT_MS)
 * expires under load, the app correctly bails per #237 — but that window
 * was being spent on "is the map done loading AT ALL", not just "is the
 * specific search anchor missing". On a slow enough runner (or a slow
 * real device), the MAP ITSELF can still be loading tiles well past 20s,
 * and the tour legitimately gives up before it ever had a fair shot.
 * `waitForMapIdle` now runs first, gated on components/map/MapView.tsx's
 * data-map-idle signal (mapbox's own idle event mirrored into the DOM),
 * with its own generous 60s budget — the anchor window only starts
 * counting once the map is otherwise ready, so it measures what it is
 * supposed to measure. The three tests below (plus the first one, kept
 * exactly as it was) cover: the tour must NOT bail just because the OLD
 * 20s mark passes while the map is still not idle; the tour DOES proceed
 * once idle flips and the anchor mounts; and the original anchor-absent
 * regression (#237's own falsification target, `if (!anchorReady)` ->
 * `if (false)`) still turns this file red — re-verified after this round.
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
const MAP_IDLE_SELECTOR = "[data-map-idle]";

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

/** Adds an element matching MapView.tsx's real map-idle container selector
 *  (`[data-map-idle]`), the same attribute `waitForMapIdle` polls. Returns
 *  the element so a test can flip its value later, mirroring mapbox's own
 *  idle event firing mid-wait. */
function mountMapIdleContainer(initialIdle: boolean) {
  const el = document.createElement("div");
  el.setAttribute("data-map-idle", initialIdle ? "true" : "false");
  document.body.appendChild(el);
  return el;
}

/** Advances fake time in small steps (flushing real microtasks between
 *  each — the component's own `await import("driver.js")` included)
 *  until `querySelectorSpy` has been called with `selector` at least
 *  once, meaning the corresponding internal `check()` loop has actually
 *  started polling. This absorbs however long the real dynamic import
 *  (and, for the anchor selector, the map-idle wait ahead of it) takes to
 *  resolve WITHOUT eating into the fixed budget the caller spends
 *  afterward on that specific wait's own countdown — see this file's
 *  header comment for why that distinction matters. Fails loudly (via the
 *  outer test timeout) rather than looping forever if the check is never
 *  reached at all. */
async function advanceUntilCheckStarts(
  querySelectorSpy: ReturnType<typeof vi.spyOn>,
  selector: string,
  stepMs = 50,
) {
  while (!querySelectorSpy.mock.calls.some(([sel]: [string]) => sel === selector)) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
}

/** Advances fake time in small steps for a fixed total duration, flushing
 *  real microtasks between each. Used AFTER `advanceUntilCheckStarts`
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
      // No [data-map-idle] element at all in this test — the "no MapView
      // mounted" fallback path, which must fall straight through to the
      // existing anchor wait unchanged (see waitForMapIdle's doc comment).
      render(<MapSpotlight />);

      // [data-tour="map-search"] is never added to the DOM in this test —
      // wait for waitForAnchor to actually start looking for it, THEN
      // spend its full 20s timeout budget (plus margin) confirming it
      // keeps not finding it.
      await advanceUntilCheckStarts(querySelectorSpy, SEARCH_ANCHOR_SELECTOR);
      await advanceFor(20500);

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
    "does NOT bail just because the OLD 20s anchor-only window passes, while the map itself is still not idle",
    async () => {
      window.localStorage.setItem("cie:first-visit-guide", RESOLVED_SITEWIDE);
      // A real map container is present but genuinely still booting
      // (tiles/style not settled) — the exact scenario that made the
      // whole map-spotlight family fail together on a slow runner: the
      // OLD code measured this 20s window against "is the map done at
      // all", not just "is the search anchor missing".
      mountMapIdleContainer(false);
      render(<MapSpotlight />);

      await advanceUntilCheckStarts(querySelectorSpy, MAP_IDLE_SELECTOR);
      // Past the OLD anchor-only threshold (20s), comfortably inside the
      // NEW map-idle budget (60s) — the tour must still be waiting on the
      // map, not bailed and not driven.
      await advanceFor(25000);

      expect(querySelectorSpy).toHaveBeenCalledWith(MAP_IDLE_SELECTOR);
      // Direct proof of the gating sequence, not just an absence of
      // drive(): the anchor wait must not have started AT ALL yet — if it
      // had, that would mean waitForMapIdle resolved (or was bypassed)
      // despite the map never reporting idle, which is the exact "measured
      // against the wrong clock" bug this round exists to fix.
      expect(querySelectorSpy).not.toHaveBeenCalledWith(SEARCH_ANCHOR_SELECTOR);
      expect(drive).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(MAP_GUIDE_STORAGE_KEY)).toBeNull();
    },
    40000,
  );

  it(
    "DOES start the tour once map-idle flips true and the search anchor mounts",
    async () => {
      window.localStorage.setItem("cie:first-visit-guide", RESOLVED_SITEWIDE);
      // Map present but not idle yet, and no anchor yet either — mirrors
      // a real page load: the container mounts first, tiles settle a
      // moment later, and the search control (this tour's first anchor)
      // only renders once they do.
      const mapIdleEl = mountMapIdleContainer(false);
      render(<MapSpotlight />);

      await advanceUntilCheckStarts(querySelectorSpy, MAP_IDLE_SELECTOR);
      // A modest stretch of "still loading" before it settles.
      await advanceFor(1000);

      // Mapbox's idle event fires, and the search control mounts —
      // MapView.tsx's own real sequencing (idle firing does not depend on
      // the anchor, but in practice the anchor renders once the map is
      // usable).
      mapIdleEl.setAttribute("data-map-idle", "true");
      mountSearchAnchor();

      await advanceUntilCheckStarts(querySelectorSpy, SEARCH_ANCHOR_SELECTOR);
      // One check tick is enough — the anchor is already there.
      await advanceFor(300);

      expect(querySelectorSpy).toHaveBeenCalledWith(MAP_IDLE_SELECTOR);
      expect(querySelectorSpy).toHaveBeenCalledWith(SEARCH_ANCHOR_SELECTOR);
      expect(drive).toHaveBeenCalledTimes(1);
    },
    30000,
  );
});
