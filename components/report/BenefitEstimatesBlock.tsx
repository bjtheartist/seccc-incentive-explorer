"use client";

// ─── Benefit Estimates Block ─────────────────────────────────────────
// Renders the report engine's benefitEstimates — computed by the refined
// path since the engine shipped, but never surfaced in either ReportDisplay
// fork (audit RF6: "the value is asserted only in one banner sentence").
// Shared by both forks so the surface cannot silently diverge (audit RF2).
//
// Product boundary: planning estimates only — never an eligibility
// determination or award amount.

import { optionLabel, BUDGET_RANGE_OPTIONS } from "@/lib/report-wizard-config";
import type { GeneratedReport } from "@/lib/report-engine";

export function BenefitEstimatesBlock({
  estimates,
}: {
  estimates: NonNullable<GeneratedReport["benefitEstimates"]>;
}) {
  if (!estimates.items.length) return null;

  return (
    <div className="benefit-estimates mb-14 border border-[#0C1B33]/10">
      <div className="px-5 py-4 bg-[#0C1B33] flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div>
          <div className="font-mono-bureau text-[9px] tracking-[0.28em] uppercase text-white/50 mb-1">
            Estimated Incentive Value
          </div>
          <p className="text-[12px] text-white/50">
            Planning-level estimates at a{" "}
            {optionLabel(BUDGET_RANGE_OPTIONS, estimates.budgetRange)} budget —
            to verify with each administrator, not award amounts.
          </p>
        </div>
        <div className="font-editorial text-3xl text-white">
          ~{estimates.totalFormatted}
        </div>
      </div>
      <div className="divide-y divide-[#0C1B33]/8 bg-white">
        {estimates.items.map((item) => (
          <div
            key={item.programId}
            className="px-5 py-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1"
          >
            <div className="min-w-0">
              <div className="text-[13px] text-[#0C1B33]">{item.programName}</div>
              <div className="font-mono-bureau text-[9px] tracking-[0.12em] uppercase text-[#0C1B33]/35 mt-0.5">
                {item.label}
              </div>
            </div>
            <div className="font-mono-bureau text-[12px] text-[#0C1B33]/70">
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              }).format(item.estimatedValue)}
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 py-2.5 bg-[#FAF9F6] border-t border-[#0C1B33]/8">
        <p className="font-mono-bureau text-[8px] tracking-[0.15em] uppercase text-[#0C1B33]/35">
          Estimates use published program percentages against your stated
          budget range. Eligibility, caps, and awards are set by each program
          administrator.
        </p>
      </div>
    </div>
  );
}
