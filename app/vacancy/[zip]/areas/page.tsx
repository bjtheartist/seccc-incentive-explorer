import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { loadVacancyIndex } from "@/lib/vacancy-index";
import {
  approxSqft,
  deriveOpportunityAreas,
  type OpportunityArea,
} from "@/lib/vacancy-opportunity-areas";
import { VacancySubNav } from "@/components/vacancy/VacancySubNav";
import { OPPORTUNITY_AREA_DISCLAIMER } from "@/lib/vacancy-public-labels";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zip: string }>;
}): Promise<Metadata> {
  const { zip } = await params;
  const entry = getPilotZipEntry(zip);
  if (!entry) return { title: "Opportunity Areas" };
  return {
    title: `${entry.primaryNeighborhood} opportunity areas (ZIP ${zip})`,
    description: `Groups of nearby vacant properties in ${entry.primaryNeighborhood} (ZIP ${zip}) worth investigating together. Early possibilities from public records, not availability listings.`,
  };
}

function areaSize(area: OpportunityArea): string {
  if (area.combinedKnownSqft <= 0) return "Size not recorded";
  const base = `about ${approxSqft(area.combinedKnownSqft).toLocaleString("en-US")} sq ft`;
  return area.sqftUnknownCount > 0 ? `${base} (size partly unknown)` : base;
}

function landBuildingMix(area: OpportunityArea): string {
  const parts: string[] = [];
  if (area.vacantLandCount > 0) parts.push(`${area.vacantLandCount} land`);
  if (area.vacantBuildingCount > 0) {
    parts.push(`${area.vacantBuildingCount} ${area.vacantBuildingCount === 1 ? "building" : "buildings"}`);
  }
  return parts.join(" · ");
}

/**
 * Opportunity Areas index — curated cards for the proximity clusters worth
 * investigating together (public, place-led). Derived at render time from the
 * committed vacancy-index. Grouped by GEOGRAPHY only; ownership never groups an
 * area and never appears as a name.
 */
export default async function OpportunityAreasPage({
  params,
}: {
  params: Promise<{ zip: string }>;
}) {
  const { zip } = await params;
  const pilotEntry = getPilotZipEntry(zip);
  if (!pilotEntry) notFound();

  const exportData = loadVacancyIndex();
  const edition = exportData?.editions[zip] ?? null;
  const { areas, hiddenCount } = edition
    ? deriveOpportunityAreas(edition)
    : { areas: [], hiddenCount: 0 };

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <VacancySubNav zip={zip} active="areas" />

        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Opportunity Areas
        </span>
        <h1 className="mt-3 font-editorial text-[38px] leading-none sm:text-[48px]">
          {pilotEntry.primaryNeighborhood}
        </h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[#0C1B33]/60">
          Groups of nearby properties worth investigating together. These are early possibilities,
          not availability listings.
        </p>
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/45">
          {OPPORTUNITY_AREA_DISCLAIMER}
        </p>

        {areas.length === 0 ? (
          <div className="mt-8 border border-dashed border-[#0C1B33]/20 bg-white px-4 py-8 text-center">
            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
              No opportunity areas yet
            </span>
            <p className="mt-2 text-[12px] text-[#0C1B33]/45">
              No proximity cluster in this edition reached the minimum size to surface as an area.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
              {areas.map((area) => (
                <div
                  key={area.clusterId}
                  className="flex flex-col border border-[#0C1B33]/10 bg-white p-5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-editorial text-[24px] leading-tight text-[#0C1B33]">
                      {area.name}
                    </h2>
                    <span className="flex-shrink-0 font-mono-bureau text-[11px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
                      {area.siteCount} sites
                    </span>
                  </div>
                  {area.corridorContext && (
                    <p className="mt-1 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
                      {area.corridorContext} corridor context
                    </p>
                  )}
                  <p className="mt-2 font-mono-bureau text-[11px] text-[#0C1B33]/55">
                    {areaSize(area)}
                    {landBuildingMix(area) ? ` · ${landBuildingMix(area)}` : ""}
                  </p>

                  <dl className="mt-4 space-y-2.5 text-[12px] leading-snug">
                    <div>
                      <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                        Could support
                      </dt>
                      <dd className="mt-0.5 text-[#0C1B33]/80">{area.scenarios[0]}</dd>
                    </div>
                    {area.standoutReasons.length > 0 && (
                      <div>
                        <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                          Why it stands out
                        </dt>
                        <dd className="mt-0.5 text-[#0C1B33]/80">
                          {area.standoutReasons.join(" · ")}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                        Needs checking
                      </dt>
                      <dd className="mt-0.5 text-[#0C1B33]/80">{area.needsChecking[0]}</dd>
                    </div>
                  </dl>

                  <div className="mt-5 flex flex-wrap items-center gap-4 pt-1">
                    <Link
                      href={`/vacancy/${zip}/areas/${area.clusterId}`}
                      className="font-mono-bureau text-[11px] uppercase tracking-[0.1em] text-[#2563EB] hover:underline"
                    >
                      View file →
                    </Link>
                    <Link
                      href={`/vacancy/${zip}/map`}
                      className="font-mono-bureau text-[11px] uppercase tracking-[0.1em] text-[#0C1B33]/55 hover:text-[#2563EB]"
                    >
                      Show on map
                    </Link>
                  </div>
                </div>
              ))}
            </div>
            {hiddenCount > 0 && (
              <p className="mt-4 font-mono-bureau text-[11px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
                + {hiddenCount} more {hiddenCount === 1 ? "area" : "areas"} shown on the{" "}
                <Link href={`/vacancy/${zip}/map`} className="text-[#2563EB] hover:underline">
                  property map
                </Link>
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
