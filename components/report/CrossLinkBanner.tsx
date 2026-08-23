"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Cross-link funnel banner (WP2). A white Warm Bureau card on a hairline
 * navy border that hands a visitor who just resolved a full-report address
 * on to neighborhood investment activity. Print-hidden — it is navigation,
 * not report content.
 *
 * This used to have a sibling `StickyCrossLinkBanner` (a bottom-pinned,
 * dismissible bar) and a `qualify` secondary option, both of which only
 * ever pointed at the sunset /qualify and /vacancy report cross-links
 * (owner's ruling: the product boundary is discovery, not compliance —
 * those hand-offs were removed outright, not re-pointed). The sticky
 * variant's only content was the vacant-sites hand-off, so it was deleted
 * entirely along with its mount points and caller-owned dismissal/bottom-
 * padding logic (app/report/page.tsx) and its sole /check mount
 * (components/check/QuickCheckClient.tsx, which had no investment-activity
 * hand-off to fall back to).
 */

const SECONDARY_LINK_CLASS =
  "inline-flex min-h-11 items-center gap-1.5 font-mono-bureau text-[10px] tracking-[0.1em] uppercase text-[#0C1B33]/70 underline-offset-4 transition-colors hover:text-[#0C1B33] hover:underline";

/**
 * In-flow cross-link rendered below the report content. No longer takes a
 * `zip` prop — that only ever fed the now-removed vacant-sites link
 * (vacancyHref), and the investment-activity link it hands off to is
 * ZIP-independent.
 */
export function InlineCrossLinkBanner() {
  return (
    <div
      data-testid="report-cross-link-banner"
      className="mx-auto mt-8 max-w-[850px] px-2 pb-10 sm:px-6 print:hidden"
    >
      <div className="flex flex-col gap-3 border border-[#0C1B33]/10 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <Link href="/investment" className={SECONDARY_LINK_CLASS}>
          See neighborhood investment activity
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
