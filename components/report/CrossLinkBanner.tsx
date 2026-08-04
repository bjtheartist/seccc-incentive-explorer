"use client";

import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { getPilotZipEntry } from "@/lib/pilot-zips";

/**
 * Cross-link funnel banners (WP2). Two presentations of the same idiom — a
 * white Warm Bureau card on a hairline navy border that hands a visitor who
 * just resolved an address to the next surface (vacant sites, the eligibility
 * survey, neighborhood investment activity).
 *
 * `sticky` pins to the bottom of the viewport and is dismissible; `inline`
 * sits in the flow below the report. Both are print-hidden — they are
 * navigation, not report content.
 */

/**
 * Vacancy detail routes are /vacancy/[zip] and `notFound()` on a non-pilot ZIP
 * (app/vacancy/[zip]/page.tsx -> getPilotZipEntry), so a ZIP we cannot resolve
 * to a published edition falls back to the /vacancy neighborhood picker
 * instead of sending the visitor to a 404.
 */
export function vacancyHref(zip?: string | null): string {
  const trimmed = zip?.trim();
  if (trimmed && getPilotZipEntry(trimmed)) return `/vacancy/${trimmed}`;
  return "/vacancy";
}

const PRIMARY_LINK_CLASS =
  "inline-flex min-h-11 items-center justify-center gap-2 bg-[#2563EB] px-6 py-3 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-white transition-colors hover:bg-[#1D4ED8]";

const SECONDARY_LINK_CLASS =
  "inline-flex min-h-11 items-center gap-1.5 font-mono-bureau text-[10px] tracking-[0.1em] uppercase text-[#0C1B33]/70 underline-offset-4 transition-colors hover:text-[#0C1B33] hover:underline";

/**
 * Sticky bottom cross-link shown once address-resolved results are on screen.
 * Dismissal is owned by the caller so the page can drop the matching bottom
 * padding at the same time (the bar overlays the document otherwise).
 */
export function StickyCrossLinkBanner({
  zip,
  onDismiss,
}: {
  zip?: string | null;
  onDismiss: () => void;
}) {
  return (
    <div
      data-testid="sticky-cross-link-banner"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#0C1B33]/10 bg-white/95 shadow-[0_-1px_12px_rgba(12,27,51,0.06)] backdrop-blur-sm print:hidden"
    >
      {/* right padding reserves space for the dismiss X AND the globally mounted
          concierge launcher (fixed bottom-4 right-4 z-[70]), which otherwise sits
          on top of this z-40 bar's right edge */}
      <div className="mx-auto flex max-w-[1180px] flex-col gap-3 px-5 py-4 pr-24 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-8 sm:pr-28">
        <p className="min-w-0 text-[14px] leading-snug text-[#0C1B33]">
          Explore vacant sites near this address
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href={vacancyHref(zip)} className={PRIMARY_LINK_CLASS}>
            View Vacant Sites →
          </Link>
          <Link href="/qualify" className={SECONDARY_LINK_CLASS}>
            Refine with the eligibility survey →
          </Link>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-20 top-3 flex h-8 w-8 items-center justify-center text-[#0C1B33]/35 transition-colors hover:bg-[#0C1B33]/5 hover:text-[#0C1B33] sm:right-24"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Secondary destinations the in-flow banner can hand off to. The full report
 * sends a reader on to neighborhood investment activity; the quick check —
 * which deliberately stops short of the program layer — sends them to the
 * eligibility survey, the same destination the sticky bar offers.
 */
const INLINE_SECONDARY = {
  investment: {
    href: "/investment",
    label: "See neighborhood investment activity",
  },
  qualify: {
    href: "/qualify",
    label: "Refine with the eligibility survey",
  },
} as const;

export type InlineCrossLinkSecondary = keyof typeof INLINE_SECONDARY;

/**
 * In-flow cross-link rendered below the report content — same idiom as the
 * sticky bar, no dismissal (it does not overlay anything).
 */
export function InlineCrossLinkBanner({
  zip,
  secondary = "investment",
}: {
  zip?: string | null;
  secondary?: InlineCrossLinkSecondary;
}) {
  const next = INLINE_SECONDARY[secondary];
  return (
    <div
      data-testid="report-cross-link-banner"
      className="mx-auto mt-8 max-w-[850px] px-2 pb-10 sm:px-6 print:hidden"
    >
      <div className="flex flex-col gap-3 border border-[#0C1B33]/10 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <Link href={vacancyHref(zip)} className={PRIMARY_LINK_CLASS}>
          View vacant sites near this address
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        <Link href={next.href} className={SECONDARY_LINK_CLASS}>
          {next.label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
