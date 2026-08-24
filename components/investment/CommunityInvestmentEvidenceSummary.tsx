import {
  BadgeDollarSign,
  Building2,
  ChartNoAxesCombined,
  Gift,
  HandCoins,
  Info,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import type { CommunityInvestmentAnalysis } from "@/lib/investment-analysis";
import { formatAsOf, formatCompactDollars } from "./format";

type CapitalMetric = {
  label: string;
  status: string;
  value: number;
  icon: LucideIcon;
};

function displayCapitalValue(value: number) {
  return value > 0 ? formatCompactDollars(value) : "None on record";
}

function CapitalMetricCell({ label, status, value, icon: Icon }: CapitalMetric) {
  return (
    <div className="flex min-h-[150px] flex-col bg-white px-4 py-5 sm:px-5">
      <Icon aria-hidden className="h-5 w-5 text-[#2563EB]" strokeWidth={1.7} />
      <p className="mt-4 min-h-7 font-mono-bureau text-[9px] font-medium uppercase leading-[1.45] tracking-[0.11em] text-[#0C1B33]">
        {label}
      </p>
      <p className="mt-2 font-editorial text-[clamp(25px,2.25vw,35px)] leading-none text-[#2563EB] [font-variant-numeric:tabular-nums]">
        {displayCapitalValue(value)}
      </p>
      <p className="mt-2 font-mono-bureau text-[8px] uppercase tracking-[0.12em] text-[#0C1B33]/40">
        {status}
      </p>
    </div>
  );
}

/**
 * The community route's evidence-brief summary. These six values intentionally
 * remain six distinct financial instruments: awarded grants, authorized TIF,
 * federal program commitments, published state appropriations, tax-credit
 * capital, and announced private capital. They are never totaled together.
 */
export function CommunityInvestmentEvidenceSummary({
  analysis,
}: {
  analysis: CommunityInvestmentAnalysis;
}) {
  const metrics: CapitalMetric[] = [
    {
      label: "Awarded grants",
      status: "Documented commitments",
      value: analysis.totalAwarded,
      icon: Gift,
    },
    {
      label: "Authorized TIF",
      status: "Authorized ceilings",
      value: analysis.authorizedTif,
      icon: Landmark,
    },
    {
      label: "Federal program commitments",
      status: "CDBG / HOME committed",
      value: analysis.federalProgram,
      icon: Building2,
    },
    {
      label: "Published state appropriations",
      status: "Community-sited balance",
      value: analysis.publishedStateAppropriation,
      icon: BadgeDollarSign,
    },
    {
      label: "Tax-credit capital",
      status: "LIHTC / NMTC allocated",
      value: analysis.creditCapital,
      icon: HandCoins,
    },
    {
      label: "Announced private capital",
      status: "Self-reported project costs",
      value: analysis.announcedCapital,
      icon: ChartNoAxesCombined,
    },
  ];

  return (
    <section aria-labelledby="key-capital-flows" className="border border-[#0C1B33]/15 bg-white">
      <div className="px-4 pb-3 pt-4 sm:px-5">
        <h2 id="key-capital-flows" className="text-[14px] font-semibold uppercase tracking-[0.02em] text-[#0C1B33]">
          Key capital instruments
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-[#0C1B33]/55">
          Six distinct financial instruments. Coverage windows vary by source; each value keeps its own status and denominator.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px border-y border-[#0C1B33]/15 bg-[#0C1B33]/15 lg:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => (
          <CapitalMetricCell key={metric.label} {...metric} />
        ))}
      </div>

      <div className="m-3 flex items-start gap-3 border border-[#2563EB]/20 bg-[#EFF3FB]/75 px-3 py-2.5 sm:m-4">
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center border border-[#2563EB]/55 text-[#2563EB]">
          <Info aria-hidden className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
        <p className="text-[11px] leading-relaxed text-[#0C1B33]/65">
          These measures describe different financial instruments. <strong className="font-semibold text-[#0C1B33]">Do not add them together.</strong>{" "}
          Reported disbursements are citywide only. <strong className="font-semibold text-[#0C1B33]">Not shown on this page</strong> because they cannot be attributed to one community.
        </p>
      </div>

      <p className="px-4 pb-4 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40 sm:px-5">
        Source refresh varies by publisher · export generated {formatAsOf(analysis.generatedAt)}
      </p>
    </section>
  );
}
