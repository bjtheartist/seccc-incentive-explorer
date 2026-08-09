"use client";

// ─── Refine Value Panel ──────────────────────────────────────────────
// Shared by BOTH ReportDisplay forks (the local copy in app/report/page.tsx
// and components/report/ReportDisplay.tsx). The forks themselves have
// diverged and are intentionally NOT consolidated here (audit RF2 is a
// separate refactor); sharing this panel keeps the refine surface itself
// from diverging further.
//
// Product boundary: this panel explains the added prioritization and action
// planning without estimating a deal total or implying an award amount.

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import {
  BUDGET_RANGE_OPTIONS,
  TIMELINE_OPTIONS,
} from "@/lib/report-wizard-config";
import { ProjectGoalSelector } from "@/components/report/ProjectGoalSelector";
import {
  confirmedProgramsFromReport,
} from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";

export interface QuickRefineFields {
  projectGoals: string[];
  customGoal: string;
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
   * Inline refine: regenerates the report from up to three goals plus optional
   * budget and timeline context without
   * leaving this view. Only available where the report data pipeline lives
   * (the live /report flow).
   */
  onQuickRefine?: (fields: QuickRefineFields) => void;
  quickRefineBusy?: boolean;
  compact?: boolean;
}) {
  const [projectGoals, setProjectGoals] = useState<string[]>([]);
  const [customGoal, setCustomGoal] = useState("");
  const [budgetRange, setBudgetRange] = useState("");
  const [timeline, setTimeline] = useState("");
  const exposureFired = useRef(false);

  const confirmedPrograms = confirmedProgramsFromReport(report);

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
    const goalsAreComplete =
      projectGoals.length > 0 &&
      (!projectGoals.includes("other") || Boolean(customGoal.trim()));
    if (!goalsAreComplete || !onQuickRefine || quickRefineBusy) return;
    trackEvent("inline_refine_used", {
      reportType: report.reportType,
      address: report.metadata?.address ?? null,
      metadata: {
        context,
        projectType: projectGoals[0],
        projectGoals,
        budgetRange: budgetRange || null,
        timeline: timeline || null,
        matchedPrograms: confirmedPrograms.length,
      },
    });
    onQuickRefine({ projectGoals, customGoal: customGoal.trim(), budgetRange, timeline });
  };

  // ── Compact strip (compare cards) ─────────────────────────────────
  if (compact) {
    return (
      <div className="refine-value-panel px-4 py-3 border-b border-[#2563EB]/15 bg-[#2563EB]/[0.035] print:hidden flex items-center justify-between gap-3">
        <p className="text-[11px] leading-snug text-[#0C1B33]/55">
          Location-only snapshot. Refining adds goal-based organization and next
          steps.
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
        address — before your project is factored in. Refining first uses your
        selected goals, then adds budget and timeline context when available.
      </p>

      {/* What refining unlocks. */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-px bg-[#0C1B33]/10 border border-[#0C1B33]/10 max-w-3xl">
        <div className="bg-white px-4 py-3">
          <div className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/40 mb-1">
            Goal-Based Organization
          </div>
          <p className="text-[12px] leading-relaxed text-[#0C1B33]/60">
            Programs tied to the address are reorganized around the outcome
            you want to pursue, across as many as three goals.
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
        Published program benefit ranges are shown as source facts. This report
        does not add them up, predict an award, or guarantee eligibility.
      </p>

      {onQuickRefine ? (
        <div className="mt-5 border-t border-[#0C1B33]/10 pt-4 max-w-3xl">
          <div className="font-mono-bureau text-[9px] tracking-[0.28em] uppercase text-[#0C1B33]/40 mb-3">
            Quick Refine — Start With Your Project Goals
          </div>
          <ProjectGoalSelector
            goals={projectGoals}
            customGoal={customGoal}
            onChange={(goals, custom) => {
              setProjectGoals(goals);
              setCustomGoal(custom);
            }}
            required
            compact
          />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-1">
                Project Budget (Optional)
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
            <label>
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
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              onClick={handleQuickRefine}
              disabled={
                projectGoals.length === 0 ||
                (projectGoals.includes("other") && !customGoal.trim()) ||
                quickRefineBusy
              }
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
                Add full project details instead — 3 short screens, at least
                one goal required →
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
              3 short screens — industry, project details, documents. At least
              one goal required.
            </p>
          </div>
        )
      )}
    </div>
  );
}
