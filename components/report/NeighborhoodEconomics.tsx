"use client";

// ─── Neighborhood Economics ──────────────────────────────────────────
// Shared by BOTH ReportDisplay forks (the local copy in app/report/page.tsx
// and components/report/ReportDisplay.tsx). The forks themselves have
// diverged and are intentionally NOT consolidated here (audit RF2 is a
// separate refactor); sharing this section keeps the economic-context
// rendering from diverging further.
//
// Product boundary: every signal carries a provenance tag (measured public
// record / benchmark / modeled) and the modeled figures stay clearly labeled
// as estimates — nothing here implies available funding or an award amount.

import type {
  NeighborhoodEconomicContext,
  ReportItem,
  ReportSection,
} from "@/lib/report-engine";
import { SECTION_IDS } from "@/lib/report-engine";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

export function ComparisonBar({ label, locationFormatted, cityFormatted, pct }: {
  label: string;
  locationFormatted: string;
  cityFormatted: string;
  pct: number;
}) {
  const barWidth = Math.min(pct, 200); // cap visual at 200%
  const cityBarWidth = 100; // city is always the baseline
  return (
    <div className="py-4 first:pt-0">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[#0C1B33] text-[13px] font-semibold">{label}</span>
        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/40">{pct}% of city median</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <span className="font-mono-bureau text-[9px] tracking-[0.1em] text-[#0C1B33]/35 w-14 text-right flex-shrink-0">Location</span>
          <div className="flex-1 bg-[#0C1B33]/[0.04] h-5 relative">
            <div className="h-full bg-[#0C1B33]/15 transition-all" style={{ width: `${Math.min(barWidth, 100)}%` }} />
          </div>
          <span className="font-mono-bureau text-[11px] text-[#0C1B33]/70 w-20 flex-shrink-0">{locationFormatted}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono-bureau text-[9px] tracking-[0.1em] text-[#0C1B33]/25 w-14 text-right flex-shrink-0">City</span>
          <div className="flex-1 bg-[#0C1B33]/[0.04] h-5 relative">
            <div className="h-full bg-[#0C1B33]/[0.06] transition-all" style={{ width: `${cityBarWidth}%` }} />
          </div>
          <span className="font-mono-bureau text-[11px] text-[#0C1B33]/40 w-20 flex-shrink-0">{cityFormatted}</span>
        </div>
      </div>
    </div>
  );
}

// ── Neighborhood economic signal cards ──────────────────────────────
export function econMoney(n?: number | null): string | null {
  if (n == null) return null;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
export function econPct(r?: number | null, signed = true): string | null {
  if (r == null) return null;
  const v = Math.round(r * 100);
  return `${signed && v >= 0 ? "+" : ""}${v}%`;
}

// Provenance labels used across every signal. The two modeled variants share
// the same amber treatment; the ACS-income variant names its source inline.
const TAG_PUBLIC = "Measured public record";
const TAG_BENCHMARK = "Benchmark";
const TAG_MODELED = "Modeled / needs verification";
const TAG_MODELED_ACS = "Modeled from ACS income";

const ECON_TAG_STYLE: Record<string, string> = {
  [TAG_PUBLIC]: "bg-[#0C1B33]/[0.08] text-[#0C1B33]/70",
  [TAG_BENCHMARK]: "bg-[#0C1B33]/[0.05] text-[#0C1B33]/55",
  [TAG_MODELED]: "bg-amber-500/10 text-amber-700",
  [TAG_MODELED_ACS]: "bg-amber-500/10 text-amber-700",
};

export function EconomicSignalCards({ economics }: { economics: NeighborhoodEconomicContext }) {
  const cards: { tag: string; label: string; value: string; sub: string; tip: string; formula?: string }[] = [];
  const bc = economics.businessContinuity;
  if (bc?.continuityRate != null) {
    cards.push({
      tag: TAG_PUBLIC,
      label: "Business Continuity",
      value: econPct(bc.continuityRate, false)!,
      sub: `license retention${bc.baselineYear && bc.comparisonYear ? ` · ${bc.baselineYear}–${bc.comparisonYear}` : ""}`,
      tip: "Share of active business-license holders from the baseline year still active in the comparison year (Chicago business-license records). A neighborhood retention signal — not proof any one business closed, moved, or stayed.",
    });
  }
  const jp = economics.jobsPayroll;
  if (jp && (jp.payrollGrowthRate != null || jp.employmentGrowthRate != null)) {
    cards.push({
      tag: TAG_BENCHMARK,
      label: "Jobs & Payroll",
      value: jp.payrollGrowthRate != null ? `${econPct(jp.payrollGrowthRate)} payroll` : `${econPct(jp.employmentGrowthRate)} jobs`,
      sub: `${econPct(jp.employmentGrowthRate) ?? "—"} jobs${jp.baselineYear && jp.comparisonYear ? ` · ${jp.baselineYear}–${jp.comparisonYear}` : ""}`,
      tip: "Establishments, employment, and annual payroll for this ZIP from Census ZIP Business Patterns. It's the latest official benchmark (reference years shown), not a current-year reading.",
    });
  }
  const ri = economics.reinvestment;
  if (ri && (ri.reportedCost != null || ri.permitCount != null)) {
    cards.push({
      tag: TAG_PUBLIC,
      label: "Reinvestment",
      value: econMoney(ri.reportedCost) ?? `${ri.permitCount?.toLocaleString()}`,
      sub: `${ri.permitCount?.toLocaleString() ?? "—"} permits${ri.windowLabel ? ` · ${ri.windowLabel.replace("the trailing ", "")}` : ""}`,
      tip: "Building permits filed in this ZIP over the trailing window, with applicant-reported project cost (City of Chicago Building Permits). Reported cost is directional — it omits unpermitted work and isn't audited.",
    });
  }
  const pr = economics.property;
  if (pr) {
    cards.push({
      tag: TAG_PUBLIC,
      label: "Property / Value Change",
      value: pr.assessedValueChangeRate != null ? `${econPct(pr.assessedValueChangeRate)} assessed` : pr.parcelCount != null ? pr.parcelCount.toLocaleString() : "—",
      sub: pr.assessedValueChangeRate != null ? "assessed-value change (public record)" : "parcels (ZIP)",
      tip: "Cook County assessed-value records show how the public property assessment changed between the two years — not sale price, private market value, or owner equity. Large changes may reflect reassessment cycles, appeals, property improvements, class changes, or updated assessor methodology. Public records only; no owner names or addresses are shown.",
    });
  }
  const tf = economics.tifFinance;
  if (tf) {
    cards.push({
      tag: TAG_PUBLIC,
      label: "TIF Funding",
      value: econMoney(tf.fundBalance) ?? "Matched",
      sub: `${tf.districtName ?? tf.districtId ?? "TIF district"}${tf.reportYear ? ` · ${tf.reportYear}` : ""}`,
      tip: "Latest reported district-level TIF annual report context from the City of Chicago. This is not available funding, project approval, or money reserved for a property or business.",
    });
  }
  // Leakage: we can defensibly estimate locally-servable resident DEMAND, but a
  // true capture/leakage RATE needs retail-category sales we don't yet have — so
  // we show the demand figure, not a misleading capture percentage.
  const lk = economics.leakage;
  if (lk?.capturableDemand != null) {
    cards.push({
      tag: TAG_MODELED_ACS,
      label: "Resident Spending Power",
      value: `${econMoney(lk.capturableDemand)}/yr`,
      sub: "Estimated local retail, food, and service demand",
      formula: "= households × median income × 32%",
      tip: "Formula: households × median household income (ACS 5-year, ZIP level) × 32% — the share of resident income typically spent on locally-servable retail, food, and personal services. This sizes the local customer base; actual capture isn't measured. Calculating true leakage would need retail-category sales, card-spend, or partner-verified business revenue data.",
    });
  }
  const mp = economics.multiplier;
  if (mp?.localOutputEstimateLow != null && mp.localOutputEstimateHigh != null) {
    cards.push({
      tag: TAG_MODELED,
      label: "Local Multiplier",
      value: `${econMoney(mp.localOutputEstimateLow)}–${econMoney(mp.localOutputEstimateHigh)}`,
      sub: "modeled local output",
      tip: "Scenario estimate of local economic output supported by neighborhood businesses, applying a 1.4–1.8× multiplier to measured ZIP payroll. A planning tool — not a guaranteed jobs, sales, or tax-revenue forecast.",
    });
  }
  if (cards.length === 0) return null;

  // Cap the grid at 6 tiles for a clean 2×3 layout. Cards are built in priority
  // order (measured public record first, modeled/unverified last), so slicing
  // drops the lowest-priority signal — Local Multiplier when all are present —
  // while still filling to 6 if an earlier measured card is missing.
  const visibleCards = cards.slice(0, 6);

  return (
    <TooltipProvider delayDuration={120}>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-px bg-[#0C1B33]/8 border border-[#0C1B33]/8 mb-6">
        {visibleCards.map((c) => (
          <Tooltip key={c.label}>
            <TooltipTrigger asChild>
              <div className="bg-white p-3.5 flex flex-col gap-1 cursor-help focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0C1B33]/30" tabIndex={0}>
                <span className="font-mono-bureau text-[8px] tracking-[0.18em] uppercase text-[#0C1B33]/40">{c.label}</span>
                <span className="text-[#0C1B33] text-[20px] font-semibold leading-tight tabular-nums">{c.value}</span>
                <span className="text-[#0C1B33]/45 text-[10px] leading-snug">{c.sub}</span>
                {c.formula && (
                  <span className="font-mono-bureau text-[9px] tracking-[0.02em] text-[#0C1B33]/35 leading-snug mt-0.5">{c.formula}</span>
                )}
                <span className={`font-mono-bureau text-[7px] tracking-[0.12em] uppercase px-1.5 py-0.5 mt-1.5 self-start ${ECON_TAG_STYLE[c.tag] ?? ""}`}>{c.tag}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-[11px] leading-relaxed">
              {c.tip}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

export function AnchorCards({ anchors }: { anchors: NonNullable<NeighborhoodEconomicContext["anchors"]> }) {
  if (!anchors || anchors.length === 0) return null;
  return (
    <div className="mb-6">
      <div className="space-y-2">
        {anchors.map((a) => (
          <div key={a.name} className="border border-[#0C1B33]/8 p-3">
            <div className="min-w-0">
              <div className="text-[#0C1B33] text-[13px] font-semibold leading-tight">{a.name}</div>
              {a.type && <div className="text-[#0C1B33]/45 text-[10px] mt-0.5">{a.type}</div>}
            </div>
            {a.rationale && <p className="text-[#0C1B33]/55 text-[11px] leading-relaxed mt-2">{a.rationale}</p>}
            {a.multiplierChannels && (
              <div className="mt-3 border-t border-[#0C1B33]/6 pt-2">
                <div className="font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#0C1B33]/30">
                  What it may support
                </div>
                <p className="text-[#0C1B33]/45 text-[11px] leading-relaxed mt-1">
                  {a.multiplierChannels}
                </p>
              </div>
            )}
            {a.sourceUrls && a.sourceUrls.length > 0 && (
              <a href={a.sourceUrls[0]} target="_blank" rel="noopener noreferrer" className="inline-block font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-[#0C1B33]/40 hover:text-[#0C1B33]/70 mt-2">Source ↗</a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Signals rendered as comparison bars (ACS) or stat cards above — hidden from
// the flat row list so the economic section reads cleanly.
const ECON_CARD_LABELS = new Set([
  "Median Household Income",
  "Home Value Context",
  "Population Base",
  "Access & Walkability",
  "Business Continuity",
  "Jobs & Payroll",
  "Reinvestment Signals",
  "Property Ownership / Value Change",
  "Leakage Signals",
  "Local Retail Demand",
  "Multiplier Potential",
  "Resident Spending-Power Proxy",
]);

// Matches by stable id first, title as fallback for version-less saved
// reports — same contract as sectionMatchesIdOrTitle in both forks (#156).
function matchesIdOrTitle(section: ReportSection, id: string, title: string): boolean {
  return section.id ? section.id === id : section.title === title;
}

export function visibleSectionItems(section: ReportSection): ReportItem[] {
  const items = section.items ?? [];
  if (matchesIdOrTitle(section, SECTION_IDS.localImpactAnchors, "Local Impact Anchors")) return []; // rendered as cards
  if (matchesIdOrTitle(section, SECTION_IDS.neighborhoodEconomicContext, "Neighborhood Economic Context")) {
    return items.filter((i) => !ECON_CARD_LABELS.has(i.label));
  }
  return items;
}
