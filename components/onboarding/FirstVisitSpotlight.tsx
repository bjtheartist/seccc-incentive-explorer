"use client";

import type { Config, Driver } from "driver.js";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { trackEvent } from "@/lib/analytics-events";
import {
  FIRST_VISIT_SPOTLIGHT_OPEN_EVENT,
  SAMPLE_REPORT_URL,
  SPOTLIGHT_HOME_STEPS,
  SPOTLIGHT_REPORT_STEPS,
  SPOTLIGHT_TOTAL_STEPS,
  peekPendingSpotlightLeg,
  takePendingSpotlightLeg,
  writeFirstVisitGuidePreference,
  writePendingSpotlightLeg,
} from "@/lib/first-visit-guide";

type SpotlightLeg = "home" | "report";

/** How long the report leg waits for the sample snapshot to finish rendering.
 *
 * Raised from 20s: this window opens the moment /report mounts, but the sample
 * snapshot is generated client-side (zones, census and program lookups behind
 * a "Generating Location Snapshot" screen) before any of the report anchors
 * below exist, and that generation is the slow part — measured at ~8s warm and
 * past 45s against a cold server/DB (CI run 33637374842 timed out at 45s with
 * the generating screen still up; reproduced locally on the first request
 * after a server start). When this window expired first, leg two never ran:
 * the visitor landed on a perfectly good report with the tour silently
 * recorded as `spotlight_report_unavailable`, which is also exactly how the
 * e2e flake presented — the report renders, the popover never returns. The
 * wait resolves as soon as the page settles, so a longer ceiling costs a warm
 * visit nothing and only changes the outcome for a slow one. */
const REPORT_READY_TIMEOUT_MS = 90000;

function focusAddressSearch() {
  window.setTimeout(() => {
    const container = document.querySelector<HTMLElement>('[data-tour="address-search"]');
    container?.scrollIntoView({ behavior: "smooth", block: "center" });
    container?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, 120);
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Resolves true once every selector exists with layout AND the document has
 * stopped growing (three unchanged height samples). The report streams its
 * sections in over a few seconds; measuring an anchor mid-stream sends the
 * tour's scroll to a position that no longer exists once layout settles.
 */
function waitForSettledElements(selectors: string[], timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    const startedAt = Date.now();
    let lastHeight = 0;
    let stableSamples = 0;
    const check = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }
      const allPresent = selectors.every((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        return !!element && element.getBoundingClientRect().height > 0;
      });
      const height = document.documentElement.scrollHeight;
      if (allPresent && height === lastHeight) {
        stableSamples += 1;
        if (stableSamples >= 3) {
          resolve(true);
          return;
        }
      } else {
        stableSamples = 0;
      }
      lastHeight = height;
      window.setTimeout(check, 400);
    };
    check();
  });
}

export function FirstVisitSpotlight() {
  const pathname = usePathname();
  const router = useRouter();
  const driverRef = useRef<Driver | null>(null);
  const startingRef = useRef(false);
  const pendingHomeRef = useRef(false);
  const outcomeRecordedRef = useRef(false);
  const handingOffRef = useRef(false);
  const activeStepRef = useRef(1);
  // Generation counter: hooks captured by an earlier leg's driver instance
  // (whose deferred teardown can fire after a route change) become inert.
  const runIdRef = useRef(0);
  const guardianRef = useRef<number | null>(null);

  const clearGuardian = useCallback(() => {
    if (guardianRef.current !== null) {
      window.clearInterval(guardianRef.current);
      guardianRef.current = null;
    }
  }, []);

  const recordOutcome = useCallback(
    (status: "completed" | "skipped", source: string) => {
      if (outcomeRecordedRef.current || handingOffRef.current) return;
      outcomeRecordedRef.current = true;
      writeFirstVisitGuidePreference(window.localStorage, status);

      if (status === "completed") {
        trackEvent("first_visit_guide_completed", { source });
      } else {
        trackEvent("first_visit_guide_skipped", {
          source,
          metadata: { step: activeStepRef.current },
        });
      }
    },
    [],
  );

  const driveLeg = useCallback(
    async (leg: SpotlightLeg) => {
      if (startingRef.current || driverRef.current?.isActive()) return;
      startingRef.current = true;
      handingOffRef.current = false;
      if (leg === "home") outcomeRecordedRef.current = false;
      const runId = ++runIdRef.current;
      const runIsCurrent = () => runId === runIdRef.current;

      const steps = leg === "home" ? SPOTLIGHT_HOME_STEPS : SPOTLIGHT_REPORT_STEPS;
      const stepOffset = leg === "home" ? 0 : SPOTLIGHT_HOME_STEPS.length;
      const reduceMotion = prefersReducedMotion();

      try {
        const { driver } = await import("driver.js");
        const config: Config = {
          steps: steps.map((step, index) => ({
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
              progressText: `Step ${stepOffset + index + 1} of ${SPOTLIGHT_TOTAL_STEPS}`,
              // Back cannot cross the page handoff, so each leg's first stop
              // hides it instead of showing a dead control.
              ...(index === 0 ? { showButtons: ["next", "close"] as const } : {}),
              ...(step.nextBtnText ? { nextBtnText: step.nextBtnText } : {}),
            },
          })),
          animate: !reduceMotion,
          smoothScroll: !reduceMotion,
          allowClose: true,
          allowScroll: true,
          // A stray click on the dark overlay advances instead of ending the
          // run — closing stays on the X and Escape.
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
          doneBtnText: leg === "home" ? "Open the sample report" : "Use my address",
          allowKeyboardControl: true,
          onHighlighted: (element, step, options) => {
            if (!runIsCurrent()) return;
            const globalStep = stepOffset + (options.state.activeIndex ?? 0) + 1;
            activeStepRef.current = globalStep;
            trackEvent("first_visit_guide_step_viewed", {
              source: "spotlight_tour",
              metadata: {
                step: globalStep,
                walkthroughKey: String(step.data?.key ?? "unknown"),
              },
            });
          },
          onDoneClick: (_element, _step, options) => {
            if (!runIsCurrent()) return;
            // destroy() can defer its teardown past the route change, leaving
            // onDestroyed unfired — release the run state here so the next
            // leg's guard doesn't see a stuck "starting" flag.
            const releaseRun = () => {
              clearGuardian();
              driverRef.current = null;
              startingRef.current = false;
            };
            if (leg === "home") {
              // Hand off to the sample report; the report-leg effect resumes
              // the run once the snapshot has rendered.
              handingOffRef.current = true;
              writePendingSpotlightLeg("report");
              trackEvent("first_visit_guide_step_viewed", {
                source: "spotlight_tour",
                metadata: { step: stepOffset + steps.length, walkthroughKey: "sample-report-open" },
              });
              options.driver.destroy();
              releaseRun();
              router.push(SAMPLE_REPORT_URL);
              return;
            }
            recordOutcome("completed", "spotlight_tour");
            options.driver.destroy();
            releaseRun();
            writePendingSpotlightLeg("focus");
            router.push("/#address-search");
          },
          onCloseClick: (_element, _step, options) => {
            if (!runIsCurrent()) return;
            recordOutcome("skipped", "spotlight_close");
            options.driver.destroy();
          },
          onDestroyed: () => {
            if (!runIsCurrent()) return;
            recordOutcome("skipped", "spotlight_dismissed");
            clearGuardian();
            driverRef.current = null;
            startingRef.current = false;
          },
        };

        const driverInstance = driver(config);
        driverRef.current = driverInstance;
        driverInstance.drive();

        // Anchor guardian: the report streams sections in for several seconds,
        // so an anchor driver already scrolled to can drift far off-screen.
        // While the run is live, snap the active anchor back and repaint.
        clearGuardian();
        guardianRef.current = window.setInterval(() => {
          if (!runIsCurrent() || !driverRef.current?.isActive()) {
            clearGuardian();
            return;
          }
          const anchor = document.querySelector<HTMLElement>(".driver-active-element");
          if (!anchor) return;
          const rect = anchor.getBoundingClientRect();
          if (rect.bottom < -20 || rect.top > window.innerHeight + 20) {
            anchor.scrollIntoView({ behavior: "auto", block: "center" });
            driverRef.current.refresh();
          }
        }, 600);
      } catch (error) {
        // A driver.js chunk that never loads (hashed chunk invalidated by a
        // redeploy, an offline visitor, a script blocker) is a load failure,
        // not a user decision. Writing a "skipped" preference here would
        // suppress the welcome guide on this browser permanently and file the
        // failure as a clean dismissal — claim the outcome slot, report the
        // failure, and leave storage untouched so the guide can offer itself
        // again on the next visit.
        outcomeRecordedRef.current = true;
        trackEvent("first_visit_guide_skipped", {
          source: "spotlight_unavailable",
          metadata: { step: activeStepRef.current, reason: "spotlight_load_failed" },
        });
        console.error("[spotlight] driver.js failed to load:", error);
        clearGuardian();
        driverRef.current = null;
        startingRef.current = false;
        if (leg === "home") focusAddressSearch();
      }
    },
    [clearGuardian, recordOutcome, router],
  );

  const startSpotlight = useCallback(() => {
    if (pathname !== "/") {
      pendingHomeRef.current = true;
      writePendingSpotlightLeg("home");
      router.push("/#address-search");
      return;
    }
    void driveLeg("home");
  }, [driveLeg, pathname, router]);

  useEffect(() => {
    const openSpotlight = () => {
      window.setTimeout(() => startSpotlight(), 80);
    };
    window.addEventListener(FIRST_VISIT_SPOTLIGHT_OPEN_EVENT, openSpotlight);
    return () => window.removeEventListener(FIRST_VISIT_SPOTLIGHT_OPEN_EVENT, openSpotlight);
  }, [startSpotlight]);

  // Home leg: begin the run, or land the post-tour focus handoff. The marker
  // is peeked here and consumed only at drive time (Strict Mode safety).
  useEffect(() => {
    if (pathname !== "/") return;

    if (peekPendingSpotlightLeg() === "focus") {
      takePendingSpotlightLeg("focus");
      focusAddressSearch();
      return;
    }

    if (!pendingHomeRef.current && peekPendingSpotlightLeg() !== "home") return;
    const timer = window.setTimeout(() => {
      pendingHomeRef.current = false;
      takePendingSpotlightLeg("home");
      void driveLeg("home");
    }, 180);
    return () => window.clearTimeout(timer);
  }, [pathname, driveLeg]);

  // Report leg: wait for the sample snapshot to render, then resume the run.
  useEffect(() => {
    if (!pathname.startsWith("/report")) return;
    if (peekPendingSpotlightLeg() !== "report") return;

    let cancelled = false;
    void waitForSettledElements(
      SPOTLIGHT_REPORT_STEPS.map((step) => step.selector),
      REPORT_READY_TIMEOUT_MS,
    ).then((ready) => {
      if (cancelled || !takePendingSpotlightLeg("report")) return;
      if (!ready) {
        // The visitor still lands on the full sample report — a fine outcome —
        // but the run ends here so the welcome modal stays dismissed.
        recordOutcome("skipped", "spotlight_report_unavailable");
        return;
      }
      window.setTimeout(() => void driveLeg("report"), 150);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, driveLeg, recordOutcome]);

  useEffect(
    () => () => {
      clearGuardian();
      driverRef.current?.destroy();
    },
    [clearGuardian],
  );

  return null;
}
