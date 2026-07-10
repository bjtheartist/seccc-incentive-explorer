"use client";

// ─── Refine Value Panel ──────────────────────────────────────────────
// Shared by BOTH ReportDisplay forks (the local copy in app/report/page.tsx
// and components/report/ReportDisplay.tsx). The forks themselves have
// diverged and are intentionally NOT consolidated here (audit RF2 is a
// separate refactor); sharing this panel keeps the refine surface itself
// from diverging further.
//
// Product boundary: this panel previews planning-level estimates the report
// engine already computes. All value language stays "may apply / estimate /
// verify with administrators" — never an eligibility determination.

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import {
  BUDGET_RANGE_OPTIONS,
  TIMELINE_OPTIONS,
  optionLabel,
} from "@/lib/report-wizard-config";
import {
  confirmedProgramsFromReport,
  estimateProgramsValue,
  programValueTeaser,
} from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";

export interface QuickRefineFields {
  budgetRange: string;
  timeline: string;
}

export type RefinePanelContext =
  | "instant"
  | "workspace"
  | "compare_a"
  | "compare_b";

export function RefineValuePanel({
  report,
  context,
  onRefine,
  onQuickRefine,
  quickRefineBusy,
  compact,
}: {
  report: GeneratedReport;
  /** Where this panel renders — analytics attribution only. */
  context: RefinePanelContext;
  /** Full refine path: opens the optional project-details screens. */
  onRefine?: () => void;
  /**
   * Inline refine: regenerates the report from two quick answers without
   * leaving this view. Only available where the report data pipeline lives
   * (the live /report flow).
   */
  onQuickRefine?: (fields: QuickRefineFields) => void;
  quickRefineBusy?: boolean;
  compact?: boolean;
}) {
  const [budgetRange, setBudgetRange] = useState("");
  const [timeline, setTimeline] = useState("");
  const exposureFired = useRef(false);

  const confirmedPrograms = confirmedProgramsFromReport(report);
  const teaserProgram = confirmedPrograms
    .map((p) => ({ ...p, teaser: programValueTeaser(p.id) }))
    .find((p) => p.teaser);
  const estimate = budgetRange
    ? estimateProgramsValue(confirmedPrograms, budgetRange)
    : null;

  useEffect(() => {
    if (exposureFired.current) return;
    exposureFired.current = true;
    trackEvent("refine_value_preview_shown", {
      reportType: report.reportType,
      address: report.metadata?.address ?? null,
      metadata: {
        context,
        matchedPrograms: confirmedPrograms.length,
        quickRefineAvailable: Boolean(onQuickRefine),
      },
    });
    // Exposure fires once per panel mount, by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuickRefine = () => {
    if (!budgetRange || !onQuickRefine || quickRefineBusy) return;
    trackEvent("inline_refine_used", {
      reportType: report.reportType,
      address: report.metadata?.address ?? null,
      metadata: {
        context,
        budgetRange,
        timeline: timeline || null,
        matchedPrograms: confirmedPrograms.length,
      },
    });
    onQuickRefine({ budgetRange, timeline });
  };

  // ── Compact strip (compare cards) ─────────────────────────────────
  if (compact) {
    return (
      <div className="refine-value-panel px-4 py-3 border-b border-[#2563EB]/15 bg-[#2563EB]/[0.035] print:hidden flex items-center justify-between gap-3">
        <p className="text-[11px] leading-snug text-[#0C1B33]/55">
          Location-only snapshot. Refining adds planning-level dollar
          estimates and next steps.
        </p>
        {onRefine && (
          <button
            onClick={onRefine}
            className="shrink-0 inline-flex items-center gap-1.5 border border-[#2563EB]/40 text-[#2563EB] font-mono-bureau text-[9px] tracking-[0.15em] uppercase px-3 py-2 hover:bg-[#2563EB]/5 transition-colors cursor-pointer"
          >
            Refine
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  // ── Full panel ────────────────────────────────────────────────────
  return (
    <div className="refine-value-panel px-5 sm:px-12 md:px-16 py-6 border-b border-[#2563EB]/15 bg-[#2563EB]/[0.035] print:hidden">
      <div className="font-mono-bureau text-[9px] tracking-[0.28em] uppercase text-[#2563EB]/70 mb-1.5">
        Location-Only Snapshot
      </div>
      <p className="text-[13px] leading-relaxed text-[#0C1B33]/60 max-w-2xl">
        This shows the zones, parcel context, and programs that may touch this
        address — before your project is factored in. Refining tailors it to
        your budget, timeline, and goals.
      </p>

      {/* What refining unlocks — the engine already computes all three. */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-px bg-[#0C1B33]/10 border border-[#0C1B33]/10 max-w-3xl">
        <div className="bg-white px-4 py-3">
          <div className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/40 mb-1">
            Dollar Estimates
          </div>
          <p className="text-[12px] leading-relaxed text-[#0C1B33]/60">
            Planning-level value ranges for each matched program
            {teaserProgram
              ? ` — e.g. ${teaserProgram.name}: ${teaserProgram.teaser}`
              : ""}
            .
          </p>
        </div>
        <div className="bg-white px-4 py-3">
          <div className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/40 mb-1">
            Week-One Action Plan
          </div>
          <p className="text-[12px] leading-relaxed text-[#0C1B33]/60">
            Phase-by-phase next steps with named contacts and call scripts.
          </p>
        </div>
        <div className="bg-white px-4 py-3">
          <div className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/40 mb-1">
            Document Gap Checklist
          </div>
          <p className="text-[12px] leading-relaxed text-[#0C1B33]/60">
            What each program typically requests, next to what you already
            have.
          </p>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/40 max-w-3xl">
        Figures are planning estimates, not eligibility determinations — every
        program requires verification with its administrator.
      </p>

      {onQuickRefine ? (
        <div className="mt-5 border-t border-[#0C1B33]/10 pt-4 max-w-3xl">
          <div className="font-mono-bureau text-[9px] tracking-[0.28em] uppercase text-[#0C1B33]/40 mb-3">
            Quick Refine — Two Answers, No Extra Screens
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <label className="flex-1">
              <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-1">
                Project Budget
              </span>
              <select
                value={budgetRange}
                onChange={(e) => setBudgetRange(e.target.value)}
                className="w-full bg-white border border-[#0C1B33]/15 px-3 py-2.5 text-[13px] text-[#0C1B33] focus:outline-none focus:border-[#2563EB]/50 cursor-pointer"
              >
                <option value="">Select a range…</option>
                {BUDGET_RANGE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex-1">
              <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-1">
                Timeline (Optional)
              </span>
              <select
                value={timeline}
                onChange={(e) => setTimeline(e.target.value)}
                className="w-full bg-white border border-[#0C1B33]/15 px-3 py-2.5 text-[13px] text-[#0C1B33] focus:outline-none focus:border-[#2563EB]/50 cursor-pointer"
              >
                <option value="">Select a timeline…</option>
                {TIMELINE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {estimate && (
            <p className="mt-3 text-[13px] leading-relaxed text-[#0C1B33]/70">
              With a {optionLabel(BUDGET_RANGE_OPTIONS, budgetRange)} budget,
              refined estimates across {estimate.items.length} matched program
              {estimate.items.length === 1 ? "" : "s"} total{" "}
              <span className="font-semibold text-[#0C1B33]">
                ~{estimate.totalFormatted}
              </span>{" "}
              — an estimate to verify with each administrator, not an award.
            </p>
          )}
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              onClick={handleQuickRefine}
              disabled={!budgetRange || quickRefineBusy}
              className="inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-5 py-3 hover:bg-[#1d4ed8] transition-colors cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-default"
            >
              {quickRefineBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5" />
              )}
              {quickRefineBusy ? "Refining…" : "Generate Refined Report"}
            </button>
            {onRefine && (
              <button
                onClick={onRefine}
                className="font-mono-bureau text-[10px] tracking-[0.12em] uppercase text-[#2563EB] hover:text-[#1d4ed8] transition-colors cursor-pointer text-left"
              >
                Add full project details instead — 3 short screens, all
                optional →
              </button>
            )}
          </div>
        </div>
      ) : (
        onRefine && (
          <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              onClick={onRefine}
              className="inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-5 py-3 hover:bg-[#1d4ed8] transition-colors cursor-pointer shadow-sm"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              Refine with Project Details
            </button>
            <p className="font-mono-bureau text-[9px] tracking-[0.12em] uppercase text-[#0C1B33]/35">
              3 short screens — industry, project details, documents. All
              optional.
            </p>
          </div>
        )
      )}
    </div>
  );
}
