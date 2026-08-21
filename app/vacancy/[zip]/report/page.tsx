import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { ANALYTICS_ADMIN_COOKIE } from "@/lib/analytics-admin-auth";
import { PILOT_ZIPS, getPilotZipEntry } from "@/lib/pilot-zips";
import {
  MATRIX_METHOD_NOTE,
  editionGeographyNote,
  deriveLandUniverse,
  loadVacancyIndex,
} from "@/lib/vacancy-index";
import { buildVacancyIndexPdfInput } from "@/lib/vacancy-index-adapter";
import { clerkRecordsUrl, cookViewerUrl } from "@/lib/cook-viewer";
import {
  OWNER_TYPE_COLORS,
  OWNER_TYPE_LABELS,
  OWNER_TYPE_ORDER,
  normalizeOwnerType,
  type OwnerType,
} from "@/lib/owner-classify";
import {
  OWNER_GEOGRAPHY_LABELS,
  OWNER_GEOGRAPHY_ORDER,
  OWNER_STRUCTURE_ABBREV,
  OWNER_STRUCTURE_COLORS,
  OWNER_STRUCTURE_LABELS,
  OWNER_STRUCTURE_ORDER,
  normalizeOwnerStructure,
} from "@/lib/owner-taxonomy";
import type {
  VacancyPropertyType,
  VacancySiteIndexRow,
} from "@/lib/vacancy-index";
import VacancyMapIsland from "@/components/vacancy/VacancyMapIsland";
import VacancyClustersIsland from "@/components/vacancy/VacancyClustersIsland";
import { loadCorridorRings } from "@/lib/vacancy-corridor-rings";
import VacancyDirectory from "@/components/vacancy/VacancyDirectory";
import { exemptionReferralRowsForZip } from "@/lib/exemption-anomalies";
import { VacancyIndexPdfButton } from "@/components/owner-file/VacancyIndexPdfButton";
import { VacancySubNav } from "@/components/vacancy/VacancySubNav";
import { deriveOpportunityAreas } from "@/lib/vacancy-opportunity-areas";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zip: string }>;
}): Promise<Metadata> {
  const { zip } = await params;
  const entry = getPilotZipEntry(zip);
  if (!entry) return { title: "Vacancy report" };
  return {
    title: `${entry.primaryNeighborhood} vacancy report (ZIP ${zip})`,
    description: `Full vacancy-to-revitalization report for ${entry.primaryNeighborhood} (ZIP ${zip}) — tracked vacant land and buildings, reconciled land ownership, opportunity areas, and public-record context. Early possibilities, not availability listings.`,
  };
}

const DISTRESS_RED = "#DC2626";

const PROPERTY_TYPE_LABELS: Record<VacancyPropertyType, string> = {
  vacant_land: "Vacant Land",
  vacant_building: "Vacant Building",
};


/** One labeled horizontal owner-type bar row. */
function OwnerBar({
  ownerType,
  count,
  max,
}: {
  ownerType: OwnerType;
  count: number;
  max: number;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-[132px] flex-shrink-0 text-[12px] text-[#0C1B33]/70">
        {OWNER_TYPE_LABELS[ownerType]}
      </span>
      <div className="h-3 flex-1 bg-[#0C1B33]/5">
        <div
          className="h-3"
          style={{ width: `${pct}%`, backgroundColor: OWNER_TYPE_COLORS[ownerType], minWidth: count > 0 ? 2 : 0 }}
        />
      </div>
      <span className="w-[52px] flex-shrink-0 text-right font-mono-bureau text-[11px] text-[#0C1B33]/70">
        {count.toLocaleString("en-US")}
      </span>
    </div>
  );
}

/** A 1–5 quintile dot rating (filled/empty), or an em dash when the metric is
 *  unavailable for this edition. */
function DotRating({ dots }: { dots: number | null }) {
  if (dots == null) {
    return <span className="text-[#0C1B33]/30">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-[3px]" aria-label={`${dots} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className="inline-block h-[6px] w-[6px] rounded-full"
          style={{ backgroundColor: n <= dots ? "#0C1B33" : "transparent", border: "1px solid #0C1B33" }}
        />
      ))}
    </span>
  );
}

/** Ownership → action pathways (Billy's directive, verbatim). The tax-sale row
 *  uses the red-ring motif rather than a filled owner-type dot. */
const ACTION_PATHWAYS: Array<{ label: string; color: string; ring: boolean; actions: string }> = [
  {
    label: "City / Public",
    color: OWNER_TYPE_COLORS.city_public,
    ring: false,
    actions: "Disposition inquiry · CCLBA coordination · RFP · land assembly",
  },
  {
    label: "Local Private",
    color: OWNER_TYPE_COLORS.local_private,
    ring: false,
    actions: "Direct outreach · technical assistance · sale or development partnership",
  },
  {
    label: "Corporate / LLC",
    color: OWNER_TYPE_COLORS.corporate_llc,
    ring: false,
    actions: "Portfolio-level outreach · identify decision-maker · negotiate assembly",
  },
  {
    label: "Out-of-State Investor",
    color: OWNER_TYPE_COLORS.out_of_state,
    ring: false,
    actions: "Targeted outreach · acquisition interest · tax/code review",
  },
  {
    label: "Unknown",
    color: OWNER_TYPE_COLORS.unknown,
    ring: false,
    actions: "Title and taxpayer verification before outreach",
  },
  {
    label: "Tax-sale record on file",
    color: DISTRESS_RED,
    ring: true,
    actions: "Legal review · tax-sale monitoring · acquisition pathway assessment",
  },
];

/** The six closing steps of the 90-day corridor action agenda (verbatim). */
const CORRIDOR_AGENDA: string[] = [
  "Select 2–3 priority clusters",
  "Disposition conversations for public sites",
  "Outreach list for local + corporate owners",
  "Verify unknown / outdated records",
  "Match clusters with uses / developers / incentives",
  "Track identified → contacted → verified → assembled → activated",
];

export default async function VacancyReportPage({
  params,
}: {
  params: Promise<{ zip: string }>;
}) {
  const { zip } = await params;
  // Vacancy report is scoped to the nine pilot ZIPs only.
  if (!getPilotZipEntry(zip)) notFound();

  // ── Public page. Admin detection is retained SERVER-SIDE only to decide
  //    whether to render the parcel-level exemption referral table (rail 2 —
  //    that table stays admin-only even though the page is now public). A valid
  //    Owner Files OR analytics admin cookie satisfies the check; everyone else
  //    sees the public report without it. ──
  const cookieStore = await cookies();
  const hasSession =
    isOwnerFilesAdminConfigured() &&
    hasValidOwnerFilesAdminSession(
      cookieStore.get(OWNER_FILES_ADMIN_COOKIE)?.value,
      cookieStore.get(ANALYTICS_ADMIN_COOKIE)?.value,
    );

  // ── Load the edition + the shared adapter output ──
  const exportData = loadVacancyIndex();
  const edition = exportData?.editions[zip] ?? null;
  const pdfInput = exportData ? buildVacancyIndexPdfInput(exportData, zip) : null;
  const pilotEntry = getPilotZipEntry(zip)!;

  if (!exportData || !edition || !pdfInput) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6">
          <h1 className="font-editorial text-[38px]">Edition not yet available</h1>
          <p className="mt-3 text-[#0C1B33]/45">
            The Vacancy Opportunity Index export for {pilotEntry.primaryNeighborhood} (ZIP {zip})
            has not been generated yet. Run <code>npm run vacancy:index:export</code> to build it.
          </p>
        </div>
      </div>
    );
  }

  const { headline, ownership } = edition;
  const asOf = new Date(exportData.generatedAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // ── Scale-of-the-challenge headline measures (computed from headline counts) ──
  const total = pdfInput.counts.total;
  const cityOwned = pdfInput.counts.cityOwned;
  // Non-city tracked records — in practice the 311-reported vacant buildings,
  // whose ownership is UNVERIFIED. Never labeled "privately held" (Billy's fix).
  const ownershipUnverified = pdfInput.counts.privatelyHeld;
  const inIncentive = headline.inIncentiveZoneCount;
  const unverifiedPct = total > 0 ? Math.round((ownershipUnverified / total) * 100) : 0;
  const cityPct = total > 0 ? Math.round((cityOwned / total) * 100) : 0;
  const allInIncentive = total > 0 && inIncentive === total;

  // ── Reconciled LAND universe (part 2–3 of "Vacancy Sources, Ownership, and
  // Control"). Null when the ownership source series could not be built — the
  // section degrades to tracked-inventory context rather than fabricating one. ──
  const landUniverse = deriveLandUniverse(edition);
  // v2 two-axis (structure × geography) land table — additive, rendered only
  // when the export carries it (a committed file predating the taxonomy omits
  // it). The geography axis is the taxpayer MAILING address, disclosed as such.
  const landCrossTab = ownership.structureBreakdown?.landUniverseByGeography ?? null;
  const crossTabAt = (structure: string, geography: string): number =>
    landCrossTab?.find((c) => c.ownerStructure === structure && c.ownerGeography === geography)?.count ?? 0;
  const crossTabStructureTotal = (structure: string): number =>
    OWNER_GEOGRAPHY_ORDER.reduce((sum, g) => sum + crossTabAt(structure, g), 0);
  const crossTabGeographyTotal = (geography: string): number =>
    OWNER_STRUCTURE_ORDER.reduce((sum, s) => sum + crossTabAt(s, geography), 0);
  const crossTabGrandTotal = landCrossTab?.reduce((sum, c) => sum + c.count, 0) ?? 0;
  const landOwnerMax = landUniverse
    ? Math.max(1, ...landUniverse.byOwnerType.map((r) => r.count))
    : 1;
  const knownPrivateLand = landUniverse
    ? landUniverse.byOwnerType
        .filter((r) => r.ownerType === "local_private" || r.ownerType === "out_of_state" || r.ownerType === "corporate_llc")
        .reduce((sum, r) => sum + r.count, 0)
    : 0;
  const unknownLand = landUniverse
    ? landUniverse.byOwnerType.find((r) => r.ownerType === "unknown")?.count ?? 0
    : 0;
  const publicLand = landUniverse
    ? landUniverse.byOwnerType.find((r) => r.ownerType === "city_public")?.count ?? 0
    : 0;

  // Part 1 context: the tracked operational list broken out by source.
  const trackedRows: Array<{ ownerType: OwnerType; count: number }> =
    ownership.trackedInventoryByOwnerType.map((r) => ({
      ownerType: normalizeOwnerType(r.ownerType),
      count: r.count,
    }));
  const trackedMax = Math.max(1, ...trackedRows.map((r) => r.count));

  const rawCityCount =
    ownership.vacantLandParcelsByOwnerType?.find((r) => normalizeOwnerType(r.ownerType) === "city_public")
      ?.count ?? null;
  const distress = edition.distress;

  // ── Exemption-anomaly overlay ──
  // Public aggregates travel in the committed vacancy-index.json (counts only,
  // no pins). Guarded with `?? null` for exports that predate the field. The
  // parcel-level referral rows are read server-side from the PRIVATE packet
  // (data/private/exemption-anomalies.json), never public — capped to 50 rows.
  const exemptionAnomalies = edition.exemptionAnomalies ?? null;
  const referralRows = hasSession ? exemptionReferralRowsForZip(zip) : [];
  const REFERRAL_ROW_CAP = 50;
  const referralRowsShown = referralRows.slice(0, REFERRAL_ROW_CAP);
  // Present the land EAV total as an order-of-magnitude figure (2 significant
  // figures), never to the dollar — the framing is "a discrepancy of this
  // scale", not an audited amount.
  const exemptEavMagnitude = (() => {
    const v = exemptionAnomalies?.exemptEavLandTotal ?? null;
    if (v === null || v <= 0) return null;
    const digits = Math.floor(Math.log10(v));
    const round = Math.pow(10, Math.max(0, digits - 1));
    return Math.round(v / round) * round;
  })();

  const propTotal = headline.vacantLandCount + headline.vacantBuildingCount;
  const landPct = propTotal > 0 ? Math.round((headline.vacantLandCount / propTotal) * 100) : 0;
  const buildingPct = propTotal > 0 ? 100 - landPct : 0;

  const matrix = pdfInput.matrixRows;
  const metricLabels = matrix[0]?.cells.map((c) => c.label) ?? [];

  const siteIndex: VacancySiteIndexRow[] = edition.siteIndex;
  const additionalSites = Math.max(0, headline.vacantPropertyCount - siteIndex.length);
  // Total addresses in the lazy-loaded site directory. Guarded for exports that
  // predate the directory field (the orchestrator re-export sets it); the
  // directory section only renders once it's a real positive count.
  const directoryCount = edition.directoryCount ?? 0;

  // Public Opportunity Areas count (derived at render from the committed
  // clusters) — drives the Overview → Opportunity Areas cross-link count.
  const opportunityAreaCount = deriveOpportunityAreas(edition).totalQualifying;

  // F1 binding replacement copy (build-spec.md 2.4; audit's clearest
  // prohibited determination — "already qualifies for programs" — do not
  // weaken, do not strengthen). "sites" -> "tracked site points": the
  // adapter tests a point, not whole-site geometry.
  const editionRevision = exportData.generatedAt ? exportData.generatedAt.slice(0, 10) : "unknown";
  const neighborhoodBrief = `${pilotEntry.primaryNeighborhood} carries ${total.toLocaleString(
    "en-US",
  )} tracked vacant properties. ${cityOwned.toLocaleString(
    "en-US",
  )} are City- or public-controlled and can move toward disposition without owner outreach; the remaining ${ownershipUnverified.toLocaleString(
    "en-US",
  )} carry unverified ownership (311-reported buildings) and start with parcel matching and ownership verification. ${
    allInIncentive ? total.toLocaleString("en-US") : inIncentive.toLocaleString("en-US")
  } tracked site points intersect at least one boundary in the Explorer dataset (revision ${editionRevision}). Use those overlaps to prioritize programs for review; they do not establish eligibility, current intake, or an award. Revitalization here is not a single deal — it is public-land disposition, local-owner partnerships, absentee-owner outreach, and records verification, run cluster by cluster.`;

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        {/* Section sub-navigation — one workspace, five views */}
        <VacancySubNav zip={zip} active="report" />

        {/* 1 · Place-first header */}
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Vacancy Opportunity Index
        </span>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-editorial text-[44px] leading-none sm:text-[56px]">
            {pilotEntry.primaryNeighborhood} — Vacancy-to-Revitalization
          </h1>
          <span className="font-mono-bureau text-[11px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
            Edition {edition.editionNumber} / {PILOT_ZIPS.length} · ZIP {zip} · As of {asOf}
          </span>
        </div>
        {pilotEntry.secondaryAreas.length > 0 && (
          <p className="mt-2 text-[13px] text-[#0C1B33]/40">
            Also covers {pilotEntry.secondaryAreas.join(" · ")}
          </p>
        )}
        <p className="mt-2 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/35">
          {editionGeographyNote(zip, pilotEntry.primaryNeighborhood)}
        </p>

        {/* Cross-links to the other three views (real counts) */}
        <div className="mt-6 grid grid-cols-1 gap-px border border-[#0C1B33]/10 bg-[#0C1B33]/10 sm:grid-cols-3">
          <Link
            href={`/vacancy/${zip}/areas`}
            className="group bg-white px-4 py-3.5 transition-colors hover:bg-[#FAF9F6]"
          >
            <span className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
              Opportunity Areas
            </span>
            <span className="mt-1 block text-[13px] font-semibold text-[#0C1B33] group-hover:text-[#2563EB]">
              View {opportunityAreaCount} opportunity {opportunityAreaCount === 1 ? "area" : "areas"} →
            </span>
          </Link>
          <Link
            href={`/vacancy/${zip}/map`}
            className="group bg-white px-4 py-3.5 transition-colors hover:bg-[#FAF9F6]"
          >
            <span className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
              Property Map
            </span>
            <span className="mt-1 block text-[13px] font-semibold text-[#0C1B33] group-hover:text-[#2563EB]">
              Explore the property map →
            </span>
          </Link>
          <Link
            href={`/vacancy/${zip}/directory`}
            className="group bg-white px-4 py-3.5 transition-colors hover:bg-[#FAF9F6]"
          >
            <span className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
              All Properties
            </span>
            <span className="mt-1 block text-[13px] font-semibold text-[#0C1B33] group-hover:text-[#2563EB]">
              Browse all {(directoryCount || total).toLocaleString("en-US")} properties →
            </span>
          </Link>
        </div>

        {/* 2 · Scale of the challenge */}
        <section className="mt-8">
          <h2 className="mb-3 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
            Scale of the challenge
          </h2>
          <div className="grid grid-cols-2 gap-px border border-[#0C1B33]/10 bg-[#0C1B33]/10 sm:grid-cols-4">
            <div className="bg-white px-4 py-4">
              <div className="font-editorial text-[34px] leading-none">{total.toLocaleString("en-US")}</div>
              <div className="mt-2 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                Tracked vacant properties
              </div>
            </div>
            <div className="bg-white px-4 py-4">
              <div className="font-editorial text-[34px] leading-none">{unverifiedPct}%</div>
              <div className="mt-2 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                Ownership unverified
              </div>
              <div className="mt-1 text-[10px] leading-tight text-[#0C1B33]/40">
                311-reported vacant buildings, not yet parcel-matched
              </div>
            </div>
            <div className="bg-white px-4 py-4">
              <div className="font-editorial text-[34px] leading-none">{cityPct}%</div>
              <div className="mt-2 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                City / Public controlled
              </div>
            </div>
            <div className="bg-white px-4 py-4">
              {allInIncentive ? (
                <p className="font-editorial text-[17px] leading-snug">
                  All tracked sites intersect at least one incentive geography
                </p>
              ) : (
                <>
                  <div className="font-editorial text-[34px] leading-none">
                    {inIncentive.toLocaleString("en-US")}{" "}
                    <span className="text-[17px] text-[#0C1B33]/45">of {total.toLocaleString("en-US")}</span>
                  </div>
                  <div className="mt-2 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                    Intersect an incentive geography
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        {/* 3 · THE LIVE MAP */}
        <section className="mt-8">
          <h2 className="mb-3 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
            Site map — clustered tracked vacancies
          </h2>
          <VacancyMapIsland
            zip={zip}
            boundary={edition.boundary}
            bbox={edition.boundary?.bbox ?? null}
            centroid={edition.centroid}
            sitePoints={edition.sitePoints}
            siteIndex={edition.siteIndex}
            totalCount={headline.vacantPropertyCount}
            landPoints={edition.landPoints ?? null}
            landPointsTruncated={edition.landPointsTruncated ?? false}
            landPointsTotal={edition.landPointsTotal ?? null}
            asOf={asOf}
            neighborhood={pilotEntry.primaryNeighborhood}
            clusters={edition.clusters ?? null}
            corridors={loadCorridorRings(edition.corridors ?? null)}
            anchors={edition.anchors ?? null}
          />
        </section>

        {/* 4 · Vacancy Sources, Ownership, and Control */}
        <section className="mt-10">
          <h2 className="mb-6 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
            Vacancy Sources, Ownership, and Control
          </h2>

          {/* Part 1 — What is being counted */}
          <div>
            <h3 className="flex items-baseline gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55">
              <span className="text-[#2563EB]">01</span> What is being counted
            </h3>
            <div className="mt-3 border border-[#0C1B33]/10 bg-white">
              {[
                {
                  tag: "a",
                  label: "City-inventory vacant-land parcels",
                  sub: "City-Owned Land Server (COLS)",
                  value: headline.vacantLandCount,
                },
                {
                  tag: "b",
                  label: "311-reported vacant-building sites",
                  sub: "Service requests — ownership not attached",
                  value: headline.vacantBuildingCount,
                },
                {
                  tag: "c",
                  label: "Assessor-classed vacant-land parcels",
                  sub: "Cook County Assessor vacant-land classification",
                  value: ownership.vacantLandParcelTotal,
                },
              ].map((s) => (
                <div
                  key={s.tag}
                  className="flex items-baseline gap-3 border-b border-[#0C1B33]/5 px-4 py-3 last:border-b-0"
                >
                  <span className="font-mono-bureau text-[11px] text-[#2563EB]">({s.tag})</span>
                  <span className="flex-1">
                    <span className="text-[13px] text-[#0C1B33]">{s.label}</span>
                    <span className="mt-0.5 block font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/35">
                      {s.sub}
                    </span>
                  </span>
                  <span className="flex-shrink-0 font-mono-bureau text-[14px] font-semibold text-[#0C1B33]">
                    {s.value != null ? s.value.toLocaleString("en-US") : "—"}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/60">
              Sources (a) and (b) together form the{" "}
              <span className="font-semibold text-[#0C1B33]">
                {headline.vacantPropertyCount.toLocaleString("en-US")}-record
              </span>{" "}
              operational tracking list — the properties a corridor manager actively works.{" "}
              <span className="font-semibold text-[#0C1B33]">
                That list is not the complete vacant-land universe.
              </span>{" "}
              The land universe reconciles the two land sources, (a) and (c), below.
            </p>

            {/* Compact reference: the tracked list's owner-type mix + land/building split */}
            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <div>
                <h4 className="mb-2 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                  Tracked list by owner type (COLS + 311)
                </h4>
                <div className="space-y-2">
                  {OWNER_TYPE_ORDER.map((type) => {
                    const row = trackedRows.find((r) => r.ownerType === type);
                    return (
                      <OwnerBar key={type} ownerType={type} count={row?.count ?? 0} max={trackedMax} />
                    );
                  })}
                </div>
              </div>
              <div>
                <h4 className="mb-2 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                  Tracked list — land vs. building
                </h4>
                <div className="flex h-4 w-full overflow-hidden border border-[#0C1B33]/10">
                  <div
                    className="h-4 bg-[#111111]"
                    style={{ width: `${landPct}%` }}
                    title={`Tracked as vacant land ${landPct}%`}
                  />
                  <div
                    className="h-4 bg-[#8A8A8A]"
                    style={{ width: `${buildingPct}%` }}
                    title={`Reported vacant buildings ${buildingPct}%`}
                  />
                </div>
                <div className="mt-2 flex justify-between font-mono-bureau text-[10px] text-[#0C1B33]/55">
                  <span>
                    {headline.vacantLandCount.toLocaleString("en-US")} vacant land ({landPct}%)
                  </span>
                  <span>
                    {headline.vacantBuildingCount.toLocaleString("en-US")} reported buildings (311) (
                    {buildingPct}%)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {landUniverse ? (
            <>
              {/* Part 2 — How the land sources overlap */}
              <div className="mt-10">
                <h3 className="flex items-baseline gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55">
                  <span className="text-[#2563EB]">02</span> How the land sources overlap
                </h3>
                <div className="mt-3 border border-[#0C1B33]/10 bg-white">
                  {[
                    {
                      label: "City-inventory vacant-land parcels",
                      op: "",
                      value: landUniverse.components.inventoryTotal,
                    },
                    {
                      label: "Assessor-classed vacant-land parcels",
                      op: "+",
                      value: landUniverse.components.assessorTotal,
                    },
                    {
                      label: "Parcels counted in both sources (City PIN matches)",
                      op: "−",
                      value: landUniverse.components.pinMatches,
                    },
                  ].map((r) => (
                    <div
                      key={r.label}
                      className="flex items-baseline gap-3 border-b border-[#0C1B33]/5 px-4 py-2.5"
                    >
                      <span className="w-4 flex-shrink-0 text-center font-mono-bureau text-[13px] text-[#0C1B33]/50">
                        {r.op}
                      </span>
                      <span className="flex-1 text-[13px] text-[#0C1B33]/75">{r.label}</span>
                      <span className="flex-shrink-0 font-mono-bureau text-[14px] font-semibold text-[#0C1B33]">
                        {r.value.toLocaleString("en-US")}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-baseline gap-3 bg-[#0C1B33]/[0.03] px-4 py-3">
                    <span className="w-4 flex-shrink-0" />
                    <span className="flex-1 text-[13px] font-semibold text-[#0C1B33]">
                      Unique land parcels (deduplicated union)
                    </span>
                    <span className="flex-shrink-0 font-editorial text-[22px] leading-none text-[#0C1B33]">
                      {landUniverse.total.toLocaleString("en-US")}
                    </span>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-[#0C1B33]/60">
                  <li>
                    <span className="font-mono-bureau font-semibold text-[#0C1B33]">
                      {landUniverse.components.pinMatches.toLocaleString("en-US")}
                    </span>{" "}
                    City PIN matches — parcels present in both land sources.
                  </li>
                  <li>
                    <span className="font-mono-bureau font-semibold text-[#0C1B33]">
                      {landUniverse.components.inventoryOnly.toLocaleString("en-US")}
                    </span>{" "}
                    City-inventory parcels outside the Assessor&rsquo;s vacant-land classification
                    (city land is mostly tax-exempt).
                  </li>
                  <li>
                    <span className="font-mono-bureau font-semibold text-[#0C1B33]">
                      {landUniverse.components.assessorOnly.toLocaleString("en-US")}
                    </span>{" "}
                    Assessor parcels not found in the City inventory.
                  </li>
                </ul>
              </div>

              {/* Part 3 — Who controls the vacant land */}
              <div className="mt-10">
                <h3 className="flex items-baseline gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55">
                  <span className="text-[#2563EB]">03</span> Who controls the vacant land
                </h3>
                <p className="mt-2 text-[12px] leading-relaxed text-[#0C1B33]/55">
                  Ownership across the{" "}
                  <span className="font-semibold text-[#0C1B33]">
                    {landUniverse.total.toLocaleString("en-US")}
                  </span>{" "}
                  unique land parcels above — the single &ldquo;who controls&rdquo; claim.
                </p>
                <div className="mt-3 space-y-2.5">
                  {landUniverse.byOwnerType.map((row) => (
                    <OwnerBar
                      key={row.ownerType}
                      ownerType={row.ownerType}
                      count={row.count}
                      max={landOwnerMax}
                    />
                  ))}
                  <div className="flex items-center gap-3 border-t border-[#0C1B33]/10 pt-2">
                    <span className="w-[132px] flex-shrink-0 text-[12px] font-semibold text-[#0C1B33]">
                      Total
                    </span>
                    <div className="flex-1" />
                    <span className="w-[52px] flex-shrink-0 text-right font-mono-bureau text-[11px] font-semibold text-[#0C1B33]">
                      {landUniverse.total.toLocaleString("en-US")}
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-[#0C1B33]/45">
                  City / Public = City-inventory parcels plus additional public parcels identified
                  through assessor taxpayer records. Private and unknown counts are the reconciled
                  taxpayer-of-record classifications over the same land universe.
                  {rawCityCount != null && (
                    <>
                      {" "}
                      Raw taxpayer records alone would show City/Public{" "}
                      {rawCityCount.toLocaleString("en-US")}.
                    </>
                  )}
                </p>
              </div>

              {/* Part 3b — Two-axis ownership (structure × geography) */}
              {landCrossTab && (
                <div className="mt-10">
                  <h3 className="flex items-baseline gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55">
                    <span className="text-[#2563EB]">03b</span> Owner structure × geography
                  </h3>
                  <p className="mt-2 text-[12px] leading-relaxed text-[#0C1B33]/55">
                    The same assessor vacant-land parcels, cross-tabulated by owner{" "}
                    <span className="font-semibold text-[#0C1B33]">structure</span> (from the taxpayer
                    name) and <span className="font-semibold text-[#0C1B33]">geography</span> (from the
                    taxpayer mailing address).
                  </p>
                  <div className="mt-3 overflow-x-auto border border-[#0C1B33]/10 bg-white">
                    <table className="w-full min-w-[520px] border-collapse text-left">
                      <thead>
                        <tr className="border-b border-[#0C1B33]/10 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                          <th className="px-3 py-2.5">Structure</th>
                          {OWNER_GEOGRAPHY_ORDER.map((g) => (
                            <th key={g} className="px-3 py-2.5 text-right">
                              {OWNER_GEOGRAPHY_LABELS[g]}
                            </th>
                          ))}
                          <th className="px-3 py-2.5 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {OWNER_STRUCTURE_ORDER.map((s) => (
                          <tr key={s} className="border-b border-[#0C1B33]/5">
                            <td className="px-3 py-2.5">
                              <span className="inline-flex items-center gap-1.5 text-[12px] text-[#0C1B33]/75">
                                <span
                                  className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                                  style={{ backgroundColor: OWNER_STRUCTURE_COLORS[s] }}
                                />
                                {OWNER_STRUCTURE_LABELS[s]}
                              </span>
                            </td>
                            {OWNER_GEOGRAPHY_ORDER.map((g) => (
                              <td
                                key={g}
                                className="px-3 py-2.5 text-right font-mono-bureau text-[12px] text-[#0C1B33]/70"
                              >
                                {crossTabAt(s, g).toLocaleString("en-US")}
                              </td>
                            ))}
                            <td className="px-3 py-2.5 text-right font-mono-bureau text-[12px] font-semibold text-[#0C1B33]">
                              {crossTabStructureTotal(s).toLocaleString("en-US")}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-[#0C1B33]/[0.03]">
                          <td className="px-3 py-2.5 text-[12px] font-semibold text-[#0C1B33]">Total</td>
                          {OWNER_GEOGRAPHY_ORDER.map((g) => (
                            <td
                              key={g}
                              className="px-3 py-2.5 text-right font-mono-bureau text-[12px] font-semibold text-[#0C1B33]"
                            >
                              {crossTabGeographyTotal(g).toLocaleString("en-US")}
                            </td>
                          ))}
                          <td className="px-3 py-2.5 text-right font-mono-bureau text-[12px] font-semibold text-[#0C1B33]">
                            {crossTabGrandTotal.toLocaleString("en-US")}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/45">
                    Geography is the taxpayer mailing address&rsquo;s state, not a claim about where an
                    owner physically resides. Structure is inferred from public taxpayer-of-record
                    name patterns.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="mt-10 border border-dashed border-[#0C1B33]/20 bg-white px-4 py-6 text-center">
              <span className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                Land universe not yet available
              </span>
              <p className="mt-2 text-[12px] leading-relaxed text-[#0C1B33]/45">
                The complete assessor-parcel ownership series could not be built for this ZIP on the
                last refresh, so the reconciled land universe and its ownership table are withheld.
              </p>
            </div>
          )}

          {/* Part 4 — Vacant buildings requiring verification */}
          <div className="mt-10">
            <h3 className="flex items-baseline gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55">
              <span className="text-[#2563EB]">04</span> Vacant buildings requiring verification
            </h3>
            <div className="mt-3 flex flex-wrap items-baseline gap-3">
              <span className="font-editorial text-[30px] leading-none text-[#0C1B33]">
                {headline.vacantBuildingCount.toLocaleString("en-US")}
              </span>
              <span className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                311-reported vacant-building sites
              </span>
              <span className="border border-[#0C1B33]/30 bg-[#0C1B33]/[0.03] px-2 py-0.5 font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.08em] text-[#0C1B33]/75">
                Ownership unverified
              </span>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/60">
              These are service-request sites, not owner-verified holdings — they are{" "}
              <span className="font-semibold text-[#0C1B33]">not &ldquo;privately held.&rdquo;</span>{" "}
              An exact land-plus-building total should not be published until these sites are
              parcel-matched and deduplicated against the land universe above.
            </p>
            {/* Distress signals (preserved) */}
            <div className="mt-4 flex flex-wrap gap-2">
              {distress && distress.taxSaleExposedCount != null ? (
                <span className="inline-flex items-center gap-1.5 border border-[#0C1B33]/25 bg-white px-3 py-1.5 text-[11px] text-[#0C1B33]/80">
                  <span
                    className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: DISTRESS_RED }}
                  />
                  Tax-sale records on file
                  <span className="font-mono-bureau text-[11px] font-semibold text-[#0C1B33]">
                    {distress.taxSaleExposedCount.toLocaleString("en-US")} parcels
                    {distress.latestTaxSaleYear != null ? ` · latest ${distress.latestTaxSaleYear}` : ""}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 border border-dashed border-[#0C1B33]/20 bg-white px-3 py-1.5 text-[11px] text-[#0C1B33]/45">
                  Tax-sale / delinquency
                  <span className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/35">
                    Not yet available
                  </span>
                </span>
              )}
              {distress && distress.violationMatchCount != null ? (
                <span className="inline-flex items-center gap-1.5 border border-[#0C1B33]/25 bg-white px-3 py-1.5 text-[11px] text-[#0C1B33]/80">
                  <span
                    className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: DISTRESS_RED }}
                  />
                  Vacant-building violations
                  <span className="font-mono-bureau text-[11px] font-semibold text-[#0C1B33]">
                    {distress.violationMatchCount.toLocaleString("en-US")} tracked sites
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 border border-dashed border-[#0C1B33]/20 bg-white px-3 py-1.5 text-[11px] text-[#0C1B33]/45">
                  Code-violation density
                  <span className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/35">
                    Not yet available
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Part 4b — Exemption anomalies (public aggregates, counts only) */}
          <div className="mt-10">
            <h3 className="flex items-baseline gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55">
              <span className="text-[#2563EB]">04b</span> Exemption anomalies — records for review
            </h3>
            <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[#0C1B33]/70">
              Record anomalies warranting official review. A vacant land parcel cannot serve as a
              principal residence; these pairings are records discrepancies for the Assessor,
              Treasurer, and Clerk to adjudicate — no wrongdoing is asserted.
            </p>
            {exemptionAnomalies ? (
              <>
                <div className="mt-4 grid grid-cols-1 gap-px border border-[#0C1B33]/10 bg-[#0C1B33]/10 sm:grid-cols-2">
                  {[
                    {
                      key: "land",
                      label: "Impossible on its face",
                      sub: "Occupancy exemption on vacant LAND (class 1xx)",
                      split: exemptionAnomalies.landImpossible,
                    },
                    {
                      key: "building",
                      label: "Plausible but stale",
                      sub: "Occupancy exemption on a vacant BUILDING",
                      split: exemptionAnomalies.buildingStale,
                    },
                  ].map((b) => (
                    <div key={b.key} className="bg-white px-4 py-4">
                      <div className="font-editorial text-[34px] leading-none">
                        {b.split.any.toLocaleString("en-US")}
                      </div>
                      <div className="mt-1 text-[12px] font-semibold text-[#0C1B33]">{b.label}</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-[#0C1B33]/55">{b.sub}</div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono-bureau text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/55">
                        <span>{b.split.senior.toLocaleString("en-US")} senior / freeze</span>
                        <span>{b.split.noTransfer10y.toLocaleString("en-US")} no transfer ≥10y</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
                  Exemption tax year {exemptionAnomalies.taxYear}
                  {exemptEavMagnitude !== null
                    ? ` · land exempt EAV ~${exemptEavMagnitude.toLocaleString("en-US")} (order of magnitude)`
                    : ""}
                </p>
                <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-[#0C1B33]/55">
                  Coverage: every count is a floor. Unmatched 311 building rows carry no parcel and
                  are invisible here; MyDec transfer records only reach back to roughly 2009, so a
                  &ldquo;no transfer&rdquo; flag is a floor, not proof of no sale; and exemption data
                  lags to tax year {exemptionAnomalies.taxYear}. Parcel-level detail is held in the
                  admin-only referral packet below.
                </p>
              </>
            ) : (
              <p className="mt-4 inline-flex items-center gap-2 border border-dashed border-[#0C1B33]/20 bg-white px-3 py-1.5 text-[11px] text-[#0C1B33]/45">
                Exemption anomalies
                <span className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/35">
                  Not yet available
                </span>
              </p>
            )}
          </div>

          {/* Part 5 — What this means for action */}
          <div className="mt-10">
            <h3 className="flex items-baseline gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55">
              <span className="text-[#2563EB]">05</span> What this means for action
            </h3>
            <div className="mt-3 overflow-x-auto border border-[#0C1B33]/10 bg-white">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <tbody>
                  {[
                    {
                      label: "Public land parcels",
                      count: landUniverse ? publicLand : null,
                      action: "Disposition · RFP · CCLBA coordination · land assembly",
                    },
                    {
                      label: "Known private land parcels",
                      count: landUniverse ? knownPrivateLand : null,
                      action: "Owner outreach and development partnerships",
                    },
                    {
                      label: "Unknown land parcels",
                      count: landUniverse ? unknownLand : null,
                      action: "Ownership and title verification",
                    },
                    {
                      label: "Reported buildings",
                      count: headline.vacantBuildingCount,
                      action: "Parcel matching · ownership verification · active-status confirmation",
                    },
                  ].map((r) => (
                    <tr key={r.label} className="border-b border-[#0C1B33]/5 align-top last:border-b-0">
                      <td className="px-3 py-2.5 text-[12px] font-semibold text-[#0C1B33]">
                        {r.label}
                        {r.count != null && (
                          <span className="ml-2 font-mono-bureau text-[11px] font-normal text-[#0C1B33]/55">
                            {r.count.toLocaleString("en-US")}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] leading-snug text-[#0C1B33]/70">
                        {r.action}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Section takeaway (verbatim) — closes part 5 */}
            <p className="mt-8 text-[15px] font-semibold leading-relaxed text-[#0C1B33]">
              Revitalization cannot depend on one acquisition strategy. It requires public-land
              disposition, local-owner partnerships, absentee-owner outreach, and targeted ownership
              verification.
            </p>
          </div>
        </section>

        {/* 5 · Ownership → action pathways */}
        <section className="mt-10">
          <h2 className="mb-4 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
            Ownership → action pathways
          </h2>
          <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#0C1B33]/10 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                  <th className="px-3 py-2.5">Owner class</th>
                  <th className="px-3 py-2.5">Action pathway</th>
                </tr>
              </thead>
              <tbody>
                {ACTION_PATHWAYS.map((row) => (
                  <tr
                    key={row.label}
                    className={`border-b border-[#0C1B33]/5 align-top ${row.ring ? "bg-[#DC2626]/[0.04]" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#0C1B33]">
                        {row.ring ? (
                          <span
                            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full border-2"
                            style={{ borderColor: row.color, backgroundColor: "transparent" }}
                          />
                        ) : (
                          <span
                            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: row.color }}
                          />
                        )}
                        {row.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] leading-snug text-[#0C1B33]/70">
                      {row.actions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 6 · Where coordinated intervention is possible (clusters mount) */}
        <section className="mt-10">
          <h2 className="mb-4 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
            Where coordinated intervention is possible
          </h2>
          <VacancyClustersIsland
            zip={zip}
            clusters={edition.clusters ?? null}
            clustersNote={edition.clustersNote ?? ""}
          />
        </section>

        {/* 7 · Featured site index */}
        <section className="mt-10">

          {/* Site index */}
          <h3 className="mb-4 mt-8 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
            Site index — featured sites
          </h3>
          <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white">
            <table className="w-full min-w-[940px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#0C1B33]/10 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                  <th className="px-3 py-2.5 w-8">#</th>
                  <th className="px-3 py-2.5">Address</th>
                  <th className="px-3 py-2.5">Owner type</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Zoning</th>
                  <th className="px-3 py-2.5 text-right">Sq ft</th>
                  <th className="px-3 py-2.5">Next step</th>
                  <th className="px-3 py-2.5">Verify</th>
                </tr>
              </thead>
              <tbody>
                {siteIndex.map((row, i) => {
                  const ownerType = normalizeOwnerType(row.ownerType);
                  // v2 structure abbrev, rendered only when the export carries it.
                  const structure = row.ownerStructure ? normalizeOwnerStructure(row.ownerStructure) : null;
                  const cookViewer = cookViewerUrl(row.pin);
                  return (
                    <tr key={`${row.lat},${row.lon},${i}`} className="border-b border-[#0C1B33]/5 align-top">
                      <td className="px-3 py-2.5 font-mono-bureau text-[11px] text-[#0C1B33]/50">
                        {row.markerNumber ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-[#0C1B33]/80">{row.address}</td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-[#0C1B33]/70">
                          <span
                            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: OWNER_TYPE_COLORS[ownerType] }}
                          />
                          {OWNER_TYPE_LABELS[ownerType]}
                          {structure && (
                            <span
                              className="ml-1 border px-1 py-0.5 font-mono-bureau text-[8px] font-semibold uppercase tracking-[0.06em]"
                              style={{ color: OWNER_STRUCTURE_COLORS[structure], borderColor: `${OWNER_STRUCTURE_COLORS[structure]}55` }}
                              title={`Structure: ${OWNER_STRUCTURE_LABELS[structure]} (taxpayer name)`}
                            >
                              {OWNER_STRUCTURE_ABBREV[structure]}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-[#0C1B33]/60">
                        {PROPERTY_TYPE_LABELS[row.propertyType]}
                      </td>
                      <td className="px-3 py-2.5 font-mono-bureau text-[11px] text-[#0C1B33]/55">
                        {row.zoningClass ?? "Pending"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-bureau text-[11px] text-[#0C1B33]/55">
                        {row.squareFeet != null ? row.squareFeet.toLocaleString("en-US") : "N/A"}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] leading-snug text-[#0C1B33]/55">
                        {row.nextStep}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {cookViewer ? (
                          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.06em]">
                            <a
                              href={cookViewer}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Opens Cook County's official parcel record in a new tab."
                              className="text-[#2563EB] hover:underline"
                            >
                              CookViewer ↗
                            </a>
                            <span className="text-[#0C1B33]/30"> · </span>
                            <a
                              href={clerkRecordsUrl(row.pin)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Review recorded deeds, grantors, grantees, liens, releases, and other documents associated with this parcel."
                              className="text-[#2563EB] hover:underline"
                            >
                              Clerk ↗
                            </a>
                          </span>
                        ) : (
                          <span className="font-mono-bureau text-[10px] text-[#0C1B33]/30">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {additionalSites > 0 && (
            <p className="mt-2 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
              + {additionalSites.toLocaleString("en-US")} additional sites in the directory below
            </p>
          )}
        </section>

        {/* Nine-edition comparison matrix (reference) */}
        <section className="mt-10">
          <h2 className="mb-4 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
            Nine-edition comparison
          </h2>
          <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#0C1B33]/10">
                  <th className="px-3 py-2.5 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                    Edition
                  </th>
                  {metricLabels.map((label) => (
                    <th
                      key={label}
                      className="px-3 py-2.5 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr
                    key={row.zip}
                    className={`border-b border-[#0C1B33]/5 ${row.isSubject ? "bg-[#2563EB]/5" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <span
                        className={`text-[12px] ${row.isSubject ? "font-semibold text-[#2563EB]" : "text-[#0C1B33]/70"}`}
                      >
                        {row.area}
                      </span>
                      <span className="ml-1.5 font-mono-bureau text-[10px] text-[#0C1B33]/35">
                        {row.zip}
                      </span>
                    </td>
                    {row.cells.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2.5">
                        <div className="flex flex-col gap-1">
                          <DotRating dots={cell.dots} />
                          <span className="font-mono-bureau text-[10px] text-[#0C1B33]/55">
                            {cell.value ?? "—"}
                          </span>
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/45">{MATRIX_METHOD_NOTE}</p>
        </section>


        {/* Site directory — the full online index (lazy-loaded) */}
        {directoryCount > 0 && (
          <section id="site-directory" className="mt-10">
            <h2 className="mb-4 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
              Site directory — every tracked address
            </h2>
            <VacancyDirectory
              zip={zip}
              neighborhood={pilotEntry.primaryNeighborhood}
              directoryCount={directoryCount}
            />
          </section>
        )}

        {/* Exemption anomalies — ADMIN-ONLY referral packet (parcel-level).
            Rail 2: this table stays admin-gated now that the page is public.
            Guarded by the server-side `hasSession` check; the public aggregate
            block (part 4b above) remains visible to everyone. */}
        {hasSession && referralRows.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-2 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
              Exemption anomalies — referral review
              <span className="ml-2 border border-[#0C1B33]/30 bg-[#0C1B33]/[0.03] px-1.5 py-0.5 font-mono-bureau text-[8px] font-semibold uppercase tracking-[0.08em] text-[#0C1B33]/60">
                Admin only
              </span>
            </h2>
            <p className="max-w-3xl text-[13px] leading-relaxed text-[#0C1B33]/70">
              Record anomalies warranting official review. A vacant land parcel cannot serve as a
              principal residence; these pairings are records discrepancies for the Assessor,
              Treasurer, and Clerk to adjudicate — no wrongdoing is asserted.
            </p>
            <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-[#0C1B33]/55">
              Parcel-level referral detail — admin only, never in the shareable PDF or the public
              index. Counts are floors: unmatched 311 rows are invisible, MyDec transfers only reach
              ~2009, and exemption data lags to tax year{" "}
              {exemptionAnomalies?.taxYear ?? referralRowsShown[0]?.taxYear}. No owner names appear —
              pull the parcel via CookViewer / Clerk to identify the record holder.
            </p>
            <div className="mt-4 overflow-x-auto border border-[#0C1B33]/10 bg-white">
              <table className="w-full min-w-[860px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#0C1B33]/10 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                    <th className="px-3 py-2.5">PIN</th>
                    <th className="px-3 py-2.5">Address</th>
                    <th className="px-3 py-2.5">Class</th>
                    <th className="px-3 py-2.5">Universe</th>
                    <th className="px-3 py-2.5">Exemptions (EAV)</th>
                    <th className="px-3 py-2.5">Last transfer</th>
                    <th className="px-3 py-2.5">Verify</th>
                  </tr>
                </thead>
                <tbody>
                  {referralRowsShown.map((r) => {
                    const cookViewer = cookViewerUrl(r.pin);
                    const clerk = clerkRecordsUrl(r.pin);
                    const active = (
                      [
                        ["Homeowner", r.exemptions.homeowner],
                        ["Senior", r.exemptions.senior],
                        ["Senior freeze", r.exemptions.freeze],
                        ["Disabled", r.exemptions.disabled],
                        ["Veteran", r.exemptions.vet],
                        ["Longtime", r.exemptions.longtime],
                      ] as const
                    ).filter(([, v]) => v > 0);
                    return (
                      <tr key={r.pin} className="border-b border-[#0C1B33]/5 align-top last:border-b-0">
                        <td className="px-3 py-2.5 font-mono-bureau text-[11px] text-[#0C1B33]/70 whitespace-nowrap">
                          {r.pin}
                        </td>
                        <td className="px-3 py-2.5 text-[12px] text-[#0C1B33]/80">
                          {r.address ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 font-mono-bureau text-[11px] text-[#0C1B33]/55">
                          {r.classCode ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]">
                          <span
                            className="inline-block border px-1.5 py-0.5 font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.06em]"
                            style={
                              r.universe === "land"
                                ? { color: "#B91C1C", borderColor: "#B91C1C55" }
                                : { color: "#B45309", borderColor: "#B4530955" }
                            }
                            title={
                              r.universe === "land"
                                ? "Impossible on its face — occupancy exemption on vacant land"
                                : "Plausible but stale — occupancy exemption on a vacant building"
                            }
                          >
                            {r.universe === "land" ? "Land" : "Building"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] leading-snug text-[#0C1B33]/70">
                          {active.length === 0
                            ? "—"
                            : active.map(([label, v], i) => (
                                <span key={label} className="whitespace-nowrap">
                                  {label}{" "}
                                  <span className="font-mono-bureau text-[10px] text-[#0C1B33]/50">
                                    {v.toLocaleString("en-US")}
                                  </span>
                                  {i < active.length - 1 ? ", " : ""}
                                </span>
                              ))}
                        </td>
                        <td className="px-3 py-2.5 font-mono-bureau text-[11px] text-[#0C1B33]/55 whitespace-nowrap">
                          {r.latestTransferDate ?? "none on record"}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {cookViewer && clerk ? (
                            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.06em]">
                              <a
                                href={cookViewer}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Opens Cook County's official parcel record in a new tab."
                                className="text-[#2563EB] hover:underline"
                              >
                                CookViewer ↗
                              </a>
                              <span className="text-[#0C1B33]/30"> · </span>
                              <a
                                href={clerk}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Review recorded deeds, grantors, grantees, liens, releases, and other documents associated with this parcel."
                                className="text-[#2563EB] hover:underline"
                              >
                                Clerk ↗
                              </a>
                            </span>
                          ) : (
                            <span className="font-mono-bureau text-[10px] text-[#0C1B33]/30">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {referralRows.length > REFERRAL_ROW_CAP && (
              <p className="mt-2 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
                Showing {REFERRAL_ROW_CAP} of {referralRows.length.toLocaleString("en-US")} anomaly
                parcels — full list in the referral packet (data/private/exemption-anomalies.json)
              </p>
            )}
          </section>
        )}

        {/* 8 · 90-day corridor action agenda */}
        <section className="mt-12 border-t border-[#0C1B33]/10 pt-8">
          <h2 className="mb-4 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
            90-day corridor action agenda
          </h2>
          <ol className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {CORRIDOR_AGENDA.map((step, i) => (
              <li key={step} className="flex items-baseline gap-3 border-t border-[#0C1B33]/10 pt-2">
                <span className="font-mono-bureau text-[12px] text-[#2563EB]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[13px] leading-snug text-[#0C1B33]/80">{step}</span>
              </li>
            ))}
          </ol>

          <blockquote className="mt-8 border-l-2 border-[#2563EB] pl-4 font-editorial text-[19px] leading-relaxed text-[#0C1B33]/85">
            {neighborhoodBrief}
          </blockquote>
        </section>

        {/* Footer */}
        <footer className="mt-12 border-t border-[#0C1B33]/10 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <VacancyIndexPdfButton
              zip={zip}
              neighborhood={pilotEntry.primaryNeighborhood}
              source="vacancy_web_report"
            />
            <p className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/35">
              Download the anonymized PDF edition — owner types only, no names. Safe to share with
              partners.
            </p>
          </div>

          <div className="mt-6 space-y-3 text-[11px] leading-relaxed text-[#0C1B33]/45">
            <p>{MATRIX_METHOD_NOTE}</p>
            <div>
              <span className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                Sources
              </span>
              <ul className="mt-1 list-inside list-disc">
                <li>{exportData.sources.trackedInventory}</li>
                <li>{exportData.sources.vacantLandOwnership}</li>
                <li>{exportData.sources.corridorMetrics}</li>
                <li>{exportData.sources.zipBoundaries}</li>
                <li>{exportData.sources.transportNetwork}</li>
              </ul>
            </div>
            <p className="text-[#0C1B33]/55">
              Informational screening only. Owner type is inferred from public taxpayer-of-record
              patterns and is anonymized — no owner names or mailing addresses appear here. Records
              indicate; confirm current ownership, program requirements, timing, and approval steps with
              the administering organization before relying.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
