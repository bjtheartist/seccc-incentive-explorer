"use client";

import type { Config, Driver } from "driver.js";
import { readFirstVisitGuidePreference } from "@/lib/first-visit-guide";
import { useCallback, useEffect, useRef } from "react";
import {
  INVESTMENT_GUIDE_OPEN_EVENT,
  INVESTMENT_TOUR_STEPS,
  readInvestmentGuidePreference,
  writeInvestmentGuidePreference,
} from "@/lib/investment-guide";

/** Delay before the first-visit auto-start, so the page's own streamed
 * content has a beat to settle before the tour starts measuring anchors. */
const AUTO_START_DELAY_MS = 400;

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Single-page spotlight tour for the gated /investment landing page. Reuses
 * the public tour's driver.js wrapper and its two hard-won fixes: a failed
 * dynamic import of driver.js must never be recorded as a skip or a
 * completion (it is a load failure, not a visitor decision, so storage stays
 * untouched and the tour can offer itself again next visit), and the popover
 * styling comes from the same `cie-driver-popover` class the public tour
 * already holds to WCAG AA.
 *
 * Unlike the public tour, this is one leg on one page: no session-storage
 * handoff, no route-change resume logic.
 */
export function InvestmentSpotlight() {
  const driverRef = useRef<Driver | null>(null);
  const startingRef = useRef(false);
  const outcomeRecordedRef = useRef(false);
  const autoStartHandledRef = useRef(false);

  const recordOutcome = useCallback((status: "completed" | "skipped") => {
    if (outcomeRecordedRef.current) return;
    outcomeRecordedRef.current = true;
    writeInvestmentGuidePreference(window.localStorage, status);
  }, []);

  const startTour = useCallback(async () => {
    if (startingRef.current || driverRef.current?.isActive()) return;
    startingRef.current = true;
    outcomeRecordedRef.current = false;
    const reduceMotion = prefersReducedMotion();

    try {
      const { driver } = await import("driver.js");

      const releaseRun = () => {
        driverRef.current = null;
        startingRef.current = false;
      };

      const config: Config = {
        steps: INVESTMENT_TOUR_STEPS.map((step, index) => ({
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
            progressText: `Step ${index + 1} of ${INVESTMENT_TOUR_STEPS.length}`,
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
        // run — closing stays on the X and Escape, matching the public tour.
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
        onDoneClick: (_element, _step, _options) => {
          recordOutcome("completed");
          driverRef.current?.destroy();
          releaseRun();
        },
        onCloseClick: (_element, _step, _options) => {
          recordOutcome("skipped");
          driverRef.current?.destroy();
          releaseRun();
        },
        onDestroyed: () => {
          // Catch-all for Escape and any dismissal that does not go through
          // onCloseClick/onDoneClick above. recordOutcome is idempotent, so
          // a run that already finished through one of those does not get
          // double-recorded here.
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
      // suppress the tour on this browser permanently and file the failure
      // as a clean dismissal — claim the outcome slot so a stray onDestroyed
      // can't record over it, but leave storage untouched so the tour can
      // try again on the next visit. Never throw past this boundary.
      outcomeRecordedRef.current = true;
      console.error("[investment-spotlight] driver.js failed to load:", error);
      driverRef.current = null;
      startingRef.current = false;
    }
  }, [recordOutcome]);

  // First-visit auto-start: only when no preference has been recorded yet,
  // AND only after the sitewide first-visit tour has been resolved.
  //
  // The public site tour mounts globally — including on this gated page — and
  // auto-starts for a visitor who has never resolved it. Two driver.js
  // instances then fight over one overlay: live verification (2026-08-11)
  // showed the collision force-"completing" this tour without a single step
  // being walked and filing a "skipped" on the public tour nobody chose. So a
  // visitor with the site tour still pending gets ONLY the site tour this
  // visit; this tour auto-starts on their next visit, and the "How to use
  // this page" button works regardless. Deterministic order, no cross-key
  // writes, both outcomes stay honest.
  useEffect(() => {
    if (autoStartHandledRef.current) return;
    autoStartHandledRef.current = true;
    if (readInvestmentGuidePreference(window.localStorage)) return;
    if (!readFirstVisitGuidePreference(window.localStorage)) return;
    
    const timer = window.setTimeout(() => void startTour(), AUTO_START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [startTour]);

  // Persistent replay: the "How to use this page" button dispatches this
  // event, forever, regardless of any stored preference.
  useEffect(() => {
    const replay = () => void startTour();
    window.addEventListener(INVESTMENT_GUIDE_OPEN_EVENT, replay);
    return () => window.removeEventListener(INVESTMENT_GUIDE_OPEN_EVENT, replay);
  }, [startTour]);

  useEffect(
    () => () => {
      driverRef.current?.destroy();
    },
    [],
  );

  return null;
}
