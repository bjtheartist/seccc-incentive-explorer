import type { InvestmentEquity } from "@/lib/investment-analysis";
import { formatCount, formatFullDollars, formatMultiple, formatPercent, INK_55 } from "./format";

/**
 * "How it compares" — equity context in plain prose plus a rank card. No chart:
 * three numbers (rank, multiple-of-median, share of the community-sited citywide
 * total) read more honestly as sentences than as a bar. Every dollar is an
 * AWARDED amount; the citywide denominator excludes citywide/intermediary money.
 *
 * Carries the consult's Q4 rank disclosure (audit finding 5): a community rank
 * can be dominated by where a foundation's grantee HEADQUARTERS sits rather
 * than where the money was actually spent (a point on the map is often an
 * administrative address, not the funded site). The foundation-share figure is
 * computed LIVE from this community's own equity.foundationDollars /
 * totalAwarded (lib/investment-analysis.ts) — never a hand-typed literal —
 * so it reads correctly for whichever community is on screen, not just the
 * illustrative "Loop" example the consult itself used.
 */
export function EquityContext({
  communityArea,
  totalAwarded,
  equity,
}: {
  communityArea: string;
  totalAwarded: number;
  equity: InvestmentEquity;
}) {
  const { rank, totalCAs, citywideMedianCA, thisVsMedian, share, foundationDollars, foundationShare } = equity;
  const aboveMedian = thisVsMedian >= 1;

  return (
    <div className="grid grid-cols-1 gap-5 border border-[#0C1B33]/10 bg-white p-6 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8">
      {/* Rank card */}
      <div className="flex items-baseline gap-2 border-b border-[#0C1B33]/10 pb-5 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-8">
        <span
          className="text-[56px] font-semibold leading-none text-[#0C1B33]"
          style={{ fontVariantNumeric: "proportional-nums" }}
        >
          #{rank}
        </span>
        <span className="text-[14px] text-[#0C1B33]/45">of {formatCount(totalCAs)}</span>
      </div>

      {/* Prose */}
      <p className="text-[14px] leading-relaxed text-[#0C1B33]/70">
        {communityArea} ranks{" "}
        <strong className="font-semibold text-[#0C1B33]">
          {rank}
          {ordinalSuffix(rank)}
        </strong>{" "}
        of {formatCount(totalCAs)} funded communities by awarded dollars since 2020. Its{" "}
        <strong className="font-semibold text-[#0C1B33]">{formatFullDollars(totalAwarded)}</strong> is{" "}
        {citywideMedianCA > 0 ? (
          <>
            <strong className="font-semibold text-[#0C1B33]">{formatMultiple(thisVsMedian)}</strong> the citywide
            median community ({formatFullDollars(citywideMedianCA)})
            {aboveMedian ? "" : " — below the typical funded community"}
          </>
        ) : (
          <>above the citywide median community</>
        )}{" "}
        and represents <strong className="font-semibold text-[#0C1B33]">{formatPercent(share, 1)}</strong> of all
        community-sited dollars awarded citywide since 2020.
        <span className="mt-2 block text-[12px]" style={{ color: INK_55 }}>
          Citywide/intermediary commitments that never sit in a single community are excluded from this comparison.
        </span>
        <span className="mt-2 block text-[12px]" style={{ color: INK_55 }}>
          This ranks recipient-location concentrations, not neighborhood impact: a point may be a grantee
          headquarters or administrative address rather than the funded site
          {foundationDollars > 0 ? (
            <>
              ; in {communityArea}, foundation rows account for{" "}
              <strong className="font-semibold text-[#0C1B33]">{formatFullDollars(foundationDollars)}</strong> of{" "}
              {formatFullDollars(totalAwarded)} ({formatPercent(foundationShare, 1)}).
            </>
          ) : (
            "."
          )}
        </span>
      </p>
    </div>
  );
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
