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

/** How long the tour waits for the map to become genuinely idle (mapbox's
 *  own tiles/style/camera work all settled — see components/map/MapView.tsx's
 *  data-map-idle) before spending the anchor-mount budget below. Bounded and
 *  generous — much larger than the anchor window itself — because on a slow
 *  enough runner or real device, tiles can still be loading well past 20s;
 *  that is "the map is still booting", not "the search anchor is missing",
 *  and the two must not be measured by the same clock. */
const MAP_IDLE_TIMEOUT_MS = 60000;

/** How long to wait, when nothing with a data-map-idle attribute has ever
 *  been seen in the DOM, before concluding this render has no MapView
 *  mounted at all (a non-map context, or a test rendering MapSpotlight in
 *  isolation) rather than "MapView's chunk just hasn't mounted yet." A real
 *  /map page's MapView container renders synchronously once its dynamic
 *  import resolves — a lazy-loaded JS chunk, not something gated on network
 *  tile data — so this only needs to outlast that, not tile loading itself
 *  (data-map-idle's own generous MAP_IDLE_TIMEOUT_MS above covers that). */
const MAP_IDLE_CONTAINER_DETECT_MS = 2000;

/**
 * Resolves TRUE once `[data-map-idle="true"]` is found, or FALSE after
 * `timeoutMs` without ever finding it that way. If no element carrying a
 * data-map-idle attribute (any value) has appeared at all within
 * MAP_IDLE_CONTAINER_DETECT_MS, this context has no MapView mounted —
 * resolves TRUE immediately so startTour falls straight through to its
 * existing waitForAnchor behavior unchanged, instead of waiting out the
 * full timeout for a signal that will never arrive.
 */
function waitForMapIdle(timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const startedAt = Date.now();
    let sawContainer = false;
    const check = () => {
      const container = document.querySelector<HTMLElement>("[data-map-idle]");
      if (container) {
        sawContainer = true;
        if (container.getAttribute("data-map-idle") === "true") {
          resolve(true);
          return;
        }
      } else if (!sawContainer && Date.now() - startedAt >= MAP_IDLE_CONTAINER_DETECT_MS) {
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
 * Resolves TRUE once the selector exists with layout, or FALSE after the
 * timeout without ever finding it that way. The map's search control (and
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
function waitForAnchor(selector: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const startedAt = Date.now();
    const check = () => {
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
      // below), hold the start until the map itself is genuinely idle —
      // see waitForMapIdle's doc comment. Only once the app is otherwise
      // ready does the anchor window mean what it is supposed to mean
      // ("the search anchor specifically is missing"), not "the map is
      // still loading tiles under load." Bails the same defensive way a
      // missing anchor does below.
      const mapIdle = await waitForMapIdle(MAP_IDLE_TIMEOUT_MS);
      if (!mapIdle) {
        driverRef.current = null;
        startingRef.current = false;
        return;
      }

      // Hold the start until the map's first anchor has mounted.
      const anchorReady = await waitForAnchor(MAP_TOUR_STEPS[0].selector, ANCHOR_READY_TIMEOUT_MS);
      if (!anchorReady) {
        // The map's first tour anchor never mounted within the wait window.
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
