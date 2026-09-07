"use client";

import type { Config, Driver, DriveStep } from "driver.js";
import { readFirstVisitGuidePreference } from "@/lib/first-visit-guide";
import { useCallback, useEffect, useRef } from "react";
import {
  MAP_GUIDE_OPEN_EVENT,
  MAP_GUIDE_RESOLVED_EVENT,
  MAP_TOUR_STEPS,
  chooseTourSide,
  mapTourPopoverHtml,
  readMapGuidePreference,
  resolveTourAnchor,
  scrollTourAnchorIntoView,
  writeMapGuidePreference,
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

// Wait for usable map controls without depending on optional boundary data.
const ANCHOR_READY_TIMEOUT_MS = 120000;

/** A failed or unmounted map never starts a tour on a later, unrelated step. */
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

/** A visitor-paced guide: navigation changes the spotlight, never map state. */
export function MapSpotlight() {
  const driverRef = useRef<Driver | null>(null);
  const startingRef = useRef(false);
  const outcomeRecordedRef = useRef(false);
  const autoStartHandledRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      driverRef.current?.destroy();
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

      const releaseRun = () => {
        driverRef.current = null;
        startingRef.current = false;
      };

      // Resolve visible desktop/mobile controls once so progress never counts
      // hidden steps or cascades through missing anchors.
      const availableSteps = MAP_TOUR_STEPS.filter((step, index) =>
        index === 0 || resolveTourAnchor(step.selector),
      );
      const steps: DriveStep[] = availableSteps.map((step, index) => ({
        // A function, not the raw selector: driver.js re-evaluates it for its
        // `waitForElement` observer and its `skipMissingElement` check, so
        // resolveTourAnchor's "present but not rendered is the same as
        // missing" rule applies to both. That is what keeps the nav's
        // Generate Report link — which exists inside a CLOSED mobile sheet —
        // from being highlighted as a zero-box element on a phone.
        element: (() => resolveTourAnchor(step.selector)) as () => Element,
        data: { key: step.key },
        skipMissingElement: true,
        waitForElement: 1500,
        disableActiveInteraction: true,
        popover: {
          title: step.title,
          description: mapTourPopoverHtml(step),
          side: step.side,
          align: step.align ?? "center",
          progressText: `Step ${index + 1} of ${availableSteps.length}`,
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
        // Accidental clicks on the dimmed page must not rush the walkthrough.
        overlayClickBehavior: () => {},
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
        onDestroyStarted: () => {
          // Escape can arrive during the highlight transition, before driver.js
          // has an active element for onDestroyed. Record the dismissal here.
          recordOutcome("skipped");
          driverRef.current?.destroy();
          releaseRun();
        },
        onDestroyed: () => {
          // Catch-all for Escape and any dismissal that does not go through
          // onCloseClick/onDoneClick above. recordOutcome is idempotent, so a
          // finished run does not get double-recorded here.
          recordOutcome("skipped");
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
      console.error("[map-spotlight] driver.js failed to load:", error);
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
