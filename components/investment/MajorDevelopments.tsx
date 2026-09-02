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

/**
 * R1 finding 4, follow-up — why there is no `datasetUnavailable` prop here.
 *
 * The concern was real: `loadMajorDevelopments` returns the same empty summary
 * whether the export holds no megaprojects or could not be read at all, and
 * the "No major private developments …" sentence below is an authoritative
 * negative finding that must not stand in for an outage.
 *
 * But the prop that was added to carry that distinction could never be true.
 * `loadMajorDevelopments` reads the SAME export as `loadCommunityInvestment`,
 * so an unreadable export fails both at once — and both call sites
 * (app/investment/page.tsx, app/investment/[area]/page.tsx) render this
 * component only inside the ELSE branch of a `datasetUnavailable ? … : …`
 * ternary that has already tested exactly that flag. On an outage neither page
 * reaches this component at all: each renders its own page-level
 * COMMUNITY_INVESTMENT_UNAVAILABLE card in place of every section, which is
 * the honest statement the reader actually needs, made once rather than
 * repeated per section. That is verified at the page level in
 * app/investment/page.test.ts and app/investment/[area]/page.test.ts, which
 * assert the outage render carries the unavailability heading and NOT the
 * absence sentences below.
 *
 * So the branch was unreachable in production and the prop was always `false`
 * where it was read — only its own unit test ever set it. A dead branch that
 * looks like a safeguard is worse than no branch: it reads as coverage this
 * component does not have. Keeping this component honest is instead the
 * CALLER's job, and the caller already does it.
 */
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
