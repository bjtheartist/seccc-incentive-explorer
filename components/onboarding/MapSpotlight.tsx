"use client";

import type { Config, Driver } from "driver.js";
import { readFirstVisitGuidePreference } from "@/lib/first-visit-guide";
import { useCallback, useEffect, useRef } from "react";
import {
  MAP_GUIDE_OPEN_EVENT,
  MAP_TOUR_STEPS,
  readMapGuidePreference,
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

/** How long a tour start waits for the map to finish mounting its controls. */
const ANCHOR_READY_TIMEOUT_MS = 20000;

/**
 * Resolves once the selector exists with layout, or after the timeout. The
 * map's search control (and the legend beside it) only mounts once tiles are
 * up, which can outlast any fixed pre-start delay on a slow connection —
 * live verification caught the auto-start racing the map load and skipping
 * straight to the always-in-DOM canvas step. Gating on the first anchor keeps
 * the run starting at step one; on timeout the tour still drives and
 * `skipMissingElement` degrades it gracefully.
 */
function waitForAnchor(selector: string, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      const element = document.querySelector<HTMLElement>(selector);
      if (
        (element && element.getBoundingClientRect().height > 0) ||
        Date.now() - startedAt >= timeoutMs
      ) {
        resolve();
        return;
      }
      window.setTimeout(check, 250);
    };
    check();
  });
}

/**
 * Single-page spotlight tour for the public /map page, following
 * InvestmentSpotlight's conventions and the public tour's two hard-won fixes:
 * a failed dynamic import of driver.js is never recorded as a skip or a
 * completion (storage stays untouched so the tour can offer itself again next
 * visit), and the popover styling rides the same `cie-driver-popover` class
 * already held to WCAG AA.
 */
export function MapSpotlight() {
  const driverRef = useRef<Driver | null>(null);
  const startingRef = useRef(false);
  const outcomeRecordedRef = useRef(false);
  const autoStartHandledRef = useRef(false);

  const recordOutcome = useCallback((status: "completed" | "skipped") => {
    if (outcomeRecordedRef.current) return;
    outcomeRecordedRef.current = true;
    writeMapGuidePreference(window.localStorage, status);
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
      await waitForAnchor(MAP_TOUR_STEPS[0].selector, ANCHOR_READY_TIMEOUT_MS);

      const releaseRun = () => {
        driverRef.current = null;
        startingRef.current = false;
      };

      const config: Config = {
        steps: MAP_TOUR_STEPS.map((step, index) => ({
          element: step.selector,
          data: { key: step.key },
          skipMissingElement: true,
          waitForElement: 1500,
          disableActiveInteraction: true,
          popover: {
            title: step.title,
            description: step.description,
            side: step.side,
            align: "center",
            progressText: `Step ${index + 1} of ${MAP_TOUR_STEPS.length}`,
            // Nothing precedes the first stop, so it hides Back instead of
            // showing a dead control.
            ...(index === 0 ? { showButtons: ["next", "close"] as const } : {}),
          },
        })),
        animate: !reduceMotion,
        smoothScroll: !reduceMotion,
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

  // Persistent replay: the "How to use this map" button dispatches this
  // event, forever, regardless of any stored preference.
  useEffect(() => {
    const replay = () => void startTour();
    window.addEventListener(MAP_GUIDE_OPEN_EVENT, replay);
    return () => window.removeEventListener(MAP_GUIDE_OPEN_EVENT, replay);
  }, [startTour]);

  useEffect(
    () => () => {
      driverRef.current?.destroy();
    },
    [],
  );

  return null;
}
