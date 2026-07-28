import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CHICAGO_COMMUNITY_AREAS } from "@/lib/community-areas";
import { loadCommunityInvestment } from "@/lib/community-investment";
import { loadInvestmentAnalysis, loadMajorDevelopments, loadFlowRows } from "@/lib/investment-analysis";
import { FunderDonut } from "@/components/investment/FunderDonut";
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
import { StatusCards } from "@/components/investment/StatusCards";
import { WorkingSetPanel } from "@/components/investment/Shortlist";
import { ComparePinBar, PinButton } from "@/components/investment/PinControls";
import { ShowOnMapLink } from "@/components/investment/ShowOnMapLink";
import { RecordDrawerProvider } from "@/components/investment/RecordDrawer";
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
    <section id={id} className="mt-10 scroll-mt-6">
      <h2 className="font-editorial text-[28px] leading-tight text-[#0C1B33]">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-[#0C1B33]/45">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
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

  const { configured, hasSession } = await getInvestmentAdminState();
  if (!configured) return <InvestmentNotConfigured />;
  if (!hasSession) {
    return <InvestmentLoginForm redirectTo={`/investment/${area}`} hasAuthError={hasAuthError} />;
  }

  const name = resolveArea(area);
  if (!name) notFound();

  const analysis = loadInvestmentAnalysis(name);
  const developments = loadMajorDevelopments({ communityArea: name });
  const flowRows = loadFlowRows(name);
  const meta = loadCommunityInvestment()?.meta;
  const sources = meta?.sources ?? [];

  const rangeLabel = analysis?.span && analysis.span.max > 2020 ? `2020–${analysis.span.max}` : "2020";

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-4xl">
        <nav className="mb-6 flex items-center justify-between gap-1.5 font-mono-bureau text-[12px] text-[#0C1B33]/50">
          <div className="flex items-center gap-1.5">
            <Link href="/admin" className="hover:text-[#2563EB]">
              Admin
            </Link>
            <span>/</span>
            <Link href="/investment" className="hover:text-[#2563EB]">
              Investment analysis
            </Link>
            <span>/</span>
            <span className="text-[#0C1B33]/80">{name}</span>
          </div>
          <Link href="/map" className="hover:text-[#2563EB]">
            Map
          </Link>
        </nav>

        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Investment &amp; Impact
        </span>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-editorial text-[44px] leading-none sm:text-[56px]">{name}</h1>
          {analysis ? (
            <div className="flex items-center gap-2 no-print">
              <PinButton area={name} />
              <ShowOnMapLink area={name} />
              <Link
                href={`/print/investment/${encodeURIComponent(name)}`}
                className="inline-flex items-center rounded-[3px] border border-[#0C1B33]/15 bg-white px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[#0C1B33]/60 hover:border-[#0C1B33]/30 hover:text-[#0C1B33]"
              >
                Print brief →
              </Link>
            </div>
          ) : null}
        </div>

        {!analysis ? (
          <div className="mt-8 border border-[#0C1B33]/10 bg-white p-6 text-[14px] text-[#0C1B33]/55">
            No grants, awards, or development have been recorded in {name} since 2020 in this dataset.
            <div className="mt-4">
              <Link href="/investment" className="font-mono-bureau text-[12px] uppercase tracking-[0.1em] text-[#2563EB]">
                ← All communities
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* 1 — Three-status grammar */}
            <div className="mt-6">
              <StatusCards
                awarded={analysis.totalAwarded}
                announced={analysis.announcedCapital}
                capital={{
                  authorizedTif: analysis.authorizedTif,
                  federalProgram: analysis.federalProgram,
                  creditCapital: analysis.creditCapital,
                }}
                asOf={analysis.generatedAt}
                coverageHref="#methodology"
                awardedNote={`${analysis.recordCount} grants & projects · ${rangeLabel}. Documented commitments from public records; an award is a commitment on paper, not proof of receipt.`}
              />
            </div>

            {/* 2 — Donut + sorted bars */}
            <Section
              title="Where the money came from"
              description="Awarded dollars by funder type — the donut for the part-of-whole, the bars for exact dollars and share."
            >
              <FunderDonut byFunderType={analysis.byFunderType} total={analysis.totalAwarded} />
              <FunderTypeBars byFunderType={analysis.byFunderType} />
            </Section>

            {/* 3 — Year trend (amount / count toggle) */}
            <Section title="When it arrived" description="Awarded dollars by year, 2020 to the latest on record.">
              <YearModeToggle
                amount={<YearBars byYear={analysis.byYear} unYeared={analysis.unYeared} mode="amount" />}
                count={<YearBars byYear={analysis.byYear} unYeared={analysis.unYeared} mode="count" />}
              />
            </Section>

            {/* 4 — Program mix */}
            <Section
              title="Through which programs"
              description="Awarded dollars by funding program. Development projects are counted, not dollared."
            >
              <SourceBars bySource={analysis.bySource} />
            </Section>

            {/* 4b — Flow: searchable table (default) + sankey behind a disclosure */}
            <Section
              title="How the money flowed"
              description="Awarded dollars from funders, through programs, to recipients on record since 2020. Search the table, or open the funding-paths view for the visual."
            >
              <FunderFlowTable rows={flowRows} total={analysis.totalAwarded} />
              <details className="mt-3 border border-[#0C1B33]/10 bg-white">
                <summary className="cursor-pointer list-none px-4 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.1em] text-[#2563EB] hover:bg-[#FAF9F6]">
                  ▸ Explore funding paths (Sankey)
                </summary>
                <div className="border-t border-[#0C1B33]/10 p-4">
                  <FunderFlowSankey communityArea={name} />
                </div>
              </details>
            </Section>

            {/* 4c — Major private developments (announced capital — a separate measure) */}
            <Section
              title="Major private developments"
              description="Announced private capital sited in this community — a different measure from the awarded grants above, and never combined with them."
            >
              <MajorDevelopments summary={developments} scope="area" />
            </Section>

            {/* 5 — Top recipients + working set. Wrapped in the drawer provider so a
                 row click opens the full-record side drawer (Sol #1) with no nav. */}
            <Section title="Top recipients" description="The largest single awards on record since 2020. Click a recipient for the full record; save rows to build a working set.">
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
              <Methodology sources={sources} generatedAt={analysis.generatedAt} />
            </Section>

            <ComparePinBar />
          </>
        )}
      </div>
    </main>
  );
}
