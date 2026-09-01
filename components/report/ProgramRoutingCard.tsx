"use client";

// ─── Routing-first program card (owner ruling, Billy 2026-08-31) ─────────
// The SUPPORTER lens only. A supporter is not underwriting a deal — they are
// routing a business owner to the right door — so on that lens a program card
// leads with the three things a router needs to glance at (the window, why
// this program is here, and the next step) and keeps the full blessed facts
// panel exactly ONE gesture away, expanded in place.
//
// Transparency law, kept whole:
//   - Nothing is suppressed. The disclosure below renders the COMPLETE
//     blessed panel — the same shared <ProgramCardFace /> + <ProgramCardExtras />
//     every other lens shows on the face, in the same board order — so the
//     "Verify at the source" block, its traces-to-a-public-record line, and
//     the "What to expect" line are all present and non-suppressible, just
//     one disclosure deep. (The glance row and next-step line therefore
//     appear twice on an expanded card. Deliberate: the disclosure is the
//     whole record, not a diff against the compact face — a reader who
//     opens it must never have to reassemble the card from two places.)
//   - The simplification is LABELED as a view (ProgramRoutingViewNote),
//     the same way the lens already labels its other simplifications (the
//     persona header's "Viewing as … · Switch to All", the executive
//     summary's screening disclosure, the Also disclosure's "nothing is
//     removed").
//   - ZERO new content. Every field here already exists on the ReportItem,
//     built at generation time from real catalog data. There is no "who
//     this serves" field in the catalog and none is invented: the existing
//     "Why this is shown" reason chips (item.matchExplanation.whyItAppears)
//     serve that role, which is exactly what they already say.
//
// Native <details>/<summary>, not React state, on purpose: it prints, it
// deep-links, it needs no hydration, and it adds no useState to either
// ReportDisplay fork's hook order (see the ordinal-useState maintenance
// warning in app/report/__tests__/report-page-live-renderer.test.tsx).

import { ChevronRight } from "lucide-react";
import { ProgramCardExtras } from "@/components/report/ProgramCardExtras";
import { ProgramCardFace } from "@/components/report/ProgramCardFace";
import { ReasonChips } from "@/components/report/ReasonChips";
import type { AvailabilityState } from "@/lib/program-gating";
import type { ReportItem } from "@/lib/report-engine";

const STATUS_LABEL: Record<AvailabilityState, string> = {
  active: "Active",
  "window-closed": "Window closed",
  "lapsed-notice": "Lapsed — confirm status",
  expired: "Expired",
};

/**
 * The one-line label that marks the compact rendering as a VIEW rather than
 * the record. Rendered once per supporter programs section by both
 * ReportDisplay forks.
 */
export function ProgramRoutingViewNote() {
  return (
    <p
      data-testid="program-routing-view-note"
      className="mb-4 max-w-prose text-[11.5px] leading-relaxed text-[#5A6478]"
    >
      Routing view — each program shows its window, why it is here, and the
      next step. Open <span className="text-[#0C1B33]">Full program record</span>{" "}
      on any card for the complete panel, including what to expect and the
      verify-at-the-source links. Nothing is removed.
    </p>
  );
}

export function ProgramRoutingCard({ item }: { item: ReportItem }) {
  const windowLine = item.nextWindow?.note
    || (item.nextWindow?.expected ? `Expected ${item.nextWindow.expected}` : null);
  const hasGlance = Boolean(item.administrator || item.availability || windowLine || item.decisionBy);
  const hasNextStep = Boolean(item.nextStep || item.primaryContact);

  return (
    <div className="mt-2.5 space-y-2.5" data-testid="supporter-routing-card">
      {hasGlance && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {item.administrator && (
            <span className="text-[11px] text-[#0C1B33]/50">
              Administered by {item.administrator}
            </span>
          )}
          {item.availability && (
            <span className="font-mono-bureau text-[8.5px] tracking-[0.1em] uppercase text-[#0C1B33]/45 border border-[#0C1B33]/15 px-1.5 py-0.5">
              {STATUS_LABEL[item.availability]}
            </span>
          )}
          {windowLine && (
            <span className="text-[11.5px] text-[#0C1B33]/70">
              <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 mr-1.5">
                Window
              </span>
              {windowLine}
            </span>
          )}
          {item.decisionBy && (
            <span className="text-[11.5px] text-[#0C1B33]/70">
              <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 mr-1.5">
                Decision by
              </span>
              {item.decisionBy}
            </span>
          )}
        </div>
      )}

      {/* The reason chips are the "who this serves" signal — the existing
          published match reasons, unchanged, not a new field. */}
      <ReasonChips explanation={item.matchExplanation} />

      {hasNextStep && (
        <div className="flex flex-col gap-1">
          {item.nextStep && (
            <span className="text-[11.5px] leading-relaxed text-[#0C1B33]/60">
              <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 mr-1.5">
                Next step
              </span>
              {item.nextStep}
            </span>
          )}
          {item.primaryContact && (
            <span className="text-[11px] text-[#0C1B33]/50">
              {item.primaryContact.agency}
              {item.primaryContact.phone ? ` · ${item.primaryContact.phone}` : ""}
              {item.primaryContact.email ? ` · ${item.primaryContact.email}` : ""}
            </span>
          )}
        </div>
      )}

      <details
        data-testid="supporter-routing-full-record"
        className="group/record border-t border-[#0C1B33]/8 pt-2"
      >
        <summary className="flex cursor-pointer list-none items-center gap-1.5 select-none font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-[#0C1B33]/40 hover:text-[#2563EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
          <span className="flex-shrink-0 transition-transform group-open/record:rotate-90">
            <ChevronRight aria-hidden="true" className="h-3 w-3" />
          </span>
          Full program record
        </summary>
        <ProgramCardFace item={item} />
        <ReasonChips explanation={item.matchExplanation} />
        <ProgramCardExtras item={item} />
      </details>
    </div>
  );
}
