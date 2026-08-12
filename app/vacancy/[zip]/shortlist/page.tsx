/**
 * SITE SHORTLIST — the back half of the /locate Site Matchmaker.
 *
 * The wizard used to dead-end at the raw property map: a reader described a
 * project and got a pin cloud. This route turns the same criteria into a
 * ranked, tiered, enriched list of specific candidate records.
 *
 * Server component, static-first: the edition, the rail stations, and the zone
 * overlays are all read from committed files here, the scoring runs in the pure
 * lib, and the only request-time work is the finalist enrichment the client
 * island fires for the cards that actually render.
 *
 * The overlay point-in-polygon pass is the expensive step, so it runs on the
 * top OVERLAY_ENRICH_LIMIT screened candidates only — comfortably more than the
 * twenty that can be rendered, so the overlay weight can still reorder the
 * shown set.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { getVacancyIndexEdition, loadVacancyIndex } from "@/lib/vacancy-index";
import { railStations } from "@/lib/rail-stations";
import { checkStaticZoneKeys } from "@/lib/zones-check";
import { resolveZoneClasses } from "@/lib/zoning-point-lookup";
import {
  OVERLAY_ENRICH_LIMIT,
  ZONING_SCREENING_NOTE,
  assembleShortlist,
  screenShortlistSites,
  type ShortlistOverlay,
} from "@/lib/site-shortlist";
import {
  buildSiteMatchmakerHref,
  decodeSiteMatchCriteria,
  isSiteMatchCriteriaReady,
  summarizeSiteMatchCriteria,
} from "@/lib/site-matchmaker";
import SiteShortlistResults from "@/components/vacancy/SiteShortlistResults";

export const dynamic = "force-dynamic";

/** The four overlays a shortlist card reports, with their rendered labels. The
 *  TIF layer is listed but never scored (a financing geography is not a demand
 *  signal — see scoredOverlayCount). */
const OVERLAY_LAYERS: { key: string; label: string }[] = [
  { key: "ssa", label: "SSA" },
  { key: "ccsa", label: "CCSA" },
  { key: "tif", label: "TIF" },
  { key: "nof", label: "NOF" },
];

/** The canonical `sm_*` criteria parameters, plus the ZIP from the route. */
const CRITERIA_PARAMS = [
  "sm_use",
  "sm_property",
  "sm_min_sqft",
  "sm_max_sqft",
  "sm_context",
  "sm_transport",
  "sm_transport_distance",
  "sm_walkability",
  "sm_pedestrian_activity",
  "sm_amenities",
] as const;

type ShortlistSearchParams = Record<string, string | string[] | undefined>;

function criteriaParams(zip: string, raw: ShortlistSearchParams): URLSearchParams {
  const params = new URLSearchParams({ zip });
  for (const key of CRITERIA_PARAMS) {
    const value = raw[key];
    if (Array.isArray(value)) for (const item of value) params.append(key, item);
    else if (value != null) params.set(key, value);
  }
  return params;
}

function firstParam(value: string | string[] | undefined): string | null {
  const result = Array.isArray(value) ? value[0] : value;
  return result?.trim() || null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zip: string }>;
}): Promise<Metadata> {
  const { zip } = await params;
  const entry = getPilotZipEntry(zip);
  if (!entry) return { title: "Site Shortlist" };
  return {
    title: `Site shortlist — ${entry.primaryNeighborhood} (ZIP ${zip})`,
    description: `A ranked, tiered shortlist of candidate vacant records in ${entry.primaryNeighborhood} (ZIP ${zip}), screened against your project criteria. Early possibilities from public records, not availability listings.`,
  };
}

/** The shared page chrome, so every state (empty, uncovered, results) reads as
 *  the same document rather than three different pages. */
function Shell({ zip, children }: { zip: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-6 flex flex-wrap items-center gap-1.5 font-mono-bureau text-[12px] text-[#0C1B33]/50">
          <Link href="/locate" className="hover:text-[#2563EB]">
            Site Matchmaker
          </Link>
          <span>/</span>
          <Link href={`/vacancy/${zip}`} className="hover:text-[#2563EB]">
            ZIP {zip}
          </Link>
          <span>/</span>
          <span className="text-[#0C1B33]/80">Shortlist</span>
        </nav>
        {children}
      </div>
    </div>
  );
}

export default async function SiteShortlistPage({
  params,
  searchParams,
}: {
  params: Promise<{ zip: string }>;
  searchParams: Promise<ShortlistSearchParams>;
}) {
  const { zip } = await params;
  const pilotEntry = getPilotZipEntry(zip);
  if (!pilotEntry) notFound();

  const raw = await searchParams;
  const criteria = decodeSiteMatchCriteria(criteriaParams(zip, raw));
  const source = firstParam(raw.source);
  const neighborhood = pilotEntry.primaryNeighborhood;

  // ── No usable criteria: send the reader back to build a brief ─────────────
  if (!isSiteMatchCriteriaReady(criteria)) {
    return (
      <Shell zip={zip}>
        <h1 className="font-editorial text-[42px] leading-[0.96] sm:text-[52px]">
          Site shortlist
        </h1>
        <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#0C1B33]/60">
          A shortlist needs a project brief to screen against — at minimum an area, a project use,
          and a property type. Build one in the Site Matchmaker and the ranked shortlist for{" "}
          {neighborhood} will open from there.
        </p>
        <Link
          href={buildSiteMatchmakerHref({ ...criteria, zip })}
          className="mt-6 inline-flex min-h-11 items-center gap-2 bg-[#2563EB] px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
        >
          Describe your project in the Site Matchmaker →
        </Link>
      </Shell>
    );
  }

  const summary = summarizeSiteMatchCriteria(criteria);
  const adjustHref = buildSiteMatchmakerHref(criteria);
  const edition = getVacancyIndexEdition(zip);

  // ── ZIP without a published edition: the same honest state as its siblings ──
  if (!edition) {
    return (
      <Shell zip={zip}>
        <h1 className="font-editorial text-[42px] leading-[0.96] sm:text-[52px]">
          Site shortlist
        </h1>
        <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#0C1B33]/60">
          The vacancy edition for {neighborhood} (ZIP {zip}) is not yet available, so no candidate
          records can be screened. Read the{" "}
          <Link href={`/vacancy/${zip}/report`} className="text-[#2563EB] hover:underline">
            full vacancy report
          </Link>{" "}
          for what public records currently show, or{" "}
          <Link href={adjustHref} className="text-[#2563EB] hover:underline">
            choose another area
          </Link>
          .
        </p>
      </Shell>
    );
  }

  // ── Screen, overlay-enrich the top slice, assemble ────────────────────────
  const { candidates, stats } = screenShortlistSites(
    edition.sitePoints,
    criteria,
    railStations(),
  );
  const finalists = candidates.slice(0, OVERLAY_ENRICH_LIMIT);

  // The vacancy export leaves `zoningClass` null on every vacant-BUILDING
  // point, so the by-right tier split would never split without this. Finalists
  // only, and an unresolved point simply stays "zoning unverified" (Tier 2) —
  // the exact behavior a City outage would produce anyway. See
  // lib/zoning-point-lookup.ts for why this cannot be served statically.
  const resolvedZoning = await resolveZoneClasses(
    finalists
      .filter((site) => !site.zoning)
      .map((site) => ({ key: site.key, lat: site.lat, lon: site.lon })),
  );

  const withOverlays = await Promise.all(
    finalists.map(async (base) => {
      const site = base.zoning
        ? base
        : { ...base, zoning: resolvedZoning.get(base.key) ?? null };
      const matches = await checkStaticZoneKeys(
        site.lat,
        site.lon,
        OVERLAY_LAYERS.map((layer) => layer.key),
      ).catch(() => []);
      const overlays: ShortlistOverlay[] = matches.map((match) => ({
        layer: OVERLAY_LAYERS.find((layer) => layer.key === match.key)?.label ?? match.key,
        name: match.name ?? "",
      }));
      return { site, overlays };
    }),
  );
  const result = assembleShortlist(withOverlays, criteria);
  const total = result.tier1.length + result.tier2.length;

  const generatedAt = loadVacancyIndex()?.generatedAt ?? null;
  const chips = [
    summary.projectUse,
    summary.propertyType,
    summary.footprint,
    summary.transportation,
    summary.transportationDistance,
  ].filter((chip) => chip && !/not selected$|^Flexible /.test(chip));

  return (
    <Shell zip={zip}>
      <header>
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Site shortlist · {summary.location}
        </span>
        <h1 className="mt-3 font-editorial text-[42px] leading-[0.96] sm:text-[54px]">
          {total > 0
            ? `${total} candidate ${total === 1 ? "record" : "records"} in ${neighborhood}`
            : `No records match this brief in ${neighborhood}`}
        </h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[#0C1B33]/60">
          Screened from this area&rsquo;s tracked vacant-property inventory against your brief, then
          ranked. These are early possibilities from public records, not availability listings — no
          record here is offered for sale or lease.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <span
              key={chip}
              className="border border-[#0C1B33]/15 bg-white px-2.5 py-1 font-mono-bureau text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/60"
            >
              {chip}
            </span>
          ))}
          <Link
            href={adjustHref}
            className="border border-[#2563EB] px-2.5 py-1 font-mono-bureau text-[10px] uppercase tracking-[0.06em] text-[#2563EB] transition-colors hover:bg-[#2563EB] hover:text-white"
          >
            Adjust criteria
          </Link>
        </div>

        <p className="mt-4 max-w-2xl border-l-2 border-[#A45B00]/40 pl-3 text-[12px] leading-relaxed text-[#A45B00]">
          {ZONING_SCREENING_NOTE}
        </p>
      </header>

      {total === 0 ? (
        <section className="mt-8 border border-[#0C1B33]/12 bg-white p-6">
          <h2 className="font-editorial text-[22px] leading-tight">Nothing cleared the screens</h2>
          <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-[#0C1B33]/65">
            {stats.propertyTypeKeptCount.toLocaleString("en-US")} of{" "}
            {stats.loadedCount.toLocaleString("en-US")} tracked records matched the property type
            you chose
            {stats.propertyTypeKeptCount > 0 && (
              <>
                , and {stats.footprintKeptCount.toLocaleString("en-US")} of those carried a
                published measurement inside your size band
              </>
            )}
            {stats.railScreenMeters != null && (
              <>
                {" "}
                before the {stats.railScreenMeters}-metre rail screen was applied
              </>
            )}
            . Widening the size band, or setting the transportation distance to flexible, is usually
            the fastest way to open the field.
          </p>
          <Link
            href={adjustHref}
            className="mt-5 inline-flex min-h-11 items-center bg-[#2563EB] px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
          >
            Adjust the criteria →
          </Link>
        </section>
      ) : (
        <SiteShortlistResults
          zip={zip}
          projectUse={criteria.projectUse}
          source={source}
          result={result}
          // The map panel draws the same simplified ZIP ring the vacancy web
          // report uses; both read it from the committed edition, so the two
          // maps can never outline different geographies for the same ZIP.
          boundary={edition.boundary}
          centroid={edition.centroid}
        />
      )}

      <footer className="mt-12 border-t border-[#0C1B33]/10 pt-6">
        <p className="max-w-3xl text-[11px] leading-relaxed text-[#0C1B33]/45">
          Screened from the tracked vacant-property inventory published in this area&rsquo;s vacancy
          edition
          {generatedAt ? ` (snapshot ${String(generatedAt).slice(0, 10)})` : ""}. Sources: City of
          Chicago vacant-building and City-owned land records, Cook County Assessor parcel,
          valuation, and tax-sale data, City of Chicago zoning districts and BACP business licenses,
          CTA and Metra station locations, and the Special Service Area, CCSA corridor, TIF, and
          Neighborhood Opportunity Fund geographies mapped in this repository. Ownership is a
          taxpayer-record classification and is unverified — owner TYPE only, never owner names.
          Zoning is screened from the district code and is not a determination. Records indicate;
          verify current ownership, zoning, condition, and status with the county and the
          responsible City department before relying on any of it.
        </p>
      </footer>
    </Shell>
  );
}
