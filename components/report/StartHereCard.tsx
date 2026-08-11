"use client";

// ─── Start Here Card ──────────────────────────────────────────────────
// Shared by BOTH ReportDisplay forks (the local copy in app/report/page.tsx
// and components/report/ReportDisplay.tsx). The forks themselves have
// diverged and are intentionally NOT consolidated here (audit RF2 is a
// separate refactor); sharing this card keeps the "start here" surface
// itself from diverging further.
//
// This renders lib/start-here.ts's `report.startHere` model verbatim — one
// conclusion line, ONE visually dominant primary action, up to two visually
// subordinate secondary actions, unresolved questions, and sourced evidence.
// It never re-derives or re-ranks that model (see lib/start-here.ts's module
// comment for why three competing legacy structures were consolidated into
// this single ranking) and it renders nothing when `report.startHere` is
// absent — every report saved before this field existed, and every report
// type outside the executive-summary gate, falls through to the unchanged
// legacy layout.
//
// Product boundary / copy discipline: this card names ONE low-regret next
// step. Its copy must never use "allowed/permitted/prohibited/eligible/
// qualifies" as an affirmative claim, never imply the primary action is a
// legal requirement, and never imply completing it confers a status. The
// block is labeled "Start here", not "Next steps required" — it is a
// suggestion, not a gate.

import { useEffect, useRef } from "react";
import { Phone, Mail, ExternalLink, type LucideIcon } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import type { GeneratedReport } from "@/lib/report-engine";
import type { StartHereAction } from "@/lib/start-here";

function reportKey(report: GeneratedReport): string {
  return [report.reportType, report.generatedAt, report.metadata?.address || report.title].join(
    "|",
  );
}

interface TapTarget {
  href: string;
  label: string;
  icon: LucideIcon;
  kind: "tel" | "mailto" | "link";
}

/**
 * A real tap target for an action, when one exists — phone first (the
 * lowest-regret contact method, matching buildStartHere's own call-first
 * candidate ordering), then a published URL, then email. Returns null for
 * actions with no contact/officialUrl (e.g. the generic "gather information"
 * fallback), which render as plain text instead of a link.
 */
function tapTargetFor(action: StartHereAction): TapTarget | null {
  if (action.contact?.phone) {
    return { href: `tel:${action.contact.phone}`, label: action.contact.phone, icon: Phone, kind: "tel" };
  }
  const url = action.officialUrl || action.contact?.url;
  if (url) {
    return { href: url, label: "Open official source", icon: ExternalLink, kind: "link" };
  }
  if (action.contact?.email) {
    return { href: `mailto:${action.contact.email}`, label: action.contact.email, icon: Mail, kind: "mailto" };
  }
  return null;
}

export function StartHereCard({
  report,
  source,
}: {
  report: GeneratedReport;
  /** Where this card renders — analytics attribution only. */
  source: string;
}) {
  const startHere = report.startHere;
  const shownKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!startHere) return;
    const key = `${reportKey(report)}|${source}`;
    if (shownKeyRef.current === key) return;
    shownKeyRef.current = key;
    trackEvent("start_here_card_shown", {
      reportType: report.reportType,
      source,
      address: report.metadata?.address ?? null,
      lat: report.metadata?.lat ?? null,
      lon: report.metadata?.lon ?? null,
      metadata: {
        reportKey: reportKey(report),
        actionKind: startHere.primary.kind,
        primaryProgramId: startHere.primary.programId ?? null,
        secondaryCount: startHere.secondary.length,
        unresolvedQuestionCount: startHere.unresolvedQuestions.length,
        evidenceCount: startHere.evidence.length,
      },
    });
    // Exposure fires once per report+source, by design — matches
    // RefineValuePanel/CapitalPartnerHandoff's ref-guarded shown events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startHere, report, source]);

  if (!startHere) return null;

  const primaryTarget = tapTargetFor(startHere.primary);
  const PrimaryIcon = primaryTarget?.icon;

  const handlePrimaryClick = () => {
    trackEvent("start_here_primary_action_clicked", {
      reportType: report.reportType,
      source,
      address: report.metadata?.address ?? null,
      lat: report.metadata?.lat ?? null,
      lon: report.metadata?.lon ?? null,
      metadata: {
        reportKey: reportKey(report),
        actionKind: startHere.primary.kind,
        primaryProgramId: startHere.primary.programId ?? null,
        tapTargetKind: primaryTarget?.kind ?? null,
      },
    });
  };

  return (
    <div id="start-here" className="start-here-card mb-12 border border-[#0C1B33]/12 bg-[#FAF9F6]">
      <div className="px-5 sm:px-8 py-6 sm:py-7">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-2 h-2 rounded-full bg-[#2563EB]" />
          <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/40">
            Start here
          </span>
        </div>

        {/* One conclusion line. */}
        <p className="text-[#0C1B33]/55 text-[13px] leading-relaxed mb-5 max-w-prose">
          {startHere.primary.kind === "confirm-zoning-use"
            ? "An open zoning or use question comes before any financing step."
            : "One step is worth taking first — everything below explains why."}
        </p>

        {/* Primary action — the single visually dominant control. */}
        <div className="border border-[#0C1B33]/10 bg-white p-5">
          <h3 className="font-editorial text-[18px] sm:text-[20px] text-[#0C1B33] leading-snug mb-1.5">
            {startHere.primary.label}
          </h3>
          <p className="text-[#0C1B33]/50 text-[13px] leading-relaxed mb-4 max-w-prose">
            {startHere.primary.description}
          </p>
          {primaryTarget && PrimaryIcon ? (
            <a
              href={primaryTarget.href}
              onClick={handlePrimaryClick}
              className="inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-5 py-3 hover:bg-[#1d4ed8] transition-colors cursor-pointer shadow-sm"
            >
              <PrimaryIcon className="w-3.5 h-3.5" />
              {primaryTarget.label}
            </a>
          ) : (
            <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/35">
              No published contact on file — a local support organization can help with this step.
            </span>
          )}
        </div>

        {/* Secondary actions — visually subordinate, never a second dominant control. */}
        {startHere.secondary.length > 0 && (
          <ul className="mt-4 divide-y divide-[#0C1B33]/6">
            {startHere.secondary.map((action, i) => {
              const target = tapTargetFor(action);
              const SecondaryIcon = target?.icon;
              return (
                <li key={i} className="py-2.5 first:pt-0 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[12.5px] text-[#0C1B33]/65 font-medium block">
                      {action.label}
                    </span>
                    <span className="text-[11px] text-[#0C1B33]/40 block mt-0.5">
                      {action.description}
                    </span>
                  </div>
                  {target && SecondaryIcon && (
                    <a
                      href={target.href}
                      className="inline-flex items-center gap-1 text-[10px] font-mono-bureau text-[#0C1B33]/40 hover:text-[#0C1B33] transition-colors flex-shrink-0"
                    >
                      <SecondaryIcon className="w-3 h-3" />
                      {target.kind === "link" ? "Open" : target.label}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Open questions — the discovery-only boundary lives here. */}
        {startHere.unresolvedQuestions.length > 0 && (
          <div className="mt-5 pt-4 border-t border-[#0C1B33]/8">
            <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-2">
              Open questions
            </span>
            <ul className="space-y-1.5">
              {startHere.unresolvedQuestions.map((question, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-[#0C1B33]/55">
                  <span className="text-[#0C1B33]/25 flex-shrink-0">?</span>
                  <span>{question}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Evidence — each fact attributed to its source. */}
        {startHere.evidence.length > 0 && (
          <div className="mt-5 pt-4 border-t border-[#0C1B33]/8">
            <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-2">
              What we know
            </span>
            <ul className="space-y-2">
              {startHere.evidence.map((item, i) => (
                <li key={i} className="text-[12px] leading-relaxed text-[#0C1B33]/55">
                  <span>{item.fact}</span>
                  <span className="block text-[10px] text-[#0C1B33]/35 mt-0.5">{item.sourceLabel}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
