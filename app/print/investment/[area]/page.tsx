import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CHICAGO_COMMUNITY_AREAS } from "@/lib/community-areas";
import { loadCommunityInvestment } from "@/lib/community-investment";
import { loadInvestmentAnalysis } from "@/lib/investment-analysis";
import { loadFunderFlow } from "@/lib/investment-sankey";
import { HeroStat } from "@/components/investment/HeroStat";
import { FunderDonut } from "@/components/investment/FunderDonut";
import { YearBars } from "@/components/investment/YearBars";
import { SourceBars } from "@/components/investment/SourceBars";
import { FunderFlowSankey } from "@/components/investment/FunderFlowSankey";
import { TopRecipientsTable } from "@/components/investment/TopRecipientsTable";
import { TopFunders } from "@/components/investment/TopFunders";
import { EquityContext } from "@/components/investment/EquityContext";
import { Methodology } from "@/components/investment/Methodology";
import { formatAsOf } from "@/components/investment/format";
import {
  getInvestmentAdminState,
  InvestmentLoginForm,
  InvestmentNotConfigured,
} from "@/app/investment/gate";

/**
 * /print/investment/[area] — a print-first "Community Investment Brief" for one
 * community area. Letter-size (@page below), 3–5 pages, self-contained: it
 * REUSES the exact server-SVG components from the on-screen /investment/[area]
 * analysis (FunderDonut, YearBars, SourceBars, FunderFlowSankey, …) so the brief
 * never forks their logic — the print sheet is the same figures laid out for
 * paper.
 *
 * Same owner-files admin gate as /investment (single sign-on). The companion
 * scripts/export-investment-brief.ts authenticates by POSTing
 * OWNER_FILES_ADMIN_PASSWORD to /api/admin/investment/login, carries the cookie,
 * and prints THIS page to PDF via puppeteer — so the gate protects the printable
 * brief exactly as it protects the on-screen analysis.
 *
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

/** Print CSS scoped to this route — letter page, exact colors, page breaks that
 * keep each figure whole. Kept inline (not in globals.css) so the brief owns its
 * own paper rules without touching shared styles. */
const PRINT_CSS = `
@page { size: letter; margin: 0.5in; }
@media print {
  html, body { background: #ffffff !important; }
  nav, footer, .no-print { display: none !important; }
  .bureau-noise::before { display: none !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .investment-brief { background: #ffffff !important; padding: 0 !important; }
  .brief-sheet { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; width: 100% !important; }
  /* Content flows naturally (keeps the brief to ~3–5 pages); a hard break is
     forced only before the two heaviest figures. Charts are single SVG elements
     that never split; a heading is never left orphaned at a page foot. */
  .brief-break-before { break-before: page; }
  .brief-figure { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  /* Tighten for paper: less air between sections and inside the reused cards. */
  .investment-brief section { margin-top: 0.7rem !important; }
  .investment-brief .p-5, .investment-brief .sm\\:p-6 { padding: 0.65rem !important; }
  /* The sankey's screen-reader fallback tables duplicate the Top Recipients,
     Funder Profiles, and Program-mix sections already printed here — drop the
     triplication so the flow keeps to one page (no data is lost). */
  .sankey-a11y-fallback { display: none !important; }
}
`;

/** A titled section wrapper — an editorial header + one-line description, kept
 * whole across a page break. */
function Section({
  title,
  description,
  breakBefore,
  children,
}: {
  title: string;
  description?: string;
  breakBefore?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`mt-8${breakBefore ? " brief-break-before" : ""}`}>
      <h2 className="font-editorial text-[24px] leading-tight text-[#0C1B33]">{title}</h2>
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
    // The login route only redirects within the /investment tree, so send a
    // human back to the on-screen analysis after auth; they can re-open /print
    // once the shared session cookie is set. (The export script sets the cookie
    // directly and never relies on this redirect.)
    return <InvestmentLoginForm redirectTo={`/investment/${area}`} hasAuthError={hasAuthError} />;
  }

  const name = resolveArea(area);
  if (!name) notFound();

  const analysis = loadInvestmentAnalysis(name);
  const meta = loadCommunityInvestment()?.meta;
  const sources = meta?.sources ?? [];
  const flow = loadFunderFlow(name);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <main className="investment-brief min-h-screen bg-[#E9E7E1] px-4 py-8 text-[#0C1B33] print:p-0">
        <div className="brief-sheet mx-auto max-w-[7.5in] bg-white p-8 shadow-sm sm:p-10">
          <p className="no-print mb-6 text-[11px] leading-relaxed text-[#0C1B33]/45">
            Print or Save as PDF (letter, background graphics on) — or generate it headless with{" "}
            <code>scripts/export-investment-brief.ts</code>.
          </p>

          {!analysis ? (
            <div className="border border-[#0C1B33]/10 bg-white p-6 text-[14px] text-[#0C1B33]/55">
              No grants, awards, or development have been recorded in {name} since 2020 in this dataset.
            </div>
          ) : (
            <>
              {/* Masthead */}
              <header className="brief-figure border-b-2 border-[#0C1B33] pb-5">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
                    Chicago Incentive Explorer · Investment &amp; Impact
                  </span>
                  <span className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
                    As of {formatAsOf(analysis.generatedAt)}
                  </span>
                </div>
                <h1 className="mt-3 font-editorial text-[46px] leading-none">{name}</h1>
                <p className="mt-2 font-editorial text-[20px] italic text-[#0C1B33]/70">
                  Community Investment Brief
                </p>
              </header>

              {/* Hero total */}
              <div className="brief-figure mt-6">
                <HeroStat
                  total={analysis.totalAwarded}
                  recordCount={analysis.recordCount}
                  spanMax={analysis.span?.max ?? null}
                  eyebrow="Awarded since 2020"
                  animate={false}
                />
              </div>

              <Section
                title="Where the money came from"
                description="Awarded dollars by funder type — government programs, private foundations, and private development."
              >
                <FunderDonut byFunderType={analysis.byFunderType} total={analysis.totalAwarded} />
              </Section>

              {/* The two bar charts scale cleanly to half width — pair them so the
                  brief stays compact on paper. */}
              <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                <Section
                  title="When it arrived"
                  description="Awarded dollars by year, 2020 to the latest on record."
                >
                  <YearBars byYear={analysis.byYear} unYeared={analysis.unYeared} />
                </Section>

                <Section
                  title="Through which programs"
                  description="Awarded dollars by funding program. Development projects are counted, not dollared."
                >
                  <SourceBars bySource={analysis.bySource} />
                </Section>
              </div>

              <Section
                title="How the money flowed"
                description="Awarded dollars from funders, through programs, to the recipients on record since 2020."
              >
                <FunderFlowSankey communityArea={name} flow={flow} />
              </Section>

              <Section title="Top recipients" description="The largest single awards on record since 2020.">
                <TopRecipientsTable recipients={analysis.topRecipients} />
              </Section>

              <Section
                title="Funder profiles"
                description="The funders putting the most dollars into this community."
              >
                <TopFunders funders={analysis.topFunders} />
              </Section>

              <Section title="How it compares">
                <EquityContext
                  communityArea={name}
                  totalAwarded={analysis.totalAwarded}
                  equity={analysis.equity}
                />
              </Section>

              <Section title="Methodology">
                <Methodology sources={sources} generatedAt={analysis.generatedAt} />
              </Section>

              <p className="mt-8 border-t border-[#0C1B33]/10 pt-4 font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-[#0C1B33]/40">
                Chicago Incentive Explorer · Community Investment Brief · {name} · As of{" "}
                {formatAsOf(analysis.generatedAt)}
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
