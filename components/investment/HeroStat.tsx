import { formatCount, formatFullDollars } from "./format";

/**
 * Hero stat tile (NOT a chart) — the single figure the analysis leads with:
 * total awarded since 2020, with a one-line context strip. Follows the
 * hero-number spec: the value is large (≥48px), in the app sans (Inter), and
 * uses proportional figures (never tabular-nums, never the editorial serif).
 */
export function HeroStat({
  total,
  recordCount,
  spanMax,
  eyebrow,
}: {
  total: number;
  recordCount: number;
  spanMax: number | null;
  eyebrow: string;
}) {
  const rangeLabel = spanMax && spanMax > 2020 ? `2020–${spanMax}` : "2020";
  return (
    <div className="border border-[#0C1B33]/10 bg-white px-6 py-8 sm:px-10 sm:py-10">
      <div className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
        {eyebrow}
      </div>
      <div
        className="mt-3 text-[clamp(44px,8vw,76px)] font-semibold leading-none text-[#0C1B33] tracking-tight"
        style={{ fontVariantNumeric: "proportional-nums" }}
      >
        {formatFullDollars(total)}
      </div>
      <p className="mt-4 text-[14px] leading-relaxed text-[#0C1B33]/55">
        awarded <span className="text-[#0C1B33]/30">·</span> {formatCount(recordCount)} grants &amp;
        projects <span className="text-[#0C1B33]/30">·</span> {rangeLabel}
      </p>
    </div>
  );
}
