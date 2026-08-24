import type { FunderTypeBreakdown } from "@/lib/investment-analysis";
import { FUNDER_TYPE_COLORS, FUNDER_TYPE_LABELS } from "@/lib/community-investment-layer";
import { formatCount, formatFullDollars, formatPercent } from "./format";

/**
 * "Where the money came from" as one ranked horizontal-bar reading. Bars compare
 * magnitudes directly and put the exact dollars and share on one line, avoiding a
 * second donut view of the same split. Ranked high to low by awarded dollars.
 *
 * Bars carry the funder-type palette (identity), matching the donut and the map
 * legend so the two readings of the same split use one color language. A
 * zero-dollar funder type (private development, whose amounts are null by design)
 * renders as a count-only row with no bar — its projects are still accounted for.
 *
 * Pure server component (CSS bars, no chart engine, no client JS). Every figure is
 * an AWARDED amount.
 */
export function FunderTypeBars({ byFunderType }: { byFunderType: FunderTypeBreakdown[] }) {
  const withDollars = byFunderType.filter((f) => f.awardedDollars > 0).sort((a, b) => b.awardedDollars - a.awardedDollars);
  // The analysis emits the full funder-type domain so new categories can flow
  // through without bespoke UI wiring. Suppress truly absent categories here;
  // only a category with a real count belongs in the count-only ledger.
  const countOnly = byFunderType.filter((f) => f.awardedDollars <= 0 && f.count > 0);
  const max = Math.max(1, ...withDollars.map((f) => f.awardedDollars));

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5 sm:p-6">
      <div className="font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#0C1B33]/45">
        Sorted by awarded dollars
      </div>
      <ul className="mt-3 space-y-3">
        {withDollars.map((f) => (
          <li key={f.funderType}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#0C1B33]">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: FUNDER_TYPE_COLORS[f.funderType] }}
                />
                {FUNDER_TYPE_LABELS[f.funderType]}
              </span>
              <span className="shrink-0 text-[13px] text-[#0C1B33] [font-variant-numeric:tabular-nums]">
                <span className="font-semibold">{formatFullDollars(f.awardedDollars)}</span>
                <span className="ml-2 text-[#0C1B33]/45">{formatPercent(f.share)}</span>
              </span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-[2px] bg-[#0C1B33]/[0.06]">
              <div
                className="h-full rounded-[2px]"
                style={{
                  width: `${(f.awardedDollars / max) * 100}%`,
                  minWidth: "2px",
                  backgroundColor: FUNDER_TYPE_COLORS[f.funderType],
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      {countOnly.length > 0 ? (
        <div className="mt-4 border-t border-[#0C1B33]/8 pt-3">
          {countOnly.map((f) => (
            <p key={f.funderType} className="text-[11px] leading-relaxed text-[#0C1B33]/50">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: FUNDER_TYPE_COLORS[f.funderType] }}
                />
                <span className="font-medium text-[#0C1B33]/70">{FUNDER_TYPE_LABELS[f.funderType]}</span>
                <span>
                  · {formatCount(f.count)} project{f.count === 1 ? "" : "s"} · dollar amounts not disclosed
                </span>
              </span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
