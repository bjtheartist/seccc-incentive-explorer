import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Network } from "lucide-react";
import { CHICAGO_COMMUNITY_AREAS } from "@/lib/community-areas";
import { loadCommunityInvestment } from "@/lib/community-investment";
import { loadInvestmentAnalysis, loadMajorDevelopments, loadFlowRows } from "@/lib/investment-analysis";
import { FunderTypeBars } from "@/components/investment/FunderTypeBars";
import { YearBars } from "@/components/investment/YearBars";
import { YearModeToggle } from "@/components/investment/YearModeToggle";
import { SourceBars } from "@/components/investment/SourceBars";
import { FunderFlowSankey } from "@/components/investment/FunderFlowSankey";
import { FunderFlowTable } from "@/components/investment/FunderFlowTable";
import { MajorDevelopments } from "@/components/investment/MajorDevelopments";
import { TopRecipientsTable } from "@/components/investment/TopRecipientsTable";
import { TopFunders } from "@/components/investment/TopFunders";
import { EquityContext } from "@/components/investment/EquityContext";
import { Methodology } from "@/components/investment/Methodology";
import { CommunityInvestmentEvidenceSummary } from "@/components/investment/CommunityInvestmentEvidenceSummary";
import { WorkingSetPanel } from "@/components/investment/Shortlist";
import { ComparePinBar, PinButton } from "@/components/investment/PinControls";
import { ShowOnMapLink } from "@/components/investment/ShowOnMapLink";
import { RecordDrawerProvider } from "@/components/investment/RecordDrawer";
import {
  formatAsOf,
  formatCompactDollars,
  formatFullDollars,
  formatPercent,
} from "@/components/investment/format";
import {
  GOVERNMENT_FUNDING_PURPOSE_DESCRIPTIONS,
  GOVERNMENT_FUNDING_PURPOSE_LABELS,
} from "@/lib/government-funding-purpose";
import { getInvestmentAdminState, InvestmentLoginForm, InvestmentNotConfigured } from "../gate";

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
    title: name ? `Investment & Impact — ${name}` : "Investment & Impact Analysis",
    robots: { index: false, follow: false },
  };
}

/** A titled section wrapper with the editorial header + one-line description. */
function Section({
  title,
  description,
  id,
  children,
}: {
  title: string;
  description?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-12 scroll-mt-6 border-t border-[#0C1B33]/15 pt-7">
      <h2 className="font-mono-bureau text-[12px] font-semibold uppercase tracking-[0.12em] text-[#0C1B33]">
        {title}
      </h2>
      {description ? (
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-[#0C1B33]/55">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** One compact panel in the evidence-brief overview grid. */
function EvidencePanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 border border-[#0C1B33]/15 bg-white p-4 sm:p-5">
      <h2 className="font-mono-bureau text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0C1B33]">
        {title}
      </h2>
      <p className="mt-1 text-[11px] leading-relaxed text-[#0C1B33]/50">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function FoundationConcentration({
  analysis,
}: {
  analysis: NonNullable<ReturnType<typeof loadInvestmentAnalysis>>;
}) {
  const stats = [
    {
      label: "Foundation awarded dollars",
      value: formatCompactDollars(analysis.equity.foundationDollars),
    },
    {
      label: "Share of awarded grants",
      value: formatPercent(analysis.equity.foundationShare, 1),
    },
    {
      label: "Community rank",
      value: `#${analysis.equity.rank} of ${analysis.equity.totalCAs}`,
    },
  ];

  return (
    <div>
      <div className="grid grid-cols-1 divide-y divide-[#0C1B33]/12 border-y border-[#0C1B33]/12 sm:grid-cols-3 sm:divide-x sm:divide-y-0 xl:grid-cols-1 xl:divide-x-0 xl:divide-y">
        {stats.map((stat) => (
          <div key={stat.label} className="py-4 sm:px-3 sm:first:pl-0 sm:last:pr-0 xl:px-0">
            <p className="font-mono-bureau text-[8px] uppercase leading-relaxed tracking-[0.1em] text-[#0C1B33]/45">
              {stat.label}
            </p>
            <p className="mt-2 font-editorial text-[30px] leading-none text-[#2563EB] [font-variant-numeric:tabular-nums]">
              {stat.value}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-[#0C1B33]/50">
        Foundation records may reflect a grantee headquarters rather than where every awarded dollar was used.
      </p>
    </div>
  );
}

export default async function InvestmentAreaPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { area } = await params;
  const sp = await searchParams;
  const hasAuthError = paramValue(sp.error) === "1";

  const { configured, hasSession, accessMode } = await getInvestmentAdminState();
  if (!configured) return <InvestmentNotConfigured />;
  if (!hasSession) {
    return <InvestmentLoginForm redirectTo={`/investment/${area}`} hasAuthError={hasAuthError} />;
  }

  const name = resolveArea(area);
  if (!name) notFound();
  const communityAreaId = CHICAGO_COMMUNITY_AREAS.find((community) => community.name === name)?.id;

  const analysis = loadInvestmentAnalysis(name);
  const developments = loadMajorDevelopments({ communityArea: name });
  const flowRows = loadFlowRows(name);
  const investment = loadCommunityInvestment();
  const meta = investment?.meta;
  const sources = meta?.sources ?? [];

  // The NMTC centroid caveat below is a POSITIVE claim about this community's own
  // counts ("counted here", "stamped from a 2020 tract centroid"), so it may only
  // appear where an NMTC row actually lands here. 28 of the 77 communities that
  // carry records have none; on those pages the sentence would describe records
  // that do not exist. Mirrors analyzeCommunityArea's `mine` filter (this
  // community's base-investment records) so it tracks the same purpose counts.
  const hasStampedNmtcRecord = (investment?.records ?? []).some(
    (record) =>
      record.communityArea === name &&
      record.recovery == null &&
      record.source === "nmtc" &&
      record.funderType === "government",
  );

  const rangeLabel = analysis?.span && analysis.span.max > 2020 ? `2020–${analysis.span.max}` : "2020";

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-3 py-6 text-[#0C1B33] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <nav className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#0C1B33]/15 pb-4 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/50">
          <div className="flex flex-wrap items-center gap-1.5">
            {accessMode === "beta" ? null : (
              <>
                <Link href="/admin" className="hover:text-[#2563EB]">
                  Admin
                </Link>
                <span>/</span>
              </>
            )}
            <Link href="/investment" className="hover:text-[#2563EB]">
              Investment analysis
            </Link>
            <span>/</span>
            <span className="text-[#0C1B33]">{name}</span>
          </div>
          <Link href="/map" className="hover:text-[#2563EB]">
            Explorer map
          </Link>
        </nav>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
          <div>
            <span className="font-mono-bureau text-[9px] uppercase tracking-[0.2em] text-[#2563EB]">
              Community evidence brief · real published data
            </span>
            <h1 className="mt-3 max-w-[1040px] font-editorial text-[clamp(39px,3.7vw,54px)] leading-[0.98] tracking-[-0.025em] text-[#0C1B33]">
              Public Investment Analysis · {name}
            </h1>
            {analysis ? (
              <p className="mt-4 font-mono-bureau text-[9px] uppercase leading-relaxed tracking-[0.12em] text-[#0C1B33]/55">
                {communityAreaId ? `Area ${communityAreaId} · ` : ""}
                {name} · report date {formatAsOf(analysis.generatedAt)} · data window {rangeLabel}
              </p>
            ) : null}
          </div>
          <aside className="border border-[#0C1B33]/75 bg-white/60 p-4 sm:p-5" aria-label="Scope statement">
            <p className="font-mono-bureau text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0C1B33]">
              Scope statement
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/65">
              Documented capital commitments are reported by instrument. Award records do not prove receipt,
              spending, impact, or eligibility. Community totals exclude citywide and intermediary rows unless a
              local project or recipient location is published.
            </p>
          </aside>
        </div>

        {analysis ? (
          <div className="mt-5 flex flex-wrap items-center gap-2 no-print">
            <PinButton area={name} />
            <ShowOnMapLink
              area={name}
              className="inline-flex min-h-9 items-center border border-[#0C1B33]/20 bg-white px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[#0C1B33]/65 hover:border-[#2563EB] hover:text-[#2563EB]"
            />
            <Link
              href={`/print/investment/${encodeURIComponent(name)}`}
              className="inline-flex min-h-9 items-center border border-[#0C1B33]/20 bg-white px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[#0C1B33]/65 hover:border-[#2563EB] hover:text-[#2563EB]"
            >
              Print brief
              <ArrowRight aria-hidden className="ml-1.5 h-3.5 w-3.5" strokeWidth={1.8} />
            </Link>
          </div>
        ) : null}

        {!analysis ? (
          <div className="mt-8 border border-[#0C1B33]/15 bg-white p-6 text-[14px] text-[#0C1B33]/55">
            No grants, awards, or development have been recorded in {name} since 2020 in this dataset.
            <div className="mt-4">
              <Link href="/investment" className="inline-flex items-center font-mono-bureau text-[12px] uppercase tracking-[0.1em] text-[#2563EB]">
                <ArrowLeft aria-hidden className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
                All communities
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-5">
              <CommunityInvestmentEvidenceSummary analysis={analysis} />
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-[1.35fr_1.05fr_0.8fr]">
              <EvidencePanel
                title={`Awarded grant trend (${rangeLabel})`}
                description="Award timing by source/reporting year, not proof of receipt or expenditure."
              >
                <YearModeToggle
                  amount={
                    <YearBars
                      byYear={analysis.byYear}
                      unYeared={analysis.unYeared}
                      generatedAt={analysis.generatedAt}
                      mode="amount"
                    />
                  }
                  count={
                    <YearBars
                      byYear={analysis.byYear}
                      unYeared={analysis.unYeared}
                      generatedAt={analysis.generatedAt}
                      mode="count"
                    />
                  }
                />
              </EvidencePanel>

              <EvidencePanel
                title="Who funded awarded grants?"
                description="Funder types within awarded grants, ranked by documented dollars."
              >
                <FunderTypeBars byFunderType={analysis.byFunderType} />
                <p className="mt-3 text-[10px] leading-relaxed text-[#0C1B33]/45">
                  Corporate giving, when present in the dataset, remains part of awarded grants. Announced private
                  development is a separate, non-additive measure.
                </p>
              </EvidencePanel>

              <EvidencePanel
                title="Foundation concentration"
                description="A location lens inside awarded grants, not another capital class."
              >
                <FoundationConcentration analysis={analysis} />
              </EvidencePanel>
            </div>

            <div className="mt-3 grid border border-[#2563EB]/20 bg-[#EFF3FB]/70 md:grid-cols-2 md:divide-x md:divide-[#2563EB]/20">
              <p className="px-4 py-3 text-[11px] leading-relaxed text-[#0C1B33]/60">
                Foundation records may reflect a grantee&rsquo;s headquarters, not where every awarded dollar was
                used.
              </p>
              <p className="border-t border-[#2563EB]/20 px-4 py-3 text-[11px] leading-relaxed text-[#0C1B33]/60 md:border-t-0">
                Community totals exclude citywide and intermediary commitments unless a local project location is
                published.
              </p>
            </div>

            <div className="mt-3 grid border border-[#0C1B33]/15 bg-white lg:grid-cols-2 lg:divide-x lg:divide-[#0C1B33]/15">
              <div className="p-4 sm:p-5">
                <h2 className="font-mono-bureau text-[10px] font-semibold uppercase tracking-[0.13em] text-[#0C1B33]">
                  What the records show
                </h2>
                <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/65">
                  {formatFullDollars(analysis.totalAwarded)} in documented awarded grants across{" "}
                  {analysis.recordCount.toLocaleString("en-US")} grant and project records in this view. Foundation
                  records account for {formatPercent(analysis.equity.foundationShare, 1)} of awarded dollars, and{" "}
                  {name} ranks #{analysis.equity.rank} of {analysis.equity.totalCAs} funded communities by awarded
                  dollars.
                </p>
              </div>
              <div className="border-t border-[#0C1B33]/15 p-4 sm:p-5 lg:border-t-0">
                <h2 className="font-mono-bureau text-[10px] font-semibold uppercase tracking-[0.13em] text-[#0C1B33]">
                  What this cannot prove
                </h2>
                <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/65">
                  These records cannot establish whether funds were received, remain available, were spent in this
                  community, or produced completed projects or outcomes. They do not establish neighborhood-wide
                  benefit, causal impact, or eligibility for any program.
                </p>
              </div>
            </div>

            <nav
              aria-label="Investment detail sections"
              className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-[#0C1B33]/15 py-3 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/55"
            >
              <span className="font-semibold text-[#0C1B33]">Explore source records</span>
              <a href="#funding-profile" className="hover:text-[#2563EB]">Funding profile</a>
              <a href="#funding-flow" className="hover:text-[#2563EB]">Funding flow</a>
              <a href="#top-recipients" className="hover:text-[#2563EB]">Recipients</a>
              <a href="#methodology" className="hover:text-[#2563EB]">Methodology</a>
            </nav>

            <Section
              id="funding-profile"
              title="Funding mechanisms"
              description="Awarded dollars by program. Development projects are counted separately and their announced capital is excluded from awarded totals."
            >
              <SourceBars bySource={analysis.bySource} />
            </Section>

            {/* 4b — Purpose over every government record STAMPED to this community,
                expressed as counts so unlike capital classes are never blended into
                dollars. Not every one of them is sited: NMTC rows carry citywide
                geometry and are stamped from a tract centroid, so the copy below says
                "stamped to" rather than "sited" and names the exception on the pages
                that actually carry an NMTC row. */}
            <Section
              title="Government funding by purpose"
              description="Government records stamped to this community across the published source windows. These are record counts, not a combined dollar total."
            >
              <div className="grid border-y border-[#0C1B33]/10 sm:grid-cols-3 sm:divide-x sm:divide-[#0C1B33]/10">
                {analysis.governmentFundingPurposes.map((entry, index) => (
                  <div
                    key={entry.purpose}
                    className={`py-4 ${index < 2 ? "border-b border-[#0C1B33]/10 sm:border-b-0" : ""} ${index === 0 ? "sm:pr-5" : index === 1 ? "sm:px-5" : "sm:pl-5"}`}
                  >
                    <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB]">
                      {GOVERNMENT_FUNDING_PURPOSE_LABELS[entry.purpose]}
                    </span>
                    <p className="mt-2 font-editorial text-[30px] leading-none text-[#0C1B33]">
                      {entry.count.toLocaleString("en-US")}
                    </p>
                    <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/45">
                      {GOVERNMENT_FUNDING_PURPOSE_DESCRIPTIONS[entry.purpose]}
                    </p>
                  </div>
                ))}
              </div>
              {hasStampedNmtcRecord ? (
                <p className="mt-3 text-[11px] leading-relaxed text-[#0C1B33]/45">
                  New Markets Tax Credit rows publish no street address. They are counted here, but they are
                  stamped to this community from their 2020 census-tract centroid rather than a published
                  location, and they are never plotted on the map.
                </p>
              ) : null}
              <p
                className={`${hasStampedNmtcRecord ? "mt-2" : "mt-3"} text-[11px] leading-relaxed text-[#0C1B33]/45`}
              >
                Illinois Arts Council awards publish only city and region, so arts funding stays in the{" "}
                <Link href="/investment#illinois-arts-awards-collapse" className="text-[#2563EB] hover:underline">
                  city-level awards table
                </Link>{" "}
                instead of being assigned to this community.
              </p>
            </Section>

            {/* 4c — Flow: searchable table (default) + sankey behind a disclosure */}
            <Section
              id="funding-flow"
              title="How the money flowed"
              description="Awarded dollars from funders, through programs, to recipients on record since 2020. The purpose filter applies only to these dollar-valued award flows; other capital classes remain in the summary above."
            >
              <FunderFlowTable rows={flowRows} total={analysis.totalAwarded} />
              <details className="mt-3 border border-[#0C1B33]/10 bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.1em] text-[#2563EB] hover:bg-[#FAF9F6]">
                  <Network aria-hidden className="h-4 w-4" strokeWidth={1.7} />
                  Explore funding paths (Sankey)
                </summary>
                <div className="border-t border-[#0C1B33]/10 p-4">
                  <FunderFlowSankey communityArea={name} />
                </div>
              </details>
            </Section>

            {/* 4d — Major private developments (announced capital — a separate measure) */}
            <Section
              title="Major private developments"
              description="Announced private capital sited in this community — a different measure from the awarded grants above, and never combined with them."
            >
              <MajorDevelopments summary={developments} scope="area" />
            </Section>

            {/* 5 — Top recipients + working set. Wrapped in the drawer provider so a
                 row click opens the full-record side drawer (Sol #1) with no nav. */}
            <Section id="top-recipients" title="Top recipients" description="The largest single awards on record since 2020. Click a recipient for the full record; save rows to build a working set.">
              <RecordDrawerProvider>
                <TopRecipientsTable recipients={analysis.topRecipients} saveEnabled drawerEnabled area={name} />
              </RecordDrawerProvider>
              <div className="mt-4">
                <WorkingSetPanel />
              </div>
            </Section>

            {/* 6 — Funders */}
            <Section title="Who invested here" description="The funders putting the most dollars into this community.">
              <TopFunders funders={analysis.topFunders} />
            </Section>

            {/* 7 — Equity context */}
            <Section title="How it compares">
              <EquityContext
                communityArea={name}
                totalAwarded={analysis.totalAwarded}
                equity={analysis.equity}
              />
            </Section>

            {/* 8 — Methodology */}
            <Section title="Methodology" id="methodology">
              <Methodology
                sources={sources}
                generatedAt={analysis.generatedAt}
                dedupe={
                  meta
                    ? {
                        candidateGroups: meta.dedupeCandidateGroups,
                        collapsedRows: meta.dedupeCollapsedRows,
                        collapsedDollars: meta.dedupeCollapsedDollars,
                        keptFlaggedGroups: meta.dedupeKeptFlaggedGroups,
                        keptFlaggedRows: meta.dedupeKeptFlaggedRows,
                      }
                    : undefined
                }
              />
            </Section>

            <ComparePinBar />
          </>
        )}
      </div>
    </div>
  );
}
