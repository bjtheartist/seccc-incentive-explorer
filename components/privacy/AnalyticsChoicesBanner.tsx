"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ANALYTICS_CHOICES_OPEN_EVENT,
  globalPrivacyControlEnabled,
  readAnalyticsConsent,
  writeAnalyticsConsent,
  type AnalyticsConsent,
} from "@/lib/analytics-consent";

interface AnalyticsChoicesBannerViewProps {
  current: AnalyticsConsent | null;
  gpc: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onClose: () => void;
}

export function AnalyticsChoicesBannerView({
  current,
  gpc,
  onAccept,
  onDecline,
  onClose,
}: AnalyticsChoicesBannerViewProps) {
  const off = gpc || current === "off";
  return (
    <div
      role="region"
      aria-label="Cookie and analytics choices"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#0C1B33]/15 bg-[#FAF9F6] shadow-[0_-8px_24px_rgba(12,27,51,0.08)]"
    >
      <div className="container mx-auto flex max-w-5xl flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm leading-relaxed text-[#0C1B33]/75">
          We use essential cookies to keep you signed in and keep the site secure,
          and analytics cookies to understand how Chicago Incentive Explorer is
          used. We never sell your information.{" "}
          {gpc
            ? "Your browser's Global Privacy Control signal is on, so analytics is off."
            : off
              ? "Analytics is currently off."
              : "You can turn analytics off at any time."}{" "}
          <Link href="/privacy" className="text-[#2563EB] underline underline-offset-2">
            Privacy policy
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          {gpc ? (
            <button
              type="button"
              onClick={onClose}
              className="border border-[#0C1B33] bg-[#0C1B33] px-4 py-2 text-xs font-medium text-white"
            >
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onDecline}
                aria-pressed={current === "off"}
                className="border border-[#0C1B33]/30 bg-white px-4 py-2 text-xs font-medium text-[#0C1B33]"
              >
                Turn off analytics
              </button>
              <button
                type="button"
                onClick={onAccept}
                aria-pressed={current === "on"}
                className="border border-[#0C1B33] bg-[#0C1B33] px-4 py-2 text-xs font-medium text-white"
              >
                {current === "off" ? "Turn analytics on" : "OK"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Shows once, until the visitor makes a choice. The footer's "Cookie choices"
 * button reopens it through ANALYTICS_CHOICES_OPEN_EVENT.
 */
export function AnalyticsChoicesBanner() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<AnalyticsConsent | null>(null);
  const [gpc, setGpc] = useState(false);

  useEffect(() => {
    const sync = () => {
      setCurrent(readAnalyticsConsent());
      setGpc(globalPrivacyControlEnabled());
    };
    // Deferred like FirstVisitGuide's auto-open: cookies are only readable
    // after hydration, and this keeps setState out of the effect body.
    const timer = window.setTimeout(() => {
      sync();
      if (readAnalyticsConsent() === null && !globalPrivacyControlEnabled()) setOpen(true);
    }, 0);

    const reopen = () => {
      sync();
      setOpen(true);
    };
    window.addEventListener(ANALYTICS_CHOICES_OPEN_EVENT, reopen);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(ANALYTICS_CHOICES_OPEN_EVENT, reopen);
    };
  }, []);

  // The banner is fixed to the bottom of the viewport. While it is open, pad
  // the page by its height so the footer can still scroll clear of it instead
  // of sitting underneath, unclickable, until the visitor makes a choice.
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const region = wrapperRef.current?.firstElementChild;
    if (!open || !region) return;
    const body = document.body;
    const previous = body.style.paddingBottom;
    const reserve = () => {
      body.style.paddingBottom = `${region.getBoundingClientRect().height}px`;
    };
    reserve();
    const observer = new ResizeObserver(reserve);
    observer.observe(region);
    return () => {
      observer.disconnect();
      body.style.paddingBottom = previous;
    };
  }, [open]);

  if (!open) return null;

  const choose = (value: AnalyticsConsent) => {
    writeAnalyticsConsent(value);
    setCurrent(value);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef}>
      <AnalyticsChoicesBannerView
        current={current}
        gpc={gpc}
        onAccept={() => choose("on")}
        onDecline={() => choose("off")}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

export function AnalyticsChoicesButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(ANALYTICS_CHOICES_OPEN_EVENT))}
      className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-white/20 hover:text-white/60 transition-colors"
    >
      Cookie Choices
    </button>
  );
}

/** In-text variant for the privacy policy page. */
export function AnalyticsChoicesInlineButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(ANALYTICS_CHOICES_OPEN_EVENT))}
      className="text-[#2563EB] underline underline-offset-2"
    >
      Cookie Choices
    </button>
  );
}
