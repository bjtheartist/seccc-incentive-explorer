"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { normalizePin14 } from "@/lib/cook-viewer";

/**
 * Cross-link funnel banner (WP2). A white Warm Bureau card on a hairline
 * navy border that hands a visitor who just resolved a full-report address
 * on to parcel-level permit activity analysis. Print-hidden — it is
 * navigation, not report content.
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
 *
 * review9 gate finding F5: the deleted vacancy link owned the blue PRIMARY
 * treatment; the remaining link, left on the 10px secondary micro-link
 * treatment, read as an unfinished afterthought alone in an 850px bordered
 * card. This is the card's only action, so it gets the primary
 * treatment (the same `bg-[#2563EB]` CTA idiom used throughout this report
 * surface — see components/check/QuickCheckClient.tsx's "Generate Full
 * Report" CTA and components/report/StartHereCard.tsx), and the card's
 * layout is a single centered action rather than the two-item
 * `justify-between` row it was built for.
 */

const PRIMARY_LINK_CLASS =
  "inline-flex min-h-11 items-center justify-center gap-2 bg-[#2563EB] px-6 py-3 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-white transition-colors hover:bg-[#1D4ED8]";

/**
 * In-flow cross-link rendered below the report content. A verified Cook
 * County PIN carries the same parcel into permit activity analysis. If the
 * parcel lookup did not resolve, the permit-analysis entry screen lets the
 * visitor identify the site without sending them to a neighborhood picker.
 */
export function InlineCrossLinkBanner({ pin }: { pin?: string | null }) {
  const pin14 = normalizePin14(pin);
  const href = pin14
    ? `/permit-exhibit/${encodeURIComponent(pin14)}`
    : "/permit-exhibit";

  return (
    <div
      data-testid="report-cross-link-banner"
      className="mx-auto mt-8 max-w-[850px] px-2 pb-10 sm:px-6 print:hidden"
    >
      <div className="flex items-center justify-center border border-[#0C1B33]/10 bg-white px-5 py-6 text-center sm:px-6">
        <Link href={href} className={PRIMARY_LINK_CLASS}>
          Run permit activity analysis
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
