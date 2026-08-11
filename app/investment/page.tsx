import Link from "next/link";
import type { Metadata } from "next";
import { loadCommunityInvestment } from "@/lib/community-investment";
import {
  loadIllinoisArtsCouncilAwards,
  loadInvestmentIndex,
  loadMajorDevelopments,
} from "@/lib/investment-analysis";
import { buildSourceCoverageRows } from "@/lib/investment-source-coverage";
import { formatCount, formatAsOf } from "@/components/investment/format";
import { StatusCards } from "@/components/investment/StatusCards";
import { MajorDevelopments } from "@/components/investment/MajorDevelopments";
import { ComparePinBar } from "@/components/investment/PinControls";
import { CommunityRankingList } from "@/components/investment/CommunityRankingList";
import { SourceCoverageMatrix } from "@/components/investment/SourceCoverageMatrix";
import { IllinoisArtsCouncilAwardsTable } from "@/components/investment/IllinoisArtsCouncilAwardsTable";
import { InvestmentSpotlight } from "@/components/onboarding/InvestmentSpotlight";
import { InvestmentTourButton } from "@/components/onboarding/InvestmentTourButton";
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
  const investment = loadCommunityInvestment();
  const meta = investment?.meta;
  const coverageRows = meta ? buildSourceCoverageRows(meta) : [];
  const topDevelopments = loadMajorDevelopments({ limit: 10 });
  const illinoisArtsCouncilAwards = loadIllinoisArtsCouncilAwards();

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
            {index && index.rows.length > 0 ? <InvestmentTourButton /> : null}
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
            <InvestmentSpotlight />

            {/* Three-status grammar — citywide, community-sited scope */}
            <div className="mt-8" data-tour="investment-status-cards">
              <StatusCards
                awarded={index.citywideTotal}
                announced={meta?.announcedCapitalTotal ?? 0}
                capital={{
                  authorizedTif: meta?.totalAuthorizedTif ?? 0,
                  federalProgram: meta?.totalFederalProgram ?? 0,
                  creditCapital: meta?.totalCreditCapital ?? 0,
                }}
                asOf={index.generatedAt}
                coverageHref="#coverage"
                awardedNote={`Community-sited awarded dollars across ${formatCount(index.communityCount)} communities since 2020, from public records. An award is a commitment on paper, not proof of receipt.`}
              />
            </div>

            {/* Trust capsule — the load-bearing caveats, ALWAYS visible. The
                full provenance matrix and the purpose glossary collapse into
                "About this data" below, but these four facts never collapse:
                hiding disclosed limitations behind a chevron is the rail-7
                failure mode the battle-test flagged (Sol #5/#7). The unplotted
                count sits here so the ranking directly beneath can never read
                as "everything is on the map". */}
            <p
              className="mt-4 border-y border-[#0C1B33]/10 bg-white px-4 py-2.5 font-mono-bureau text-[10px] uppercase tracking-[0.1em] leading-relaxed text-[#0C1B33]/55"
              data-tour="investment-trust-capsule"
            >
              Data as of {formatAsOf(index.generatedAt)} · awarded dollars, not confirmed receipts ·{" "}
              {formatCount(meta?.citywideCount ?? 0)} records carry no map location and are counted, never
              plotted ·{" "}
              <a href="#coverage" className="text-[#2563EB] hover:underline">
                About this data
              </a>
            </p>

            {/* Start here — three task paths, each ending in an artifact. The
                battle-test's core verdict (Sol #6): the page opened with data
                and left the user to invent a workflow; the compare flow in
                particular was undiscoverable (pin buttons → floating bar).
                These three sentences ARE the fix — persistent, not a
                first-visit coach mark. */}
            <div
              className="mt-6 grid border-y border-[#0C1B33]/10 bg-white md:grid-cols-3 md:divide-x md:divide-[#0C1B33]/10"
              data-tour="investment-start-here"
            >
              <div className="border-b border-[#0C1B33]/10 px-4 py-3.5 md:border-b-0">
                <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB]">
                  Understand one community
                </span>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#0C1B33]/60">
                  Pick a community below for its full funding profile, top recipients, and funders.
                </p>
              </div>
              <div className="border-b border-[#0C1B33]/10 px-4 py-3.5 md:border-b-0">
                <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB]">
                  Compare communities
                </span>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#0C1B33]/60">
                  Pin 2&ndash;4 with the pin button on any row — a compare bar appears at the bottom of the
                  page.
                </p>
              </div>
              <div className="px-4 py-3.5">
                <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB]">
                  Prepare a funder brief
                </span>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#0C1B33]/60">
                  Open a community, then use Print brief for a clean, hand-off-ready PDF page.
                </p>
              </div>
            </div>

            {/* Ranked community list — the navigation primitive, promoted to
                directly under the numbers (battle-test: unanimous). */}
            <div className="mt-10" id="communities" data-tour="investment-community-ranking">
              <div className="mb-3">
                <h2 className="font-editorial text-[26px]">Communities by awarded dollars</h2>
              </div>
              <CommunityRankingList
                rows={index.rows.map((row) => ({
                  communityArea: row.communityArea,
                  totalAwarded: row.totalAwarded,
                  recordCount: row.recordCount,
                }))}
              />
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

            {/* Reference material, collapsed: the purpose glossary and the full
                source-coverage matrix are provenance/reference, not navigation.
                Each summary line states what is inside so the collapse hides
                DETAIL, never the existence of the material (rail 7). The
                #coverage id stays on this element so the StatusCards coverage
                link and the trust capsule both land here. */}
            <details
              id="coverage"
              className="mt-10 scroll-mt-6 border border-[#0C1B33]/10 bg-white"
              data-tour="investment-about-data"
            >
              <summary className="cursor-pointer px-4 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.14em] text-[#0C1B33]/70 hover:text-[#0C1B33]">
                About this data — funding-purpose definitions and per-source coverage, map, and refresh
                postures
              </summary>
              <div className="border-t border-[#0C1B33]/10 px-4 pb-5">
            <section id="government-funding-purposes" className="mt-5 scroll-mt-6">
              <h2 className="font-editorial text-[22px]">Government funding by purpose</h2>
              <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-[#0C1B33]/45">
                Funding purpose describes what the public support is for. Capital class remains separate and
                tells whether the source figure is an award, authorization, tax credit, or appropriation.
              </p>
              <div className="mt-4 grid border-y border-[#0C1B33]/10 md:grid-cols-3 md:divide-x md:divide-[#0C1B33]/10">
                <div className="border-b border-[#0C1B33]/10 py-4 md:border-b-0 md:pr-5">
                  <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB]">
                    Capital projects
                  </span>
                  <p className="mt-2 text-[13px] leading-relaxed text-[#0C1B33]/60">
                    Buildings, rehabilitation, acquisition, infrastructure, and other physical work.
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/40">
                    Includes NOF, SBIF, CDG, TIF, tax-credit projects, capital appropriations, and
                    capital-coded HUD activities.
                  </p>
                </div>
                <div className="border-b border-[#0C1B33]/10 py-4 md:border-b-0 md:px-5">
                  <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB]">
                    Programmatic funding
                  </span>
                  <p className="mt-2 text-[13px] leading-relaxed text-[#0C1B33]/60">
                    Services, technical or financial assistance, business relief, and program delivery.
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/40">
                    Includes public-service HUD activities and historical business recovery programs.
                  </p>
                </div>
                <div className="py-4 md:pl-5">
                  <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB]">
                    Arts funding
                  </span>
                  <p className="mt-2 text-[13px] leading-relaxed text-[#0C1B33]/60">
                    Arts and cultural awards published by a government arts agency.
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/40">
                    Illinois Arts Council records are city-level only and are not assigned to a property or
                    neighborhood.
                  </p>
                </div>
              </div>
            </section>

                {investment && coverageRows.length > 0 ? (
                  <section className="mt-8">
                    <h2 className="font-editorial text-[22px]">Source coverage</h2>
                    <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-[#0C1B33]/45">
                      Categorical source, map, refresh, and review postures for the committed export,
                      with the source-specific basis preserved in each state.
                    </p>
                    <div className="mt-4">
                      <SourceCoverageMatrix rows={coverageRows} generatedAt={investment.generatedAt} />
                    </div>
                  </section>
                ) : null}
              </div>
            </details>

            {/* Illinois Arts Council — reference table, collapsed. The summary
                keeps the table's existence and scope visible; the id stays
                reachable from the area pages' "state arts awards" link (the
                jump lands on the closed summary, one click from the rows). */}
            {illinoisArtsCouncilAwards ? (
              <details id="illinois-arts-awards-collapse" className="mt-4 scroll-mt-6 border border-[#0C1B33]/10 bg-white">
                <summary className="cursor-pointer px-4 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.14em] text-[#0C1B33]/70 hover:text-[#0C1B33]">
                  Illinois Arts Council awards — city-level state arts funding, never assigned to a
                  neighborhood
                </summary>
                <div className="border-t border-[#0C1B33]/10 px-4 pb-4">
                  <IllinoisArtsCouncilAwardsTable data={illinoisArtsCouncilAwards} />
                </div>
              </details>
            ) : null}

            <p className="mt-6 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/35">
              Data as of {formatAsOf(index.generatedAt)} · dollars are awarded amounts, not confirmed receipts ·
              awarded, announced, and disbursement are separate measures, never summed
            </p>

            <ComparePinBar />
          </>
        )}
      </div>
    </main>
  );
}
