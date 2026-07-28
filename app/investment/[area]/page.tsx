import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CHICAGO_COMMUNITY_AREAS } from "@/lib/community-areas";
import { loadCommunityInvestment } from "@/lib/community-investment";
import { loadInvestmentAnalysis, loadMajorDevelopments } from "@/lib/investment-analysis";
import { HeroStat } from "@/components/investment/HeroStat";
import { FunderDonut } from "@/components/investment/FunderDonut";
import { YearBars } from "@/components/investment/YearBars";
import { SourceBars } from "@/components/investment/SourceBars";
import { FunderFlowSankey } from "@/components/investment/FunderFlowSankey";
import { MajorDevelopments } from "@/components/investment/MajorDevelopments";
import { TopRecipientsTable } from "@/components/investment/TopRecipientsTable";
import { TopFunders } from "@/components/investment/TopFunders";
import { EquityContext } from "@/components/investment/EquityContext";
import { Methodology } from "@/components/investment/Methodology";
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
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
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
  const meta = loadCommunityInvestment()?.meta;
  const sources = meta?.sources ?? [];

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
        <h1 className="mt-3 font-editorial text-[44px] leading-none sm:text-[56px]">{name}</h1>

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
            {/* 1 — Hero */}
            <div className="mt-6">
              <HeroStat
                total={analysis.totalAwarded}
                recordCount={analysis.recordCount}
                spanMax={analysis.span?.max ?? null}
                eyebrow="Awarded since 2020"
              />
            </div>

            {/* 2 — Donut */}
            <Section
              title="Where the money came from"
              description="Awarded dollars by funder type — government programs, private foundations, and private development."
            >
              <FunderDonut byFunderType={analysis.byFunderType} total={analysis.totalAwarded} />
            </Section>

            {/* 3 — Year trend */}
            <Section
              title="When it arrived"
              description="Awarded dollars by year, 2020 to the latest on record."
            >
              <YearBars byYear={analysis.byYear} unYeared={analysis.unYeared} />
            </Section>

            {/* 4 — Program mix */}
            <Section
              title="Through which programs"
              description="Awarded dollars by funding program. Development projects are counted, not dollared."
            >
              <SourceBars bySource={analysis.bySource} />
            </Section>

            {/* 4b — Flow (funder → program → recipient) */}
            <Section
              title="How the money flowed"
              description="Awarded dollars from funders, through programs, to the recipients on record since 2020."
            >
              <FunderFlowSankey communityArea={name} />
            </Section>

            {/* 4c — Major private developments (announced capital — a separate measure) */}
            <Section
              title="Major private developments"
              description="Announced private capital sited in this community — a different measure from the awarded grants above, and never combined with them."
            >
              <MajorDevelopments summary={developments} scope="area" />
            </Section>

            {/* 5 — Top recipients */}
            <Section title="Top recipients" description="The largest single awards on record since 2020.">
              <TopRecipientsTable recipients={analysis.topRecipients} />
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
            <Section title="Methodology">
              <Methodology sources={sources} generatedAt={analysis.generatedAt} />
            </Section>
          </>
        )}
      </div>
    </main>
  );
}
