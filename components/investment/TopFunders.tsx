import type { TopFunder } from "@/lib/investment-analysis";
import { formatCount, formatFullDollars } from "./format";

/**
 * "Who invested here" — the funders putting the most dollars into the community
 * since 2020, each a small profile card seed: funder name, total awarded, and
 * the number of grants. Dollars are AWARDED amounts.
 */
export function TopFunders({ funders }: { funders: TopFunder[] }) {
  if (funders.length === 0) {
    return (
      <div className="border border-[#0C1B33]/10 bg-white p-6 text-[13px] text-[#0C1B33]/55">
        No dollar-valued funders to profile in this community since 2020.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {funders.map((f, i) => (
        <div
          key={`${f.funderName}-${i}`}
          className="flex items-start justify-between gap-4 border border-[#0C1B33]/10 bg-white p-4"
        >
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium text-[#0C1B33]" title={f.funderName}>
              {f.funderName}
            </p>
            <p className="mt-1 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
              {formatCount(f.grants)} grant{f.grants === 1 ? "" : "s"}
            </p>
          </div>
          <div className="shrink-0 text-right text-[15px] font-semibold text-[#0C1B33] [font-variant-numeric:tabular-nums]">
            {f.awardedDollars > 0 ? formatFullDollars(f.awardedDollars) : "—"}
          </div>
        </div>
      ))}
    </div>
  );
}
