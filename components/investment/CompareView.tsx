import Link from "next/link";
import type { CommunityInvestmentAnalysis } from "@/lib/investment-analysis";
import { FUNDER_TYPE_COLORS, FUNDER_TYPE_LABELS } from "@/lib/community-investment-layer";
import { Sparkline } from "./Sparkline";
import { formatCompactDollars, formatCount, formatFullDollars, formatPercent } from "./format";

/**
 * Side-by-side compare of 2–4 pinned community areas (Sol #3): documented awarded
 * dollars, record count, median award, announced capital, program mix, top
 * funders, and a year-trend sparkline — the working-session view a corridor
 * manager or funder uses to spot white space.
 *
 * PER-RESIDENT IS DELIBERATELY WITHHELD. The dollars must be honest: this repo has
 * no community-area population join (census-acs.ts is ZIP-level live ACS only), so
 * a per-resident figure would be fabricated. The row shows "population join
 * pending" instead of a made-up number — Sol's "raw dollars are not the equity
 * verdict" caution is met by naming the gap, not by inventing the denominator.
 *
 * Pure server component. Every dollar is an AWARDED amount.
 */

/** One labeled metric row inside a compare column. */
function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-[#0C1B33]/8 py-2">
      <span className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/45">{label}</span>
      <span className="text-right text-[13px] text-[#0C1B33]">{children}</span>
    </div>
  );
}

/** The compact program-mix bar (funder-type shares) for one community. */
function ProgramMix({ analysis }: { analysis: CommunityInvestmentAnalysis }) {
  const withDollars = analysis.byFunderType.filter((f) => f.awardedDollars > 0);
  return (
    <div className="pt-2">
      <div className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/45">Program mix</div>
      {withDollars.length === 0 ? (
        <p className="mt-1 text-[12px] text-[#0C1B33]/45">No dollar-valued awards.</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {withDollars
            .slice()
            .sort((a, b) => b.awardedDollars - a.awardedDollars)
            .map((f) => (
              <li key={f.funderType}>
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="text-[#0C1B33]/70">{FUNDER_TYPE_LABELS[f.funderType]}</span>
                  <span className="text-[#0C1B33]/45 [font-variant-numeric:tabular-nums]">{formatPercent(f.share)}</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-[2px] bg-[#0C1B33]/[0.06]">
                  <div
                    className="h-full rounded-[2px]"
                    style={{ width: `${f.share * 100}%`, minWidth: "2px", backgroundColor: FUNDER_TYPE_COLORS[f.funderType] }}
                  />
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export function CompareView({ analyses }: { analyses: CommunityInvestmentAnalysis[] }) {
  const gridCols =
    analyses.length >= 4
      ? "lg:grid-cols-4"
      : analyses.length === 3
        ? "lg:grid-cols-3"
        : "lg:grid-cols-2";

  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${gridCols}`}>
      {analyses.map((a) => (
        <div key={a.communityArea} className="flex flex-col border border-[#0C1B33]/10 bg-white p-4">
          <Link
            href={`/investment/${encodeURIComponent(a.communityArea)}`}
            className="font-editorial text-[20px] leading-tight text-[#0C1B33] hover:text-[#2563EB]"
          >
            {a.communityArea}
          </Link>

          <div className="mt-3">
            <div className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#2563EB]">Awarded since 2020</div>
            <div
              className="mt-1 text-[26px] font-semibold leading-none tracking-tight text-[#0C1B33]"
              style={{ fontVariantNumeric: "proportional-nums" }}
            >
              {formatFullDollars(a.totalAwarded)}
            </div>
          </div>

          <div className="mt-3">
            <Metric label="Per resident">
              <span className="text-[12px] italic text-[#0C1B33]/45">population join pending</span>
            </Metric>
            <Metric label="Records">{formatCount(a.recordCount)}</Metric>
            <Metric label="Median award">
              {a.medianAward > 0 ? formatFullDollars(a.medianAward) : "—"}
            </Metric>
            <Metric label="Announced private">
              {a.announcedCapital > 0 ? formatCompactDollars(a.announcedCapital) : "—"}
            </Metric>
            <Metric label="Tax-credit capital">
              {a.creditCapital > 0 ? formatCompactDollars(a.creditCapital) : "—"}
            </Metric>
            <Metric label="Vs. median">
              {a.equity.citywideMedianCA > 0
                ? `${(a.equity.thisVsMedian).toFixed(1)}× · rank ${formatCount(a.equity.rank)}/${formatCount(a.equity.totalCAs)}`
                : `rank ${formatCount(a.equity.rank)}/${formatCount(a.equity.totalCAs)}`}
            </Metric>
          </div>

          <ProgramMix analysis={a} />

          <div className="pt-3">
            <div className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/45">Top funders</div>
            <ul className="mt-1.5 space-y-1">
              {a.topFunders.filter((f) => f.awardedDollars > 0).slice(0, 3).map((f) => (
                <li key={f.funderName} className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="min-w-0 truncate text-[#0C1B33]/75" title={f.funderName}>
                    {f.funderName}
                  </span>
                  <span className="shrink-0 text-[#0C1B33]/60 [font-variant-numeric:tabular-nums]">
                    {formatCompactDollars(f.awardedDollars)}
                  </span>
                </li>
              ))}
              {a.topFunders.filter((f) => f.awardedDollars > 0).length === 0 ? (
                <li className="text-[12px] text-[#0C1B33]/45">No dollar-valued funders.</li>
              ) : null}
            </ul>
          </div>

          <div className="mt-auto pt-3">
            <div className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/45">Year trend</div>
            <div className="mt-1.5">
              <Sparkline byYear={a.byYear} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
