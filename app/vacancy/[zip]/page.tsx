import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { buildCaseRecords } from "@/lib/vacancy-cases-data";
import { getVacancyIndexEdition } from "@/lib/vacancy-index";
import { isLandUniverseTruncated } from "@/lib/vacancy-cases";
import {
  parseWorkspaceBounds,
  parseWorkspaceQuery,
  parseWorkspaceUniverse,
  parseWorkspaceView,
} from "@/lib/vacancy-workspace";
import { VacancySubNav } from "@/components/vacancy/VacancySubNav";
import CaseWorkspace from "@/components/vacancy/CaseWorkspace";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zip: string }>;
}): Promise<Metadata> {
  const { zip } = await params;
  const entry = getPilotZipEntry(zip);
  if (!entry) return { title: "Find Vacant Sites" };
  return {
    title: `Find Vacant Sites — ${entry.primaryNeighborhood} (ZIP ${zip})`,
    description: `Search tracked public vacancy records in ${entry.primaryNeighborhood} (ZIP ${zip}), then open property sources or continue into an analysis. Early possibilities from public records, not availability listings.`,
  };
}

export default async function CaseWorkbenchPage({
  params,
  searchParams,
}: {
  params: Promise<{ zip: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { zip } = await params;
  const pilotEntry = getPilotZipEntry(zip);
  if (!pilotEntry) notFound();

  const [{ records, recordsAsOf, universe }, resolvedParams] = await Promise.all([
    Promise.resolve(buildCaseRecords(zip)),
    searchParams,
  ]);
  const initialView = parseWorkspaceView(resolvedParams.view);
  const initialUniverse = parseWorkspaceUniverse(resolvedParams.universe);
  const initialQuery = parseWorkspaceQuery(resolvedParams.q);
  const initialBounds = parseWorkspaceBounds(resolvedParams.bounds);
  const landTruncated = isLandUniverseTruncated(universe);
  const neighborhood = pilotEntry.primaryNeighborhood;
  // Geography for the preview map — the SAME edition boundary/centroid the
  // property map page (/vacancy/[zip]/map) feeds VacancyReportMap. Records and
  // edition come from one cached load, so this costs nothing extra; a missing
  // edition renders the map without a boundary rather than failing.
  const edition = getVacancyIndexEdition(zip);

  // Honest empty state — the edition/export is not available for this ZIP.
  if (records.length === 0) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
        <div className="mx-auto max-w-5xl">
          <VacancySubNav zip={zip} active="workbench" />
          <h1 className="font-editorial text-[44px] leading-none">Find vacant sites</h1>
          <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-[#0C1B33]/50">
            The vacancy edition for {neighborhood} (ZIP {zip}) is not yet available, so no property
            records can be shown. Read the{" "}
            <Link href={`/vacancy/${zip}/report`} className="text-[#2563EB] hover:underline">
              full vacancy report
            </Link>{" "}
            for what public records currently show.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <VacancySubNav zip={zip} active="workbench" />

        {/* Editorial header */}
        <div className="max-w-2xl">
          <h1 className="font-editorial text-[46px] leading-[0.95] sm:text-[60px]">
            Find vacant sites
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[#0C1B33]/60">
            Search the tracked public records in one list or map. Select a property to open its
            county sources or carry it into an analysis.
          </p>
          {recordsAsOf && (
            <p className="mt-3 font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/40">
              Public records as of {recordsAsOf}
            </p>
          )}
        </div>

        <CaseWorkspace
          key={zip}
          zip={zip}
          neighborhood={neighborhood}
          records={records}
          boundary={edition?.boundary ?? null}
          centroid={edition?.centroid ?? null}
          initialView={initialView}
          initialUniverse={initialUniverse}
          initialQuery={initialQuery}
          initialBounds={initialBounds}
        />

        <details className="mt-6 border border-[#0C1B33]/10 bg-white px-5 py-4">
          <summary className="cursor-pointer font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#2563EB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
            How these records work
          </summary>
          <div className="mt-3 max-w-2xl space-y-2 text-[11px] leading-relaxed text-[#0C1B33]/50">
            <p>
              This inventory contains {universe.land.toLocaleString("en-US")} land{" "}
              {universe.land === 1 ? "parcel" : "parcels"} and{" "}
              {universe.building.toLocaleString("en-US")} reported{" "}
              {universe.building === 1 ? "building" : "buildings"} tracked in this ZIP.
            </p>
            <p>
              Land is the reconciled land universe: City land inventory and Assessor vacant-land
              parcels, deduplicated. It is wider than the{" "}
              <Link href={`/vacancy/${zip}/directory`} className="text-[#2563EB] hover:underline">
                All Properties directory
              </Link>
              , which lists tracked City-inventory and 311 records address by address.
            </p>
            {landTruncated && universe.landTotal != null && (
              <p className="border-l-2 border-[#A45B00]/40 pl-3 text-[#A45B00]">
                This edition publishes {universe.land.toLocaleString("en-US")} of the ZIP&rsquo;s{" "}
                {universe.landTotal.toLocaleString("en-US")} reconciled land parcels, so the land
                count is a floor, not a total. The{" "}
                <Link href={`/vacancy/${zip}/report`} className="underline">
                  full vacancy report
                </Link>{" "}
                carries the complete land-universe table.
              </p>
            )}
          </div>
        </details>

        {/* Footer note — honest framing consistent with the rest of the section */}
        <footer className="mt-12 border-t border-[#0C1B33]/10 pt-6">
          <p className="max-w-3xl text-[11px] leading-relaxed text-[#0C1B33]/45">
            Each record is a starting point built from public records — owner TYPE only, never owner
            names. Land parcels (the reconciled land universe) and reported vacant buildings (311
            service requests) are kept as separate counts and are never summed before parcel
            matching. Records indicate; verify current ownership, condition, and status with the
            county and the administering organization before relying.
          </p>
        </footer>
      </div>
    </div>
  );
}
