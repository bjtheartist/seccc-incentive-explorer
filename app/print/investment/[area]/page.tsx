import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CHICAGO_COMMUNITY_AREAS } from "@/lib/community-areas";
import { loadCommunityInvestment } from "@/lib/community-investment";
import {
  computeInvestmentFindings,
  loadCapitalContextForArea,
  loadFlowRows,
  loadInvestmentAnalysis,
} from "@/lib/investment-analysis";
import { StatusCards } from "@/components/investment/StatusCards";
import { YearBars } from "@/components/investment/YearBars";
import { TopFunders } from "@/components/investment/TopFunders";
import { CapitalContext } from "@/components/investment/CapitalContext";
import { Methodology } from "@/components/investment/Methodology";
import { formatAsOf, formatFullDollars, SOURCE_LABELS_SHORT, truncate } from "@/components/investment/format";
import {
  getInvestmentAdminState,
  InvestmentLoginForm,
  InvestmentNotConfigured,
} from "@/app/investment/gate";

/**
 * /print/investment/[area] — the Community Investment Brief as a MEETING PACKET
 * (Sol #5): exactly two letter pages, print-safe, no hover-dependent content.
 *
 *   Page 1 — three status cards (awarded / announced / reported-disbursement) +
 *     the non-grant capital-class row, three auto-generated findings (computed
 *     plain sentences), the year trend, top funders + top recipients, and a small
 *     static map placeholder.
 *   Page 2 — the selected-records table (top 15), the capital-class context
 *     (TIF/CRA/CDFI for this community), the missing-data warnings, and the
 *     methodology + as-of + source list.
 *
 * Same Owner Files admin gate as /investment (single sign-on); the companion
 * scripts/export-investment-brief.ts authenticates and prints this page to PDF.
 * Every dollar shown is an AWARDED amount (never received/available/remaining).
 */

export const dynamic = "force-dynamic";

type Params = Promise<{ area: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** Decode the slug and resolve it to a canonical community-area name (or null). */
function resolveArea(slug: string): string | null {
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    decoded = slug;
  }
  const match = CHICAGO_COMMUNITY_AREAS.find((ca) => ca.name.toLowerCase() === decoded.toLowerCase());
  return match ? match.name : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { area } = await params;
  const name = resolveArea(area);
  return {
    title: name ? `Community Investment Brief — ${name}` : "Community Investment Brief",
    robots: { index: false, follow: false },
  };
}

/** Print CSS scoped to this route — letter @page, exact colors, a single hard page
 * break so the packet is exactly two pages. Kept inline so the brief owns its own
 * paper rules without touching shared styles. */
const PRINT_CSS = `
@page { size: letter; margin: 0.5in; }
@media print {
  html, body { background: #ffffff !important; }
  nav, footer, .no-print { display: none !important; }
  .bureau-noise::before { display: none !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .investment-brief { background: #ffffff !important; padding: 0 !important; }
  .brief-sheet { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; width: 100% !important; }
  .brief-page-2 { break-before: page; }
  .brief-figure { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  /* Repeat table headers if a table spans the page break. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
}
`;

/** A titled section wrapper — an editorial header + one-line description. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="font-editorial text-[22px] leading-tight text-[#0C1B33]">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/45">{description}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function InvestmentBriefPrintPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { area } = await params;
  const sp = await searchParams;
  const hasAuthError = paramValue(sp.error) === "1";

  const { configured, hasSession } = await getInvestmentAdminState();
  if (!configured) return <InvestmentNotConfigured />;
  if (!hasSession) {
    return <InvestmentLoginForm redirectTo={`/investment/${area}`} hasAuthError={hasAuthError} />;
  }

  const name = resolveArea(area);
  if (!name) notFound();

  const analysis = loadInvestmentAnalysis(name);
  const meta = loadCommunityInvestment()?.meta;
  const sources = meta?.sources ?? [];
  const flowRows = loadFlowRows(name);
  const capitalContext = loadCapitalContextForArea(name);
  const findings = analysis ? computeInvestmentFindings(analysis) : [];
  const selectedRecords = flowRows.slice(0, 15);

  // Missing-data warnings — dataset-level honesty for the packet's second page.
  const warnings: string[] = [];
  warnings.push("Reported disbursements: no source in this dataset reports receipts yet, so payment evidence is not shown.");
  warnings.push("Per-resident awarded dollars are withheld — there is no community-area population join, so a per-capita figure would be fabricated.");
  warnings.push("Foundation figures come from IRS 990 filings with a 1–2 year reporting lag, so the most recent grants are undercounted.");
  warnings.push("Citywide and intermediary commitments that never land in a single neighborhood are excluded from this community's totals.");
  if ((meta?.nmtcUnstamped ?? 0) > 0) {
    warnings.push(`${meta?.nmtcUnstamped} New Markets Tax Credit record(s) could not be stamped to a community area and are excluded from any community credit total.`);
  }
  if ((meta?.droppedHudOutOfBbox ?? 0) > 0) {
    warnings.push(`${meta?.droppedHudOutOfBbox} HUD CDBG/HOME activities were dropped for geocodes outside Chicago rather than plotted at a misleading point.`);
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <main className="investment-brief min-h-screen bg-[#E9E7E1] px-4 py-8 text-[#0C1B33] print:p-0">
        <div className="brief-sheet mx-auto max-w-[7.5in] bg-white p-8 shadow-sm sm:p-10">
          <p className="no-print mb-6 text-[11px] leading-relaxed text-[#0C1B33]/45">
            Print or Save as PDF (letter, background graphics on) — two pages — or generate it headless with{" "}
            <code>scripts/export-investment-brief.ts</code>.
          </p>

          {!analysis ? (
            <div className="border border-[#0C1B33]/10 bg-white p-6 text-[14px] text-[#0C1B33]/55">
              No grants, awards, or development have been recorded in {name} since 2020 in this dataset.
            </div>
          ) : (
            <>
              {/* ── PAGE 1 ── */}
              <header className="brief-figure border-b-2 border-[#0C1B33] pb-4">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
                    Chicago Incentive Explorer · Investment &amp; Impact
                  </span>
                  <span className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
                    As of {formatAsOf(analysis.generatedAt)}
                  </span>
                </div>
                <h1 className="mt-2 font-editorial text-[40px] leading-none">{name}</h1>
                <p className="mt-1 font-editorial text-[18px] italic text-[#0C1B33]/70">
                  Community Investment Brief · Meeting packet
                </p>
              </header>

              <div className="mt-5">
                <StatusCards
                  awarded={analysis.totalAwarded}
                  announced={analysis.announcedCapital}
                  capital={{
                    authorizedTif: analysis.authorizedTif,
                    federalProgram: analysis.federalProgram,
                    creditCapital: analysis.creditCapital,
                  }}
                  asOf={analysis.generatedAt}
                  coverageHref="#brief-methodology"
                  animate={false}
                  awardedNote={`${analysis.recordCount} grants & projects since 2020. Documented commitments from public records; an award is a commitment on paper, not proof of receipt.`}
                />
              </div>

              <Section title="What the numbers say" description="Computed straight from the record set — no claim the figures don't earn.">
                <ol className="brief-figure space-y-2">
                  {findings.map((f, i) => (
                    <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-[#0C1B33]/75">
                      <span className="font-mono-bureau text-[11px] font-semibold text-[#2563EB]">{i + 1}</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ol>
              </Section>

              <Section title="When it arrived" description="Awarded dollars by year, 2020 to the latest on record.">
                <YearBars byYear={analysis.byYear} unYeared={analysis.unYeared} mode="amount" />
              </Section>

              <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                <Section title="Who invested here" description="The funders putting the most dollars into this community.">
                  <TopFunders funders={analysis.topFunders.slice(0, 6)} />
                </Section>
                <Section title="Top recipients" description="The largest single awards on record since 2020.">
                  <ol className="brief-figure divide-y divide-[#0C1B33]/8 border border-[#0C1B33]/10 bg-white">
                    {analysis.topRecipients.slice(0, 6).map((r, i) => (
                      <li key={`${r.id}-${i}`} className="flex items-baseline justify-between gap-3 px-3 py-2">
                        <span className="min-w-0 truncate text-[12px] font-medium text-[#0C1B33]">{r.recipient}</span>
                        <span className="shrink-0 text-[12px] font-semibold text-[#0C1B33] [font-variant-numeric:tabular-nums]">
                          {formatFullDollars(r.amountAwarded)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Section>
              </div>

              <Section title="Where it landed" description="This brief pairs with the interactive map layer.">
                <div className="brief-figure flex h-[1.6in] items-center justify-center border border-dashed border-[#0C1B33]/25 bg-[#FAF9F6] text-center">
                  <div>
                    <div className="font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/45">
                      Map
                    </div>
                    <p className="mt-1 px-6 text-[11px] leading-relaxed text-[#0C1B33]/50">
                      Open the <span className="font-medium">Community investment</span> layer at{" "}
                      <span className="font-mono-bureau">/map</span> and filter to {name} for the sited view.
                    </p>
                  </div>
                </div>
              </Section>

              {/* ── PAGE 2 ── */}
              <div className="brief-page-2">
                <Section
                  title="Selected records"
                  description="The 15 largest awarded records since 2020 — funder, program, recipient, year, and amount."
                >
                  <div className="overflow-hidden border border-[#0C1B33]/10 bg-white">
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-[#0C1B33]/10 text-left text-[9px] uppercase tracking-[0.06em] text-[#0C1B33]/45">
                          <th className="px-2.5 py-2 font-medium">Recipient</th>
                          <th className="px-2.5 py-2 font-medium">Funder</th>
                          <th className="px-2.5 py-2 font-medium">Program</th>
                          <th className="px-2.5 py-2 font-medium">Year</th>
                          <th className="px-2.5 py-2 text-right font-medium">Awarded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRecords.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-2.5 py-3 text-[#0C1B33]/45">
                              No dollar-valued awarded records since 2020.
                            </td>
                          </tr>
                        ) : (
                          selectedRecords.map((r) => (
                            <tr key={r.id} className="border-b border-[#0C1B33]/5 last:border-b-0">
                              <td className="px-2.5 py-1.5 font-medium text-[#0C1B33]">{truncate(r.recipient, 40)}</td>
                              <td className="px-2.5 py-1.5 text-[#0C1B33]/60">{truncate(r.funderName, 34)}</td>
                              <td className="px-2.5 py-1.5 text-[#0C1B33]/55">{SOURCE_LABELS_SHORT[r.source] ?? r.source}</td>
                              <td className="px-2.5 py-1.5 text-[#0C1B33]/55 [font-variant-numeric:tabular-nums]">{r.year}</td>
                              <td className="px-2.5 py-1.5 text-right font-semibold text-[#0C1B33] [font-variant-numeric:tabular-nums]">
                                {formatFullDollars(r.amountAwarded)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </Section>

                <Section
                  title="Capital-class context"
                  description="Non-grant capital sited beside the awarded grants — different money concepts, never summed with them."
                >
                  <CapitalContext
                    context={capitalContext}
                    authorizedTif={analysis.authorizedTif}
                    federalProgram={analysis.federalProgram}
                    creditCapital={analysis.creditCapital}
                  />
                </Section>

                <Section title="Missing-data warnings">
                  <ul className="brief-figure space-y-1.5 border border-[#0C1B33]/10 bg-[#0C1B33]/[0.02] p-4 text-[11px] leading-relaxed text-[#0C1B33]/55">
                    {warnings.map((w, i) => (
                      <li key={i} className="flex gap-2">
                        <span aria-hidden className="text-[#0C1B33]/35">
                          •
                        </span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </Section>

                <div id="brief-methodology" className="mt-6 scroll-mt-6">
                  <Section title="Methodology">
                    <Methodology sources={sources} generatedAt={analysis.generatedAt} />
                  </Section>
                </div>

                <p className="mt-6 border-t border-[#0C1B33]/10 pt-4 font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-[#0C1B33]/40">
                  Chicago Incentive Explorer · Community Investment Brief · {name} · As of{" "}
                  {formatAsOf(analysis.generatedAt)}
                </p>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
