import Link from "next/link";
import type { Metadata } from "next";
import { CHICAGO_COMMUNITY_AREAS } from "@/lib/community-areas";
import { loadInvestmentAnalysis, type CommunityInvestmentAnalysis } from "@/lib/investment-analysis";
import { CompareView } from "@/components/investment/CompareView";
import { ShowOnMapLink } from "@/components/investment/ShowOnMapLink";
import { getInvestmentAdminState, InvestmentLoginForm, InvestmentNotConfigured } from "../gate";

/**
 * /investment/compare — the side-by-side compare of 2–4 pinned community areas
 * (Sol #3). Pins live in the admin's localStorage (see PinControls); the
 * ComparePinBar hands them here as `?areas=A,B,C` (each encodeURIComponent'd), so
 * this page is a plain server render of whatever areas the URL names — no client
 * data fetching, full fs access to the committed analysis.
 *
 * Same Owner Files admin gate as the rest of /investment.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Investment & Impact — Compare",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** Resolve a slug to a canonical community-area name (case-insensitive), or null. */
function resolveArea(slug: string): string | null {
  const match = CHICAGO_COMMUNITY_AREAS.find((ca) => ca.name.toLowerCase() === slug.toLowerCase());
  return match ? match.name : null;
}

/** Parse `?areas=A,B,C` into canonical names — decoded, resolved, deduped, capped
 * to 4. Unknown names are dropped rather than 404-ing the whole compare. */
function parseAreas(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(",")) {
    let decoded = piece;
    try {
      decoded = decodeURIComponent(piece.trim());
    } catch {
      decoded = piece.trim();
    }
    const name = resolveArea(decoded);
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
      if (out.length >= 4) break;
    }
  }
  return out;
}

export default async function InvestmentComparePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const hasAuthError = paramValue(sp.error) === "1";

  const { configured, hasSession } = await getInvestmentAdminState();
  if (!configured) return <InvestmentNotConfigured />;
  if (!hasSession) return <InvestmentLoginForm redirectTo="/investment" hasAuthError={hasAuthError} />;

  const areas = parseAreas(paramValue(sp.areas));
  const analyses = areas
    .map((name) => loadInvestmentAnalysis(name))
    .filter((a): a is CommunityInvestmentAnalysis => a != null);

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-6xl">
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
            <span className="text-[#0C1B33]/80">Compare</span>
          </div>
          <Link href="/map" className="hover:text-[#2563EB]">
            Map
          </Link>
        </nav>

        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Investment &amp; Impact
        </span>
        <h1 className="mt-3 font-editorial text-[44px] leading-none sm:text-[56px]">Compare communities</h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[#0C1B33]/45">
          Documented awarded dollars, record count, median award, program mix, top funders, and the year trend —
          side by side. Raw dollars are not the equity verdict on their own; read them with the rank and the
          coverage caveats.
        </p>

        {analyses.length < 2 ? (
          <div className="mt-8 border border-[#0C1B33]/10 bg-white p-6 text-[14px] text-[#0C1B33]/55">
            Pin at least two community areas to compare. Use the{" "}
            <span className="font-medium text-[#0C1B33]/75">Pin to compare</span> control on any community&rsquo;s
            page or the ranked list, then choose <span className="font-medium text-[#0C1B33]/75">Compare</span>.
            <div className="mt-4">
              <Link href="/investment" className="font-mono-bureau text-[12px] uppercase tracking-[0.1em] text-[#2563EB]">
                ← All communities
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-8">
            <CompareView analyses={analyses} />
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/40">
                Show on map:
              </span>
              {analyses.map((a) => (
                <ShowOnMapLink key={a.communityArea} area={a.communityArea} label={`${a.communityArea} →`} />
              ))}
            </div>
            <p className="mt-6 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/35">
              Per-resident awarded dollars are withheld — this dataset has no community-area population join, so a
              per-capita figure would be fabricated. Awarded, announced, and tax-credit capital are separate
              measures, never summed.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
