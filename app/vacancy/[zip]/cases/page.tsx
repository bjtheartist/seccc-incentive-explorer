import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { buildCaseRecords, initialStateFromParams } from "@/lib/vacancy-cases";
import VacancyCaseWorkbench from "@/components/vacancy/VacancyCaseWorkbench";
import { VacancySubNav } from "@/components/vacancy/VacancySubNav";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zip: string }>;
}): Promise<Metadata> {
  const { zip } = await params;
  const entry = getPilotZipEntry(zip);
  if (!entry) return { title: "Case workbench" };
  return {
    title: `Case workbench — ${entry.primaryNeighborhood} (ZIP ${zip})`,
    description: `Build a focused working case from tracked vacant properties in ${entry.primaryNeighborhood} (ZIP ${zip}). Early possibilities from public records, not availability listings.`,
  };
}

/**
 * Case Workbench route — production home of the app/vacancy/ux-lab/ interaction
 * prototype, generalized to all nine pilot ZIPs. `sel` (comma-joined record
 * ids) seeds the Compare shortlist server-side so a shared case link restores
 * it without a client round-trip; ids not in this ZIP's record set are
 * dropped by initialStateFromParams.
 */
export default async function VacancyCasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ zip: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { zip } = await params;
  const pilotEntry = getPilotZipEntry(zip);
  if (!pilotEntry) notFound();

  const { records, areas, recordsAsOf } = buildCaseRecords(zip);
  const resolvedParams = await searchParams;
  const initialState = initialStateFromParams(
    resolvedParams,
    records.map((record) => record.id),
  );

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <VacancySubNav zip={zip} active="cases" />

        <VacancyCaseWorkbench
          records={records}
          areas={areas}
          recordsAsOf={recordsAsOf}
          zip={zip}
          neighborhood={pilotEntry.primaryNeighborhood}
          initialState={initialState}
        />
      </div>
    </div>
  );
}
