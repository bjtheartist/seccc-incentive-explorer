"use client";

import type { Driver } from "driver.js";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { trackEvent } from "@/lib/analytics-events";
import {
  FIRST_VISIT_SPOTLIGHT_OPEN_EVENT,
  FIRST_VISIT_SPOTLIGHT_PENDING_KEY,
  FIRST_VISIT_SPOTLIGHT_STEPS,
  writeFirstVisitGuidePreference,
} from "@/lib/first-visit-guide";

function writePendingSpotlight() {
  try {
    window.sessionStorage.setItem(FIRST_VISIT_SPOTLIGHT_PENDING_KEY, "true");
  } catch {
    // Client navigation still works when session storage is unavailable.
  }
}

function takePendingSpotlight() {
  try {
    const pending = window.sessionStorage.getItem(FIRST_VISIT_SPOTLIGHT_PENDING_KEY) === "true";
    window.sessionStorage.removeItem(FIRST_VISIT_SPOTLIGHT_PENDING_KEY);
    return pending;
  } catch {
    return false;
  }
}

function focusAddressSearch() {
  window.setTimeout(() => {
    const container = document.querySelector<HTMLElement>('[data-tour="address-search"]');
    container?.scrollIntoView({ behavior: "smooth", block: "center" });
    container?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, 120);
}

export function FirstVisitSpotlight() {
  const pathname = usePathname();
  const router = useRouter();
  const driverRef = useRef<Driver | null>(null);
  const startingRef = useRef(false);
  const pendingRef = useRef(false);

  const startSpotlight = useCallback(async () => {
    if (pathname !== "/") {
      pendingRef.current = true;
      writePendingSpotlight();
      router.push("/#address-search");
      return;
    }
    if (startingRef.current || driverRef.current?.isActive()) return;

    startingRef.current = true;
    let outcomeRecorded = false;
    let activeStep = 1;

    const recordOutcome = (status: "completed" | "skipped", source: string) => {
      if (outcomeRecorded) return;
      outcomeRecorded = true;
      writeFirstVisitGuidePreference(window.localStorage, status);

      if (status === "completed") {
        trackEvent("first_visit_guide_completed", { source });
      } else {
        trackEvent("first_visit_guide_skipped", {
          source,
          metadata: { step: activeStep },
        });
      }
    };

    try {
      const { driver } = await import("driver.js");
      const driverInstance = driver({
        steps: FIRST_VISIT_SPOTLIGHT_STEPS.map((step) => ({
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
          },
        })),
        animate: true,
        smoothScroll: true,
        allowClose: true,
        allowScroll: true,
        overlayClickBehavior: "close",
        overlayColor: "#071225",
        overlayOpacity: 0.72,
        stagePadding: 8,
        stageRadius: 4,
        popoverOffset: 14,
        popoverClass: "cie-driver-popover",
        showProgress: true,
        progressText: "Step {{current}} of {{total}}",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Use my address",
        allowKeyboardControl: true,
        onHighlighted: (_element, step, options) => {
          activeStep = (options.index ?? 0) + 1;
          trackEvent("first_visit_guide_step_viewed", {
            source: "spotlight_tour",
            metadata: {
              step: activeStep,
              walkthroughKey: String(step.data?.key ?? "unknown"),
            },
          });
        },
        onDoneClick: (_element, _step, options) => {
          recordOutcome("completed", "spotlight_tour");
          options.driver.destroy();
          focusAddressSearch();
        },
        onCloseClick: (_element, _step, options) => {
          recordOutcome("skipped", "spotlight_close");
          options.driver.destroy();
        },
        onDestroyed: () => {
          recordOutcome("skipped", "spotlight_dismissed");
          driverRef.current = null;
          startingRef.current = false;
        },
      });

      driverRef.current = driverInstance;
      driverInstance.drive();
    } catch (error) {
      // A driver.js chunk that never loads (hashed chunk invalidated by a redeploy, an
      // offline visitor, a script blocker) is a load failure, not a user decision.
      // recordOutcome would persist a "skipped" preference here, which suppresses the
      // welcome guide on this browser permanently and files the failure as a clean
      // dismissal. Report it as the failure it is and leave the preference unwritten so
      // the guide can offer itself again on the next visit.
      outcomeRecorded = true; // claim the slot so a late destroy cannot file a skip either
      trackEvent("first_visit_guide_skipped", {
        source: "spotlight_unavailable",
        // The event taxonomy has no failure event, so the reason has to carry it: without
        // it a skip-rate read counts these load failures as deliberate dismissals.
        metadata: { step: activeStep, reason: "spotlight_load_failed" },
      });
      console.error("[spotlight] driver.js failed to load:", error);
      driverRef.current = null;
      startingRef.current = false;
      focusAddressSearch();
    }
  }, [pathname, router]);

  useEffect(() => {
    const openSpotlight = () => {
      window.setTimeout(() => void startSpotlight(), 80);
    };
    window.addEventListener(FIRST_VISIT_SPOTLIGHT_OPEN_EVENT, openSpotlight);
    return () => window.removeEventListener(FIRST_VISIT_SPOTLIGHT_OPEN_EVENT, openSpotlight);
  }, [startSpotlight]);

  useEffect(() => {
    if (pathname !== "/") return;
    const pendingFromSession = takePendingSpotlight();
    const pending = pendingRef.current || pendingFromSession;
    if (!pending) return;
    pendingRef.current = false;
    const timer = window.setTimeout(() => void startSpotlight(), 180);
    return () => window.clearTimeout(timer);
  }, [pathname, startSpotlight]);

  useEffect(
    () => () => {
      driverRef.current?.destroy();
    },
    [],
  );

  return null;
}
