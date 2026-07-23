import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { loadVacancyIndex } from "@/lib/vacancy-index";
import { loadCorridorRings } from "@/lib/vacancy-corridor-rings";
import VacancyMapIsland from "@/components/vacancy/VacancyMapIsland";
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
  if (!entry) return { title: "Property Map" };
  return {
    title: `${entry.primaryNeighborhood} property map (ZIP ${zip})`,
    description: `Interactive map of tracked vacant sites in ${entry.primaryNeighborhood} (ZIP ${zip}). Early possibilities from public records, not availability listings.`,
  };
}

/**
 * Property Map view — a full-height page mounting the EXISTING report map
 * island (no map-engine changes beyond the redesigned site card). Public.
 */
export default async function VacancyMapPage({
  params,
}: {
  params: Promise<{ zip: string }>;
}) {
  const { zip } = await params;
  const pilotEntry = getPilotZipEntry(zip);
  if (!pilotEntry) notFound();

  const exportData = loadVacancyIndex();
  const edition = exportData?.editions[zip] ?? null;

  const asOf = exportData?.generatedAt
    ? new Date(exportData.generatedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <VacancySubNav zip={zip} active="map" />

        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Property Map
        </span>
        <h1 className="mt-3 font-editorial text-[38px] leading-none sm:text-[48px]">
          {pilotEntry.primaryNeighborhood} — tracked vacant sites
        </h1>
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/45">
          {OPPORTUNITY_AREA_DISCLAIMER}
        </p>

        {edition ? (
          <div className="mt-6">
            <VacancyMapIsland
              zip={zip}
              boundary={edition.boundary}
              bbox={edition.boundary?.bbox ?? null}
              centroid={edition.centroid}
              sitePoints={edition.sitePoints}
              siteIndex={edition.siteIndex}
              totalCount={edition.headline.vacantPropertyCount}
              landPoints={edition.landPoints ?? null}
              landPointsTruncated={edition.landPointsTruncated ?? false}
              landPointsTotal={edition.landPointsTotal ?? null}
              asOf={asOf}
              neighborhood={pilotEntry.primaryNeighborhood}
              clusters={edition.clusters ?? null}
              corridors={loadCorridorRings(edition.corridors ?? null)}
              anchors={edition.anchors ?? null}
            />
          </div>
        ) : (
          <div className="mt-6 border border-dashed border-[#0C1B33]/20 bg-white px-4 py-8 text-center">
            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
              Map not yet available
            </span>
          </div>
        )}
      </div>
    </main>
  );
}
