import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { loadVacancyIndex } from "@/lib/vacancy-index";
import { loadCorridorRings } from "@/lib/vacancy-corridor-rings";
import { opportunityAreaById } from "@/lib/vacancy-opportunity-areas";
import VacancyMapIsland from "@/components/vacancy/VacancyMapIsland";
import { VacancySubNav } from "@/components/vacancy/VacancySubNav";
import { OPPORTUNITY_AREA_DISCLAIMER } from "@/lib/vacancy-public-labels";
import { buildSiteMatchmakerHref } from "@/lib/site-matchmaker";
import {
  decodeSiteMatchmakerVacancyHandoff,
  prefilterVacancyRecords,
} from "@/lib/site-matchmaker-vacancy";

export const dynamic = "force-dynamic";

/** Defect B: parse the `?area=` deep link (from a Revitalization File's "Show
 *  these sites on the property map" link) into a positive integer cluster id.
 *  Anything else — missing, non-numeric, an array, zero/negative — resolves
 *  to `null` and the page silently falls back to the unfocused map. */
function parseAreaParam(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type VacancyMapSearchParams = Record<string, string | string[] | undefined>;

function toUrlSearchParams(values: VacancyMapSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value != null) {
      params.set(key, value);
    }
  }
  return params;
}

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
  searchParams,
}: {
  params: Promise<{ zip: string }>;
  searchParams: Promise<VacancyMapSearchParams>;
}) {
  const { zip } = await params;
  const rawSearchParams = await searchParams;
  const areaParam = rawSearchParams.area;
  const pilotEntry = getPilotZipEntry(zip);
  if (!pilotEntry) notFound();

  const exportData = loadVacancyIndex();
  const edition = exportData?.editions[zip] ?? null;
  const handoff = decodeSiteMatchmakerVacancyHandoff(
    zip,
    toUrlSearchParams(rawSearchParams),
  );

  const trackedPrefilter =
    edition && handoff
      ? prefilterVacancyRecords(edition.sitePoints, handoff.criteria, {
          propertyType: (record) => record.propertyType,
          squareFeet: (record) => record.squareFeet,
        })
      : null;
  const landPrefilter =
    edition?.landPoints && handoff
      ? prefilterVacancyRecords(edition.landPoints, handoff.criteria, {
          propertyType: () => "vacant_land",
          squareFeet: (record) => record.squareFeet,
        })
      : null;

  const plottedSitePoints = trackedPrefilter?.records ?? edition?.sitePoints ?? [];
  const plottedLandPoints = landPrefilter?.records ?? edition?.landPoints ?? null;
  const plottedMarkerNumbers = new Set(
    plottedSitePoints.flatMap((record) =>
      record.markerNumber == null ? [] : [record.markerNumber],
    ),
  );
  const plottedSiteIndex =
    edition && handoff
      ? edition.siteIndex.filter(
          (record) =>
            record.markerNumber == null || plottedMarkerNumbers.has(record.markerNumber),
        )
      : edition?.siteIndex ?? [];

  const asOf = exportData?.generatedAt
    ? new Date(exportData.generatedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";

  // Defect B: resolve the ?area= deep link against this edition's kept
  // clusters. An id that doesn't resolve (bad param, or an area outside the
  // kept clusters) is ignored gracefully — the map just renders unfocused.
  const requestedAreaId = parseAreaParam(areaParam);
  const focusedArea =
    edition && requestedAreaId != null ? opportunityAreaById(edition, requestedAreaId) : null;
  const initialAreaId = focusedArea?.clusterId ?? null;

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <VacancySubNav zip={zip} active="map" />

        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Property Map
        </span>
        <h1 className="mt-3 font-editorial text-[38px] leading-none sm:text-[48px]">
          {pilotEntry.primaryNeighborhood} — tracked vacant sites
        </h1>
        {focusedArea ? (
          <p className="mt-2 text-[12px] leading-relaxed text-[#0C1B33]/55">
            Focused on {focusedArea.name} — {focusedArea.siteCount.toLocaleString("en-US")} sites ·{" "}
            <Link href={`/vacancy/${zip}/map`} className="text-[#2563EB] hover:underline">
              Show all sites
            </Link>
          </p>
        ) : null}
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/45">
          {OPPORTUNITY_AREA_DISCLAIMER}
        </p>

        {handoff && trackedPrefilter ? (
          <section
            aria-labelledby="site-matchmaker-handoff-title"
            className="mt-5 border border-[#0C1B33]/15 bg-white px-4 py-4 sm:px-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#2563EB]">
                  Site Matchmaker handoff
                </p>
                <h2
                  id="site-matchmaker-handoff-title"
                  className="mt-1 text-[16px] font-semibold text-[#0C1B33]"
                >
                  Criteria carried into this map
                </h2>
              </div>
              <Link
                href={buildSiteMatchmakerHref(handoff.criteria)}
                className="border border-[#0C1B33]/20 px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/65 hover:border-[#2563EB] hover:text-[#2563EB]"
              >
                Edit criteria
              </Link>
            </div>

            <div className="mt-4 grid gap-4 border-t border-[#0C1B33]/10 pt-4 md:grid-cols-2">
              <div>
                <p className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
                  Applied where records support it
                </p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] leading-relaxed">
                  <dt className="text-[#0C1B33]/45">Property</dt>
                  <dd className="font-medium text-[#0C1B33]">{handoff.summary.propertyType}</dd>
                  <dt className="text-[#0C1B33]/45">Footprint</dt>
                  <dd className="font-medium text-[#0C1B33]">{handoff.summary.footprint}</dd>
                </dl>
                <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/55">
                  Tracked inventory: {trackedPrefilter.keptCount.toLocaleString("en-US")} of{" "}
                  {trackedPrefilter.loadedCount.toLocaleString("en-US")} loaded records plotted.
                  {landPrefilter
                    ? ` Reconciled vacant land: ${landPrefilter.keptCount.toLocaleString("en-US")} of ${landPrefilter.loadedCount.toLocaleString("en-US")} loaded parcels plotted.`
                    : ""}
                </p>
                {handoff.footprintBoundActive ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/55">
                    Published dimensions place{" "}
                    {trackedPrefilter.confirmedFootprintCount.toLocaleString("en-US")} tracked
                    records inside the requested footprint. Another{" "}
                    {trackedPrefilter.unassessedUnknownSizeCount.toLocaleString("en-US")} tracked
                    records
                    {landPrefilter
                      ? ` and ${landPrefilter.unassessedUnknownSizeCount.toLocaleString("en-US")} reconciled land parcels`
                      : ""}
                    {" "}remain plotted as unassessed leads because their dimensions are not published.
                  </p>
                ) : null}
              </div>

              <div>
                <p className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
                  Visible for local review only
                </p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] leading-relaxed">
                  <dt className="text-[#0C1B33]/45">Project use</dt>
                  <dd className="text-[#0C1B33]">{handoff.summary.projectUse}</dd>
                  <dt className="text-[#0C1B33]/45">Context</dt>
                  <dd className="text-[#0C1B33]">{handoff.summary.context}</dd>
                  <dt className="text-[#0C1B33]/45">Transportation</dt>
                  <dd className="text-[#0C1B33]">{handoff.summary.transportation}</dd>
                  <dt className="text-[#0C1B33]/45">Transport distance</dt>
                  <dd className="text-[#0C1B33]">{handoff.summary.transportationDistance}</dd>
                  <dt className="text-[#0C1B33]/45">Walkability</dt>
                  <dd className="text-[#0C1B33]">{handoff.summary.walkability}</dd>
                  <dt className="text-[#0C1B33]/45">Pedestrian activity</dt>
                  <dd className="text-[#0C1B33]">{handoff.summary.pedestrianActivity}</dd>
                  <dt className="text-[#0C1B33]/45">Amenities</dt>
                  <dd className="text-[#0C1B33]">{handoff.summary.amenities}</dd>
                </dl>
                <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/55">
                  These review criteria have not been verified against the plotted sites. This map
                  does not confirm availability or project suitability.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {edition ? (
          <div className="mt-6">
            <VacancyMapIsland
              key={initialAreaId ?? "all"}
              zip={zip}
              boundary={edition.boundary}
              bbox={edition.boundary?.bbox ?? null}
              centroid={edition.centroid}
              sitePoints={plottedSitePoints}
              siteIndex={plottedSiteIndex}
              totalCount={edition.headline.vacantPropertyCount}
              landPoints={plottedLandPoints}
              landPointsTruncated={edition.landPointsTruncated ?? false}
              landPointsTotal={edition.landPointsTotal ?? null}
              asOf={asOf}
              neighborhood={pilotEntry.primaryNeighborhood}
              clusters={edition.clusters ?? null}
              corridors={loadCorridorRings(edition.corridors ?? null)}
              anchors={edition.anchors ?? null}
              initialAreaId={initialAreaId}
              siteMatchmakerPrefilter={handoff != null}
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
    </div>
  );
}
