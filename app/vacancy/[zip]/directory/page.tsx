import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { loadVacancyIndex } from "@/lib/vacancy-index";
import { opportunityAreaById } from "@/lib/vacancy-opportunity-areas";
import VacancyDirectory from "@/components/vacancy/VacancyDirectory";
import { VacancySubNav } from "@/components/vacancy/VacancySubNav";
import { OPPORTUNITY_AREA_DISCLAIMER } from "@/lib/vacancy-public-labels";

export const dynamic = "force-dynamic";

/** Parse a positive-integer `area` query param (first value, if repeated), or
 * null. Mirrors parseClusterId in app/vacancy/[zip]/areas/[clusterId]/page.tsx. */
function parseAreaParam(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zip: string }>;
}): Promise<Metadata> {
  const { zip } = await params;
  const entry = getPilotZipEntry(zip);
  if (!entry) return { title: "All Properties" };
  return {
    title: `${entry.primaryNeighborhood} vacant-property directory (ZIP ${zip})`,
    description: `Every tracked vacant property in ${entry.primaryNeighborhood} (ZIP ${zip}), with ownership type and public-record links. Anonymized — owner types only.`,
  };
}

/**
 * All Properties view — mounts the EXISTING VacancyDirectory component (every
 * tracked address, anonymized owner TYPE only). Public.
 */
export default async function VacancyDirectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ zip: string }>;
  searchParams: Promise<{ area?: string | string[] }>;
}) {
  const { zip } = await params;
  const { area } = await searchParams;
  const pilotEntry = getPilotZipEntry(zip);
  if (!pilotEntry) notFound();

  const exportData = loadVacancyIndex();
  const edition = exportData?.editions[zip] ?? null;
  const directoryCount = edition?.directoryCount ?? 0;

  // Opportunity-Area handoff (?area=<clusterId>): resolve the area's display
  // name server-side so the directory's banner never has to guess it.
  const requestedAreaId = parseAreaParam(area);
  const initialArea =
    requestedAreaId != null && edition ? opportunityAreaById(edition, requestedAreaId) : null;
  const initialAreaId = initialArea?.clusterId ?? null;
  const initialAreaName = initialArea?.name ?? null;

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <VacancySubNav zip={zip} active="directory" />

        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          All Properties
        </span>
        <h1 className="mt-3 font-editorial text-[38px] leading-none sm:text-[48px]">
          {pilotEntry.primaryNeighborhood} — every tracked address
        </h1>
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/45">
          {OPPORTUNITY_AREA_DISCLAIMER}
        </p>

        <div className="mt-6">
          {directoryCount > 0 ? (
            <VacancyDirectory
              zip={zip}
              neighborhood={pilotEntry.primaryNeighborhood}
              directoryCount={directoryCount}
              initialAreaId={initialAreaId}
              initialAreaName={initialAreaName}
            />
          ) : (
            <div className="border border-dashed border-[#0C1B33]/20 bg-white px-4 py-8 text-center">
              <span className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                Directory not yet available
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
