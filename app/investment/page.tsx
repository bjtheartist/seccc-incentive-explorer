import Link from "next/link";
import type { Metadata } from "next";
import { loadInvestmentIndex, loadMajorDevelopments } from "@/lib/investment-analysis";
import {
  formatCount,
  formatFullDollars,
  formatAsOf,
  MAGNITUDE_HUE,
} from "@/components/investment/format";
import { CountUpDollars } from "@/components/investment/CountUpDollars";
import { MajorDevelopments } from "@/components/investment/MajorDevelopments";
import { getInvestmentAdminState, InvestmentLoginForm, InvestmentNotConfigured } from "./gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Investment & Impact Analysis",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InvestmentLandingPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const hasAuthError = paramValue(sp.error) === "1";

  const { configured, hasSession } = await getInvestmentAdminState();
  if (!configured) return <InvestmentNotConfigured />;
  if (!hasSession) return <InvestmentLoginForm redirectTo="/investment" hasAuthError={hasAuthError} />;

  const index = loadInvestmentIndex();
  const topDevelopments = loadMajorDevelopments({ limit: 10 });

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-6 flex items-center justify-between gap-1.5 font-mono-bureau text-[12px] text-[#0C1B33]/50">
          <div className="flex items-center gap-1.5">
            <Link href="/admin" className="hover:text-[#2563EB]">
              Admin
            </Link>
            <span>/</span>
            <span className="text-[#0C1B33]/80">Investment analysis</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/map" className="hover:text-[#2563EB]">
              Map
            </Link>
            <Link href="/admin/owner-files" className="hover:text-[#2563EB]">
              Owner Files
            </Link>
          </div>
        </nav>

        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Investment &amp; Impact
        </span>
        <h1 className="mt-3 font-editorial text-[44px] leading-none sm:text-[56px]">Where the money went</h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[#0C1B33]/45">
          Grants, awards, and development sited into Chicago&rsquo;s community areas since 2020 — government,
          philanthropic, and private capital, from public records. Admin-only; never shown to public visitors.
        </p>

        {!index || index.rows.length === 0 ? (
          <div className="mt-8 border border-[#0C1B33]/10 bg-white p-6 text-[14px] text-[#0C1B33]/55">
            The Community Investment dataset has not been generated yet. Run{" "}
            <code className="font-mono-bureau text-[12px]">npm run data:export:investment</code> and reload.
          </div>
        ) : (
          <>
            {/* Hero citywide stat */}
            <div className="mt-8 border border-[#0C1B33]/10 bg-white px-6 py-8 sm:px-10 sm:py-10">
              <div className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
                Community-sited, awarded since 2020
              </div>
              <div
                className="mt-3 text-[clamp(44px,8vw,76px)] font-semibold leading-none tracking-tight text-[#0C1B33]"
                style={{ fontVariantNumeric: "proportional-nums" }}
              >
                <CountUpDollars value={index.citywideTotal} />
              </div>
              <p className="mt-4 text-[14px] leading-relaxed text-[#0C1B33]/55">
                awarded across{" "}
                <span className="font-semibold text-[#0C1B33]">{formatCount(index.communityCount)}</span>{" "}
                communities since 2020
              </p>
            </div>

            {/* Ranked community list */}
            <div className="mt-8">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-editorial text-[26px]">Communities by awarded dollars</h2>
                <span className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                  Ranked high → low
                </span>
              </div>
              <div className="divide-y divide-[#0C1B33]/8 border border-[#0C1B33]/10 bg-white">
                {index.rows.map((row, i) => {
                  const pct = index.rows[0].totalAwarded > 0 ? row.totalAwarded / index.rows[0].totalAwarded : 0;
                  return (
                    <Link
                      key={row.communityArea}
                      href={`/investment/${encodeURIComponent(row.communityArea)}`}
                      className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-[#FAF9F6] sm:px-5"
                    >
                      <span className="w-7 shrink-0 text-right font-mono-bureau text-[12px] text-[#0C1B33]/35 [font-variant-numeric:tabular-nums]">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-[14px] font-medium text-[#0C1B33] group-hover:text-[#2563EB]">
                            {row.communityArea}
                          </span>
                          <span className="shrink-0 text-[14px] font-semibold text-[#0C1B33] [font-variant-numeric:tabular-nums]">
                            {formatFullDollars(row.totalAwarded)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-3">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#0C1B33]/[0.06]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                // Honest linear width — no shared floor that would render a
                                // >100x dollar spread as identical bars; 1px minWidth only keeps
                                // a nonzero value from vanishing entirely (the $ text is the read).
                                width: `${pct * 100}%`,
                                minWidth: row.totalAwarded > 0 ? "1px" : 0,
                                backgroundColor: MAGNITUDE_HUE,
                              }}
                            />
                          </div>
                          <span className="shrink-0 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
                            {formatCount(row.recordCount)} record{row.recordCount === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Major private developments — citywide top 10 by announced capital */}
            {topDevelopments.count > 0 ? (
              <div className="mt-12">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="font-editorial text-[26px]">Major private developments</h2>
                  <span className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                    Top 10 by announced $
                  </span>
                </div>
                <MajorDevelopments summary={topDevelopments} scope="citywide" />
              </div>
            ) : null}

            <p className="mt-6 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/35">
              Data as of {formatAsOf(index.generatedAt)} · dollars are awarded amounts, not confirmed receipts
            </p>
          </>
        )}
      </div>
    </main>
  );
}
