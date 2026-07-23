import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { loadVacancyIndex } from "@/lib/vacancy-index";
import VacancyDirectory from "@/components/vacancy/VacancyDirectory";
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
}: {
  params: Promise<{ zip: string }>;
}) {
  const { zip } = await params;
  const pilotEntry = getPilotZipEntry(zip);
  if (!pilotEntry) notFound();

  const exportData = loadVacancyIndex();
  const edition = exportData?.editions[zip] ?? null;
  const directoryCount = edition?.directoryCount ?? 0;

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
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
    </main>
  );
}
