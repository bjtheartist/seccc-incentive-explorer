import type { MajorDevelopmentsSummary } from "@/lib/investment-analysis";
import { formatCompactDollars, formatCount, truncate } from "./format";
import { investmentStatusLabel, FUNDER_TYPE_COLORS } from "@/lib/community-investment-layer";

/**
 * "Major private developments" — the enriched megaprojects (developments_major)
 * that carry a real ANNOUNCED private-capital figure. This section reports a
 * DIFFERENT MEASURE from the awarded-grant totals everywhere else on the page:
 * announced private development capital is a self-reported project price tag, not
 * a grant anyone awarded, so the two are shown side by side but NEVER combined —
 * an inline note states this explicitly. Dollars use the compact format; the
 * private-development purple keys the section to its map/legend color.
 *
 * Server component (no fs, no client state) — safe in the server-rendered
 * /investment pages and the print brief. `scope` only tunes the empty-state copy.
 */
const DEV_ACCENT = FUNDER_TYPE_COLORS.private_development; // #7C3AED

export function MajorDevelopments({
  summary,
  scope,
}: {
  summary: MajorDevelopmentsSummary;
  scope: "citywide" | "area";
}) {
  if (summary.count === 0) {
    return (
      <div className="border border-[#0C1B33]/10 bg-white p-6 text-[13px] text-[#0C1B33]/55">
        {scope === "area"
          ? "No major private developments with an announced capital figure are sited in this community."
          : "No major private developments with an announced capital figure are on record."}
      </div>
    );
  }

  return (
    <div>
      {/* Announced-capital summary — labeled distinctly from awarded grants. */}
      <div className="border border-[#0C1B33]/10 bg-white px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div>
            <div
              className="font-mono-bureau text-[10px] uppercase tracking-[0.2em]"
              style={{ color: DEV_ACCENT }}
            >
              Announced private capital
            </div>
            <div
              className="mt-1 text-[clamp(30px,5vw,40px)] font-semibold leading-none tracking-tight text-[#0C1B33]"
              style={{ fontVariantNumeric: "proportional-nums" }}
            >
              {formatCompactDollars(summary.totalAnnounced)}
            </div>
          </div>
          <div className="font-mono-bureau text-[11px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
            {formatCount(summary.count)} major development{summary.count === 1 ? "" : "s"}
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/55">
          Announced figures — a different measure from awarded grants; never combined. These are
          self-reported total project costs for major private developments, not grants awarded to a
          recipient.
        </p>
      </div>

      {/* Ranked project list. */}
      <ul className="mt-4 divide-y divide-[#0C1B33]/8 border border-[#0C1B33]/10 bg-white">
        {summary.developments.map((d, i) => (
          <li key={`${d.recipient}-${i}`} className="px-4 py-4 sm:px-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-[14px] font-medium text-[#0C1B33]">{d.recipient}</span>
              <span
                className="shrink-0 text-[14px] font-semibold [font-variant-numeric:tabular-nums]"
                style={{ color: DEV_ACCENT }}
              >
                {formatCompactDollars(d.announcedInvestment)}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className="inline-block rounded-[2px] border px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.06em]"
                style={{
                  color: DEV_ACCENT,
                  backgroundColor: `${DEV_ACCENT}14`,
                  borderColor: `${DEV_ACCENT}30`,
                }}
              >
                {investmentStatusLabel(d.status)}
              </span>
              {d.year != null ? (
                <span className="font-mono-bureau text-[11px] text-[#0C1B33]/45 [font-variant-numeric:tabular-nums]">
                  {d.year}
                </span>
              ) : null}
              {d.funderName ? (
                <span className="truncate text-[11px] text-[#0C1B33]/45">{d.funderName}</span>
              ) : null}
            </div>
            {d.logLine ? (
              <p className="mt-2 text-[12px] leading-relaxed text-[#0C1B33]/55">
                {truncate(d.logLine, 220)}
              </p>
            ) : null}
            {d.sourceLink ? (
              <a
                href={d.sourceLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#2563EB] hover:underline"
              >
                Source →
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
