import Link from "next/link";
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
  PRIORITY_RUBRIC_NOTE,
  PORTFOLIO_LABELS,
  PORTFOLIO_ORDER,
  PORTFOLIO_RUBRIC_NOTE,
  portfolioForSite,
  editionGeographyNote,
  loadVacancyIndex,
} from "@/lib/vacancy-index";
import { buildVacancyIndexPdfInput } from "@/lib/vacancy-index-adapter";
import {
  OWNER_TYPE_COLORS,
  OWNER_TYPE_LABELS,
  OWNER_TYPE_ORDER,
  normalizeOwnerType,
  type OwnerType,
} from "@/lib/owner-classify";
import type {
  VacancyPortfolio,
  VacancyPriorityTier,
  VacancyPropertyType,
  VacancySiteIndexRow,
  VacancySitePoint,
} from "@/lib/vacancy-index";
import VacancyMapIsland from "@/components/vacancy/VacancyMapIsland";
import VacancyClustersIsland from "@/components/vacancy/VacancyClustersIsland";
import { loadCorridorRings } from "@/lib/vacancy-corridor-rings";
import VacancyDirectory from "@/components/vacancy/VacancyDirectory";
import { VacancyIndexPdfButton } from "@/components/owner-file/VacancyIndexPdfButton";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const DISTRESS_RED = "#DC2626";

const PROPERTY_TYPE_LABELS: Record<VacancyPropertyType, string> = {
  vacant_land: "Vacant Land",
  vacant_building: "Vacant Building",
};

const PRIORITY_CHIP: Record<VacancyPriorityTier, { label: string; bg: string; fg: string }> = {
  high: { label: "HIGH", bg: "#DC2626", fg: "#FFFFFF" },
  medium: { label: "MEDIUM", bg: "#EAB308", fg: "#111111" },
  low: { label: "LOW", bg: "#D9D9D9", fg: "#4B4B4B" },
};

/** Readiness-portfolio chip styling: move_now = filled ink, organize_next =
 *  blue outline, verify = yellow, long_term = gray. */
const PORTFOLIO_CHIP: Record<VacancyPortfolio, { bg: string; fg: string; border: string }> = {
  move_now: { bg: "#0C1B33", fg: "#FFFFFF", border: "#0C1B33" },
  organize_next: { bg: "transparent", fg: "#2563EB", border: "#2563EB" },
  verify: { bg: "#EAB308", fg: "#111111", border: "#EAB308" },
  long_term: { bg: "#D9D9D9", fg: "#4B4B4B", border: "#D9D9D9" },
};

function PortfolioChip({ portfolio }: { portfolio: VacancyPortfolio }) {
  const s = PORTFOLIO_CHIP[portfolio];
  return (
    <span
      className="inline-block border px-2 py-0.5 font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.08em]"
      style={{ backgroundColor: s.bg, color: s.fg, borderColor: s.border }}
    >
      {PORTFOLIO_LABELS[portfolio]}
    </span>
  );
}

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
    label: "Tax-sale exposed",
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
  searchParams,
}: {
  params: Promise<{ zip: string }>;
  searchParams: SearchParams;
}) {
  const { zip } = await params;
  // Vacancy report is scoped to the nine pilot ZIPs only.
  if (!getPilotZipEntry(zip)) notFound();

  const sp = await searchParams;
  const hasAuthError = paramValue(sp.error) === "1";

  // ── Gate: exact Owner Files admin pattern ──
  if (!isOwnerFilesAdminConfigured()) {
    return (
      <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6">
          <h1 className="font-editorial text-[38px]">Vacancy report not configured</h1>
          <p className="mt-3 text-[#0C1B33]/45">
            Set <code>OWNER_FILES_ADMIN_PASSWORD</code> before using the admin Vacancy
            Opportunity Index.
          </p>
        </div>
      </main>
    );
  }

  const cookieStore = await cookies();
  const hasSession = hasValidOwnerFilesAdminSession(
    cookieStore.get(OWNER_FILES_ADMIN_COOKIE)?.value,
    cookieStore.get(ANALYTICS_ADMIN_COOKIE)?.value,
  );

  if (!hasSession) {
    return (
      <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <form
          method="post"
          action="/api/admin/owner-files/login"
          className="mx-auto max-w-md border border-[#0C1B33]/10 bg-white p-6"
        >
          <span className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#2563EB]">
            Vacancy Opportunity Index
          </span>
          <h1 className="mt-4 font-editorial text-[38px]">Enter admin password</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-[#0C1B33]/45">
            The web report is admin-gated alongside Owner Files. The shareable PDF edition it
            produces is anonymized (owner types only, no names) and safe to hand to partners.
          </p>
          <input type="hidden" name="redirectTo" value={`/vacancy/${zip}`} />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            className="mt-5 w-full border border-[#0C1B33]/15 bg-white px-4 py-3 text-[14px] outline-none focus:border-[#2563EB]"
            placeholder="Owner Files password"
          />
          {hasAuthError ? (
            <p className="mt-3 text-[12px] text-red-600">That password did not match. Try again.</p>
          ) : null}
          <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/45">
            Your analytics admin session also opens this report — log in there once and this gate
            disappears.
          </p>
          <button className="mt-4 w-full bg-[#0C1B33] px-4 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.16em] text-white">
            Open Vacancy Report
          </button>
        </form>
      </main>
    );
  }

  // ── Authed: load the edition + the shared adapter output ──
  const exportData = loadVacancyIndex();
  const edition = exportData?.editions[zip] ?? null;
  const pdfInput = exportData ? buildVacancyIndexPdfInput(exportData, zip) : null;
  const pilotEntry = getPilotZipEntry(zip)!;

  if (!exportData || !edition || !pdfInput) {
    return (
      <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6">
          <h1 className="font-editorial text-[38px]">Edition not yet available</h1>
          <p className="mt-3 text-[#0C1B33]/45">
            The Vacancy Opportunity Index export for {pilotEntry.primaryNeighborhood} (ZIP {zip})
            has not been generated yet. Run <code>npm run vacancy:index:export</code> to build it.
          </p>
        </div>
      </main>
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
  const privatelyHeld = pdfInput.counts.privatelyHeld;
  const inIncentive = headline.inIncentiveZoneCount;
  const privatePct = total > 0 ? Math.round((privatelyHeld / total) * 100) : 0;
  const cityPct = total > 0 ? Math.round((cityOwned / total) * 100) : 0;
  const allInIncentive = total > 0 && inIncentive === total;

  // ── Ownership universes (the two panels — deliberately NOT a breakdown pair) ──
  const trackedRows: Array<{ ownerType: OwnerType; count: number }> =
    ownership.trackedInventoryByOwnerType.map((r) => ({
      ownerType: normalizeOwnerType(r.ownerType),
      count: r.count,
    }));
  const trackedMax = Math.max(1, ...trackedRows.map((r) => r.count));

  const reconciledRows = ownership.reconciledVacantLandByOwnerType;
  const reconciledMax = reconciledRows ? Math.max(1, ...reconciledRows.map((r) => r.count)) : 1;
  const reconciledTotal = reconciledRows
    ? reconciledRows.reduce((sum, r) => sum + r.count, 0)
    : null;
  const reclassifiedCount = ownership.reconciliation?.reclassifiedCount ?? 0;
  const inventoryUnmatchedCount = ownership.reconciliation?.inventoryUnmatchedCount ?? 0;
  const rawCityCount =
    ownership.vacantLandParcelsByOwnerType?.find((r) => normalizeOwnerType(r.ownerType) === "city_public")
      ?.count ?? null;
  const distress = edition.distress;

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

  // ── Readiness portfolios ──
  // The full tracked universe isn't available page-side, so portfolio counts are
  // computed across the (capped) mapped sitePoints and honestly labeled as such.
  // Site-index rows carry no saleYear/violation, so those distress inputs are
  // recovered by coordinate from the sitePoints that DO carry them.
  const sitePointByCoord = new Map<string, VacancySitePoint>(
    edition.sitePoints.map((p) => [`${p.lat},${p.lon}`, p]),
  );
  const mappedCap = edition.sitePoints.length;
  const portfolioCounts: Record<VacancyPortfolio, number> = {
    move_now: 0,
    organize_next: 0,
    verify: 0,
    long_term: 0,
  };
  for (const p of edition.sitePoints) {
    const portfolio = portfolioForSite({
      ownerType: normalizeOwnerType(p.ownerType),
      priorityTier: p.priorityTier,
      saleYear: p.saleYear,
      violation: p.violation,
    });
    portfolioCounts[portfolio] += 1;
  }

  const neighborhoodBrief = `${pilotEntry.primaryNeighborhood} carries ${total.toLocaleString(
    "en-US",
  )} tracked vacant properties. ${cityOwned.toLocaleString(
    "en-US",
  )} are City- or public-controlled and can move toward disposition without owner outreach; the remaining ${privatelyHeld.toLocaleString(
    "en-US",
  )} are privately held and start with direct contact or ownership verification. ${
    allInIncentive
      ? "Every tracked site sits inside at least one incentive geography"
      : `${inIncentive.toLocaleString("en-US")} of ${total.toLocaleString(
          "en-US",
        )} sit inside at least one incentive geography`
  }, so the location already qualifies for programs before any conversation begins. Revitalization here is not a single deal — it is public-land disposition, local-owner partnerships, absentee-owner outreach, and records verification, run cluster by cluster.`;

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 font-mono-bureau text-[12px] text-[#0C1B33]/50">
          <Link href="/admin" className="hover:text-[#2563EB]">
            Admin
          </Link>
          <span>/</span>
          <Link href="/admin/owner-files" className="hover:text-[#2563EB]">
            Owner Files
          </Link>
          <span>/</span>
          <span className="text-[#0C1B33]/80">Vacancy Report</span>
        </nav>

        {/* Neighborhood switcher */}
        <div className="mb-6 flex flex-wrap gap-1.5">
          {PILOT_ZIPS.map((entry) => {
            const active = entry.zip === zip;
            return (
              <Link
                key={entry.zip}
                href={`/vacancy/${entry.zip}`}
                className={`px-2.5 py-1 font-mono-bureau text-[10px] uppercase tracking-[0.06em] border transition-colors ${
                  active
                    ? "bg-[#0C1B33] text-white border-[#0C1B33]"
                    : "bg-white text-[#0C1B33]/55 border-[#0C1B33]/15 hover:border-[#2563EB]/40 hover:text-[#2563EB]"
                }`}
              >
                {entry.primaryNeighborhood}
              </Link>
            );
          })}
        </div>

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
              <div className="font-editorial text-[34px] leading-none">{privatePct}%</div>
              <div className="mt-2 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                Privately held
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

        {/* 4 · Who controls the opportunity */}
        <section className="mt-10">
          <h2 className="mb-4 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
            Who controls the opportunity
          </h2>
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-[13px] font-semibold text-[#0C1B33]">
                City&rsquo;s tracked inventory — {total.toLocaleString("en-US")} properties
                <span className="ml-2 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                  COLS + 311
                </span>
              </h3>
              <div className="space-y-2.5">
                {OWNER_TYPE_ORDER.map((type) => {
                  const row = trackedRows.find((r) => r.ownerType === type);
                  return (
                    <OwnerBar key={type} ownerType={type} count={row?.count ?? 0} max={trackedMax} />
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-[13px] font-semibold text-[#0C1B33]">
                Assessor-classed vacant land
                {reconciledTotal != null ? ` — ${reconciledTotal.toLocaleString("en-US")} parcels` : ""}
                <span className="ml-2 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                  Reconciled
                </span>
              </h3>
              {reconciledRows ? (
                <>
                  <div className="space-y-2.5">
                    {OWNER_TYPE_ORDER.map((type) => {
                      const row = reconciledRows.find((r) => normalizeOwnerType(r.ownerType) === type);
                      return (
                        <OwnerBar key={type} ownerType={type} count={row?.count ?? 0} max={reconciledMax} />
                      );
                    })}
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-[#0C1B33]/45">
                    City/Public from the City&rsquo;s own land inventory (PIN-matched); private
                    classifications from taxpayer-of-record patterns.{" "}
                    {reclassifiedCount.toLocaleString("en-US")} parcels reclassified from stale
                    assessor records; {inventoryUnmatchedCount.toLocaleString("en-US")} City-inventory
                    parcels are not classed as vacant land by the assessor (city land is mostly
                    tax-exempt) and appear only in the tracked inventory.
                    {rawCityCount != null && (
                      <>
                        {" "}
                        Raw taxpayer records alone would show City/Public{" "}
                        {rawCityCount.toLocaleString("en-US")}.
                      </>
                    )}
                  </p>
                </>
              ) : (
                <div className="border border-dashed border-[#0C1B33]/20 bg-white px-4 py-6 text-center">
                  <span className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                    Not yet available
                  </span>
                  <p className="mt-2 text-[12px] leading-relaxed text-[#0C1B33]/45">
                    The complete assessor-parcel ownership series could not be built for this ZIP on
                    the last refresh.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Not-a-breakdown caveat (verbatim) */}
          <p className="mt-5 border-l-2 border-[#0C1B33]/25 pl-3 text-[12px] leading-relaxed text-[#0C1B33]/60">
            These are different analytical universes and should not be compared as if one is a
            breakdown of the other.
          </p>

          {/* Property-type split + distress chips */}
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-[13px] font-semibold text-[#0C1B33]">Property-type split</h3>
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
                  {headline.vacantLandCount.toLocaleString("en-US")} tracked as vacant land in the
                  City inventory ({landPct}%)
                </span>
                <span>
                  {headline.vacantBuildingCount.toLocaleString("en-US")} reported vacant buildings
                  (311) ({buildingPct}%)
                </span>
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-[13px] font-semibold text-[#0C1B33]">Distress signals</h3>
              <div className="flex flex-wrap gap-2">
                {distress && distress.taxSaleExposedCount != null ? (
                  <span className="inline-flex items-center gap-1.5 border border-[#0C1B33]/25 bg-white px-3 py-1.5 text-[11px] text-[#0C1B33]/80">
                    <span
                      className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: DISTRESS_RED }}
                    />
                    Tax-sale exposure
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
          </div>

          {/* Section takeaway (verbatim) */}
          <p className="mt-8 text-[15px] font-semibold leading-relaxed text-[#0C1B33]">
            Revitalization cannot depend on one acquisition strategy. It requires public-land
            disposition, local-owner partnerships, absentee-owner outreach, and targeted ownership
            verification.
          </p>
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

        {/* 7 · Readiness portfolios */}
        <section className="mt-10">
          <h2 className="mb-4 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
            Readiness portfolios
          </h2>
          <div className="grid grid-cols-2 gap-px border border-[#0C1B33]/10 bg-[#0C1B33]/10 sm:grid-cols-4">
            {PORTFOLIO_ORDER.map((portfolio) => (
              <div key={portfolio} className="bg-white px-4 py-4">
                <div className="font-editorial text-[30px] leading-none">
                  {portfolioCounts[portfolio].toLocaleString("en-US")}
                </div>
                <div className="mt-2">
                  <PortfolioChip portfolio={portfolio} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
            of the {mappedCap.toLocaleString("en-US")} mapped sites
          </p>

          {/* Site index */}
          <h3 className="mb-4 mt-8 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/50">
            Site index — top {siteIndex.length} by priority
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
                  <th className="px-3 py-2.5">Priority</th>
                  <th className="px-3 py-2.5">Portfolio</th>
                  <th className="px-3 py-2.5">Next step</th>
                </tr>
              </thead>
              <tbody>
                {siteIndex.map((row, i) => {
                  const ownerType = normalizeOwnerType(row.ownerType);
                  const chip = PRIORITY_CHIP[row.priorityTier];
                  const sitePoint = sitePointByCoord.get(`${row.lat},${row.lon}`);
                  const portfolio = portfolioForSite({
                    ownerType,
                    priorityTier: row.priorityTier,
                    saleYear: sitePoint?.saleYear ?? null,
                    violation: sitePoint?.violation ?? false,
                  });
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
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-block px-2 py-0.5 font-mono-bureau text-[9px] font-semibold tracking-[0.08em]"
                          style={{ backgroundColor: chip.bg, color: chip.fg }}
                        >
                          {chip.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <PortfolioChip portfolio={portfolio} />
                      </td>
                      <td className="px-3 py-2.5 text-[11px] leading-snug text-[#0C1B33]/55">
                        {row.nextStep}
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
            <p>{PRIORITY_RUBRIC_NOTE}</p>
            <p>{PORTFOLIO_RUBRIC_NOTE}</p>
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
              indicate; verify current ownership, eligibility, timing, and approval requirements with
              the administering organization before relying.
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}
