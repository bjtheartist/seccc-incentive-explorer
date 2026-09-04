"use client";

import type { Config, Driver, DriveStep } from "driver.js";
import { readFirstVisitGuidePreference } from "@/lib/first-visit-guide";
import { useCallback, useEffect, useRef } from "react";
import {
  MAP_GUIDE_OPEN_EVENT,
  MAP_GUIDE_RESOLVED_EVENT,
  MAP_TOUR_END_EVENT,
  MAP_TOUR_START_EVENT,
  MAP_TOUR_STEPS,
  chooseTourSide,
  mapTourPopoverHtml,
  mountMapTourHint,
  readMapGuidePreference,
  removeDemoBadge,
  removeMapTourHint,
  resolveTourAnchor,
  scrollTourAnchorIntoView,
  writeMapGuidePreference,
  type MapTourStepContext,
} from "@/lib/map-guide";

/** Delay before the first-visit auto-start. The map mounts through a dynamic
 * import with a loading screen and its search control only renders once tiles
 * are up, so this leans longer than the investment tour's delay; the per-step
 * `waitForElement` covers the remaining gap on slow connections. */
const AUTO_START_DELAY_MS = 900;

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** How long a tour start waits for the map to finish mounting its controls.
 * Real mobile/CI traces can cross 20 seconds while Mapbox initializes its
 * layers, so keep waiting in the background instead of abandoning a valid
 * first visit just before the search control becomes usable.
 *
 * Raised from 60s after measuring the actual anchor: MapView only renders
 * MapSearch (the `map-search` anchor) once its `loaded` state flips, and
 * `setLoaded(true)` is the LAST line of a `map.on("load")` handler that first
 * fetches and adds every zone layer, the zoning districts, parcels and vacant
 * properties. That whole chain — not just Mapbox's style load — sits in front
 * of step one. CI run 33637374842 measured it past 60s on a loaded runner
 * (page snapshot at 60s still showed the "Drawing zone boundaries" overlay
 * with the Mapbox canvas already up), which meant this gate expired on a map
 * that was merely slow, not broken: no tour, and — because the bail path
 * deliberately records no outcome — no explanation either. 120s keeps the
 * bail-out safety net for a genuinely dead map while letting a slow one still
 * get its tour. */
const ANCHOR_READY_TIMEOUT_MS = 120000;

/** Settle time after the pre-stop scroll, so driver.js positions the popover
 * against the anchor's final rect rather than a mid-scroll one. */
const LAYOUT_SETTLE_MS = 80;

/**
 * Resolves TRUE once the selector exists with layout, or FALSE after the
 * timeout or page unmount. The map's search control (and
 * the legend beside it) only mounts once tiles are up, which can outlast
 * any fixed pre-start delay on a slow connection — live verification caught
 * the auto-start racing the map load and skipping straight to the
 * always-in-DOM canvas step.
 *
 * Hardening round: this used to resolve unconditionally on timeout too,
 * with the comment "the tour still drives and skipMissingElement degrades
 * it gracefully." Live measurement under real CI-runner-level contention
 * (6 concurrent tabs sharing one machine, reproducing the class of load a
 * slow real device can also hit) showed that "degrade gracefully" is not
 * graceful at all: skipMissingElement doesn't wait quietly, it CASCADES —
 * drive() calls into driver.js immediately, the search anchor is still
 * absent, so step 1 is skipped, and the run opens on step 2 or 3 with no
 * indication anything went wrong. The caller now gets told which way this
 * resolved, so it can choose not to start a tour it already knows would be
 * broken, rather than caller-blind "proceed anyway."
 */
function waitForAnchor(
  selector: string,
  timeoutMs: number,
  isCancelled: () => boolean,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      if (isCancelled()) {
        resolve(false);
        return;
      }
      const element = document.querySelector<HTMLElement>(selector);
      if (element && element.getBoundingClientRect().height > 0) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }
      window.setTimeout(check, 250);
    };
    check();
  });
}

/**
 * The rebuilt map walkthrough: five stops that each DO the thing they name.
 *
 * Flow control stays with driver.js rather than being re-implemented here —
 * its keyboard handling (arrows, Escape) and its overlay-click behaviour both
 * route through the same per-step next/previous hooks the buttons use, so
 * hanging the tour's own work off `onHighlightStarted` (scroll the anchor
 * clear of the sticky nav, choose a side with room) and `onHighlighted` (run
 * the stop's `perform`) covers every way a visitor can move, including the
 * keyboard, with no bespoke navigation to keep in sync.
 *
 * Two hard-won behaviours from the public tour are preserved: a failed dynamic
 * import of driver.js is never recorded as a skip or a completion (storage
 * stays untouched so the tour can offer itself again next visit), and the
 * popover styling rides the same `cie-driver-popover` class already held to
 * WCAG AA.
 */
export function MapSpotlight() {
  const driverRef = useRef<Driver | null>(null);
  const startingRef = useRef(false);
  const outcomeRecordedRef = useRef(false);
  const autoStartHandledRef = useRef(false);
  const mountedRef = useRef(false);
  /** Which stops have already run their `perform` in this run. */
  const performedRef = useRef<Set<string>>(new Set());
  const runActiveRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      driverRef.current?.destroy();
      // A route change mid-run must not leave the injected demo furniture on
      // the page for the next mount to find.
      removeMapTourHint();
      removeDemoBadge();
    };
  }, []);

  const recordOutcome = useCallback((status: "completed" | "skipped") => {
    if (outcomeRecordedRef.current) return;
    outcomeRecordedRef.current = true;
    writeMapGuidePreference(window.localStorage, status);
    window.dispatchEvent(new Event(MAP_GUIDE_RESOLVED_EVENT));
  }, []);

  const startTour = useCallback(async () => {
    if (startingRef.current || driverRef.current?.isActive()) return;
    startingRef.current = true;
    outcomeRecordedRef.current = false;
    performedRef.current = new Set();
    const reduceMotion = prefersReducedMotion();

    try {
      const { driver } = await import("driver.js");

      // After the import (so a failed chunk still fails fast into the catch
      // below), hold the start until the map's first anchor has mounted.
      const anchorReady = await waitForAnchor(
        MAP_TOUR_STEPS[0].selector,
        ANCHOR_READY_TIMEOUT_MS,
        () => !mountedRef.current,
      );
      if (!anchorReady) {
        // The first anchor never mounted within the wait window, or this
        // page instance unmounted while it was waiting.
        // Starting anyway would let driver.js's own skipMissingElement
        // cascade straight to whichever LATER step happens to be ready,
        // opening the run on step two or three with no indication anything
        // was wrong — precisely what this gate exists to prevent (see
        // waitForAnchor's doc comment). Bail the same defensive way a
        // failed driver.js import does below: no outcome recorded, so a
        // later trigger (another page load's auto-start, or the persistent
        // replay button) gets a fresh, unraced attempt instead of this one
        // silently standing in as "shown".
        driverRef.current = null;
        startingRef.current = false;
        return;
      }

      runActiveRef.current = true;
      const stepContext: MapTourStepContext = {
        reduceMotion,
        isCancelled: () => !runActiveRef.current || !mountedRef.current,
      };

      // MapView snapshots the pre-tour camera on this, and restores it (plus
      // removing the demo marker and closing the demo dossier) on the end
      // event dispatched from the teardown below.
      window.dispatchEvent(new Event(MAP_TOUR_START_EVENT));
      // Created hidden so driver.js can resolve the stop-four anchor before
      // that stop's `perform` reveals it.
      mountMapTourHint();

      const teardown = () => {
        runActiveRef.current = false;
        // Reverse order, and only for stops that actually ran, so an undo
        // never fires against state its perform never touched.
        for (let i = MAP_TOUR_STEPS.length - 1; i >= 0; i -= 1) {
          const step = MAP_TOUR_STEPS[i];
          if (!step.undo || !performedRef.current.has(step.key)) continue;
          try {
            step.undo(stepContext);
          } catch (error) {
            console.error(`[map-spotlight] undo failed for ${step.key}:`, error);
          }
        }
        performedRef.current = new Set();
        removeMapTourHint();
        removeDemoBadge();
        window.dispatchEvent(new Event(MAP_TOUR_END_EVENT));
      };

      const releaseRun = () => {
        driverRef.current = null;
        startingRef.current = false;
      };

      const steps: DriveStep[] = MAP_TOUR_STEPS.map((step, index) => ({
        // A function, not the raw selector: driver.js re-evaluates it for its
        // `waitForElement` observer and its `skipMissingElement` check, so
        // resolveTourAnchor's "present but not rendered is the same as
        // missing" rule applies to both. That is what keeps the nav's
        // Generate Report link — which exists inside a CLOSED mobile sheet —
        // from being highlighted as a zero-box element on a phone.
        element: (() => resolveTourAnchor(step.selector)) as () => Element,
        data: { key: step.key },
        skipMissingElement: true,
        waitForElement: step.waitForElementMs ?? 1500,
        // Stop one leaves the search box interactive so a visitor can type
        // their own address over the demo one.
        disableActiveInteraction: index !== 0,
        popover: {
          title: step.title,
          description: mapTourPopoverHtml(step),
          side: step.side,
          align: step.align ?? "center",
          progressText: `Step ${index + 1} of ${MAP_TOUR_STEPS.length}`,
          // Nothing precedes the first stop, so it hides Back instead of
          // showing a dead control.
          ...(index === 0 ? { showButtons: ["next", "close"] as const } : {}),
        },
      }));

      const config: Config = {
        steps,
        animate: !reduceMotion,
        // driver.js's own scroll only fires when an anchor is fully outside
        // the viewport, which counts an element parked UNDER the 56px sticky
        // nav as "already visible" — the exact production bug where stop one
        // pointed at nothing. onHighlightStarted below does the scrolling.
        smoothScroll: false,
        allowClose: true,
        allowScroll: true,
        // A stray click on the dark overlay advances instead of ending the
        // run — closing stays on the X and Escape, matching the other tours.
        overlayClickBehavior: "nextStep",
        overlayColor: "#071225",
        overlayOpacity: 0.72,
        stagePadding: 8,
        stageRadius: 4,
        popoverOffset: 14,
        popoverClass: "cie-driver-popover",
        showProgress: true,
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Done",
        allowKeyboardControl: true,
        onHighlightStarted: (element, step) => {
          if (!(element instanceof HTMLElement)) return;
          scrollTourAnchorIntoView(element);
          // Re-pick the side against the anchor's post-scroll rect. Mutating
          // the step here lands before driver.js reads it back to position
          // the popover, and its own clamping still owns the case where no
          // side has room at all (it centres the popover over the page).
          const definition = MAP_TOUR_STEPS.find((s) => s.key === step.data?.key);
          if (definition && step.popover) {
            step.popover.side = chooseTourSide(
              element.getBoundingClientRect(),
              { width: window.innerWidth, height: window.innerHeight },
              definition.side,
            );
          }
        },
        onHighlighted: (_element, step) => {
          const key = step.data?.key as string | undefined;
          if (!key || performedRef.current.has(key)) return;
          const definition = MAP_TOUR_STEPS.find((s) => s.key === key);
          if (!definition?.perform) return;
          performedRef.current.add(key);
          // Fire-and-forget on purpose: the stop is already on screen, so the
          // visitor WATCHES the typing, the preset flip and the dossier open
          // rather than waiting on a blank pause for them.
          window.setTimeout(() => {
            if (stepContext.isCancelled()) return;
            void definition.perform?.(stepContext).catch((error) => {
              console.error(`[map-spotlight] step ${key} failed:`, error);
            });
          }, LAYOUT_SETTLE_MS);
        },
        onDoneClick: () => {
          recordOutcome("completed");
          driverRef.current?.destroy();
          releaseRun();
        },
        onCloseClick: () => {
          recordOutcome("skipped");
          driverRef.current?.destroy();
          releaseRun();
        },
        onDestroyed: () => {
          // Catch-all for Escape and any dismissal that does not go through
          // onCloseClick/onDoneClick above. recordOutcome is idempotent, so a
          // finished run does not get double-recorded here.
          recordOutcome("skipped");
          teardown();
          releaseRun();
        },
      };

      const driverInstance = driver(config);
      driverRef.current = driverInstance;
      driverInstance.drive();
    } catch (error) {
      // A driver.js chunk that never loads (hashed chunk invalidated by a
      // redeploy, an offline visitor, a script blocker) is a load failure,
      // not a user decision. Writing a "skipped" preference here would
      // suppress the tour on this browser permanently and file the failure as
      // a clean dismissal — claim the outcome slot so a stray onDestroyed
      // cannot record over it, but leave storage untouched so the tour can
      // try again on the next visit. Never throw past this boundary.
      outcomeRecordedRef.current = true;
      runActiveRef.current = false;
      console.error("[map-spotlight] driver.js failed to load:", error);
      removeMapTourHint();
      removeDemoBadge();
      driverRef.current = null;
      startingRef.current = false;
    }
  }, [recordOutcome]);

  // First-visit auto-start: only when no map-tour preference has been
  // recorded yet, AND only after the sitewide first-visit guide has been
  // resolved. The sitewide guide mounts globally — including on /map — and
  // auto-opens its welcome dialog for a visitor who has never resolved it;
  // starting this tour underneath it would stack two onboarding surfaces on
  // one screen (the collision the investment tour documented from live
  // verification). A visitor with the sitewide guide still pending gets only
  // that guide this visit; this tour auto-starts on their next visit, and
  // the replay button works regardless.
  useEffect(() => {
    if (autoStartHandledRef.current) return;
    autoStartHandledRef.current = true;
    if (readMapGuidePreference(window.localStorage)) return;
    if (!readFirstVisitGuidePreference(window.localStorage)) return;

    const timer = window.setTimeout(() => void startTour(), AUTO_START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [startTour]);

  // Persistent replay: the map header's entry point dispatches this event,
  // forever, regardless of any stored preference.
  useEffect(() => {
    const replay = () => void startTour();
    window.addEventListener(MAP_GUIDE_OPEN_EVENT, replay);
    return () => window.removeEventListener(MAP_GUIDE_OPEN_EVENT, replay);
  }, [startTour]);

  return null;
}
