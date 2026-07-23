/**
 * Maps a committed vacancy-index export (lib/vacancy-index.ts shapes) onto the
 * PDF builder's input contract (lib/vacancy-index-pdf.ts). Client-safe on
 * purpose: the loader in lib/vacancy-index.ts touches `fs`, so this adapter
 * lives apart and imports export-side shapes as types only — the download
 * button fetches /data/vacancy-index.json itself and hands the parsed object
 * here.
 *
 * Invariant (the builder depends on it): `sitePoints[0..N]` positionally
 * align with `topSites[0..N]` — the map's numbered markers take coordinates
 * from sitePoints and labels from topSites at the same index. Site-index rows
 * therefore lead the sitePoints array; the remaining dots are deduped against
 * them by coordinate so the map legend's per-type counts stay consistent with
 * the page-01 numbers.
 */

import { OWNER_TYPE_LABELS } from "./owner-classify";
import type { VacancyIndexEdition, VacancyIndexExport, VacancyMatrixCell } from "./vacancy-index";
import type {
  VacancyIndexDecision,
  VacancyIndexInput,
  VacancyIndexMatrixCell,
} from "./vacancy-index-pdf";

function fmtCount(value: number | null): string | null {
  return value === null ? null : value.toLocaleString("en-US");
}

/** Shares arrive as 0–1 fractions from corridor-metrics; tolerate pre-scaled values. */
function fmtShare(value: number | null): string | null {
  if (value === null) return null;
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
}

function toCell(label: string, cell: VacancyMatrixCell, fmt: (v: number | null) => string | null): VacancyIndexMatrixCell {
  return { label, value: fmt(cell.value), dots: cell.dots };
}

/** Fixed copy templates driven only by real fields — no projections, ever.
 * Exported so the web report (app/vacancy/[zip]/page.tsx) renders the same
 * three decisions as the PDF without duplicating the copy logic. */
export function buildDecisions(edition: VacancyIndexEdition): VacancyIndexDecision[] {
  const { headline } = edition;
  const candidates: VacancyIndexDecision[] = [];

  const bloc = edition.ownership.trackedInventoryByOwnerType
    .slice()
    .sort((a, b) => b.count - a.count)[0];
  if (bloc && bloc.count > 0) {
    candidates.push({
      title: "Target the largest owner bloc",
      body: `${bloc.count.toLocaleString("en-US")} tracked properties share the ${OWNER_TYPE_LABELS[bloc.ownerType]} owner type — the widest single outreach lane.`,
    });
  }

  if (headline.cityOwnedCount > 0) {
    candidates.push({
      title: "Move city-owned land toward disposition",
      body: `${headline.cityOwnedCount.toLocaleString("en-US")} City/Public parcels can enter a CCLBA/City disposition inquiry without an owner-outreach letter.`,
    });
  } else {
    candidates.push({
      title: "Open the private-owner outreach lane",
      body: "No city-owned parcels are tracked in this ZIP — every next step runs through owner verification and direct outreach.",
    });
  }

  if (headline.vacantBuildingCount > 0) {
    candidates.push({
      title: "Run a verification sweep on the reported buildings",
      body: `${headline.vacantBuildingCount.toLocaleString("en-US")} 311-reported vacant buildings warrant a parcel-match and ownership/status verification pass before any letter.`,
    });
  }

  if (candidates.length < 3 && headline.inIncentiveZoneCount > 0) {
    candidates.push({
      title: "Lead with the incentive context",
      body: `${headline.inIncentiveZoneCount.toLocaleString("en-US")} sites sit inside at least one mapped incentive zone — open every conversation with what the location already qualifies for.`,
    });
  }

  return candidates.slice(0, 3);
}

export function buildVacancyIndexPdfInput(
  exportData: VacancyIndexExport,
  zip: string,
): VacancyIndexInput | null {
  const edition = exportData.editions[zip];
  if (!edition) return null;

  const { headline, ownership } = edition;
  // The non-city tracked records. In practice this equals the 311-reported
  // vacant buildings (cityOwnedCount === vacantLandCount for every pilot ZIP),
  // whose ownership is UNVERIFIED — never assert "privately held" in display
  // copy. The field name is kept for the PDF contract; its label is
  // "Ownership unverified".
  const privatelyHeld = headline.vacantPropertyCount - headline.cityOwnedCount;

  const trackedInventoryByOwnerType = Object.fromEntries(
    ownership.trackedInventoryByOwnerType.map((entry) => [entry.ownerType, entry.count]),
  );
  const ownerTypeDistribution = ownership.vacantLandParcelsByOwnerType
    ? Object.fromEntries(
        ownership.vacantLandParcelsByOwnerType.map((entry) => [entry.ownerType, entry.count]),
      )
    : null;
  const reconciledOwnerTypeDistribution = ownership.reconciledVacantLandByOwnerType
    ? Object.fromEntries(
        ownership.reconciledVacantLandByOwnerType.map((entry) => [entry.ownerType, entry.count]),
      )
    : null;

  // Reconciliation copy — caller-supplied so the PDF builder never invents it.
  const reclassifiedCount = ownership.reconciliation?.reclassifiedCount ?? 0;
  const inventoryUnmatched = ownership.reconciliation?.inventoryUnmatchedCount ?? 0;
  const reconciliationNote = ownership.reconciledVacantLandByOwnerType
    ? `City/Public from the City's own land inventory (PIN-matched); private classifications from taxpayer-of-record patterns. ${reclassifiedCount.toLocaleString("en-US")} parcels reclassified from stale assessor records; ${inventoryUnmatched.toLocaleString("en-US")} City-inventory parcels are not classed as vacant land by the assessor (city land is mostly tax-exempt) and appear only in the tracked inventory. These are different analytical universes and should not be compared as if one is a breakdown of the other.`
    : null;
  const rawCityCount =
    ownership.vacantLandParcelsByOwnerType?.find((entry) => entry.ownerType === "city_public")?.count ?? null;
  const rawOwnerComparisonNote =
    ownership.reconciledVacantLandByOwnerType && rawCityCount != null
      ? `Raw taxpayer records alone would show City/Public ${rawCityCount.toLocaleString("en-US")} — see methodology.`
      : null;

  const distress = edition.distress
    ? {
        taxSaleExposedCount: edition.distress.taxSaleExposedCount,
        latestTaxSaleYear: edition.distress.latestTaxSaleYear,
        violationMatchCount: edition.distress.violationMatchCount,
      }
    : null;

  // Largest outer ring; the export writes hole rings after their shell.
  const boundary = edition.boundary
    ? (edition.boundary.rings
        .slice()
        .sort((a, b) => b.length - a.length)[0] ?? null)
    : null;

  // Site-index rows carry no PIN, but the aligned sitePoints do. Recover each
  // row's PIN by coordinate (the same join the web report uses) so the PDF's
  // ADDRESS cell can link out to CookViewer; 311 rows carry no PIN -> null.
  const pinByCoord = new Map<string, string | null>(
    edition.sitePoints.map((p) => [`${p.lat},${p.lon}`, p.pin]),
  );

  const siteIndexCoords = new Set(edition.siteIndex.map((row) => `${row.lat},${row.lon}`));
  const sitePoints = [
    ...edition.siteIndex.map((row) => ({ lat: row.lat, lon: row.lon, ownerType: row.ownerType })),
    ...edition.sitePoints
      .filter((point) => !siteIndexCoords.has(`${point.lat},${point.lon}`))
      .map((point) => ({ lat: point.lat, lon: point.lon, ownerType: point.ownerType })),
  ];

  const asOf = new Date(exportData.generatedAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const total = headline.vacantPropertyCount;
  const brief = `${edition.neighborhood} carries ${total.toLocaleString("en-US")} tracked vacant properties across ZIP ${edition.zip}. ${headline.cityOwnedCount.toLocaleString("en-US")} are City/Public-owned and ${privatelyHeld.toLocaleString("en-US")} carry unverified ownership (311-reported vacant buildings not yet parcel-matched); ${headline.inIncentiveZoneCount.toLocaleString("en-US")} sit inside at least one mapped incentive zone. The site index highlights featured parcels so a corridor manager can start with the clearest next contact.`;

  return {
    neighborhood: edition.neighborhood,
    zipCode: edition.zip,
    editionNumber: edition.editionNumber,
    asOf,
    counts: {
      total,
      cityOwned: headline.cityOwnedCount,
      privatelyHeld,
      inIncentiveZones: headline.inIncentiveZoneCount,
    },
    brief,
    decisions: buildDecisions(edition),
    ownerTypeDistribution,
    reconciledOwnerTypeDistribution,
    reconciliationNote,
    rawOwnerComparisonNote,
    distress,
    trackedInventoryByOwnerType,
    propertyTypeBreakdown: {
      vacantLand: headline.vacantLandCount,
      vacantBuilding: headline.vacantBuildingCount,
    },
    matrixRows: exportData.matrix
      .slice()
      .sort((a, b) => a.editionNumber - b.editionNumber)
      .map((row) => ({
        area: row.neighborhood,
        zip: row.zip,
        isSubject: row.zip === zip,
        cells: [
          toCell("Tracked Vacant", row.trackedVacantCount, fmtCount),
          toCell("Vacancy Rate", row.vacancyRate, fmtShare),
          toCell("Local Ownership", row.localOwnershipShare, fmtShare),
          toCell("Building Share", row.reportedBuildingShare, fmtShare),
          toCell("City-Owned Share", row.cityOwnedShare, fmtShare),
        ],
      })),
    boundary,
    centroid: edition.centroid,
    sitePoints,
    transport: edition.transport,
    topSites: edition.siteIndex.map((row) => ({
      address: row.address,
      ownerType: row.ownerType,
      propertyType: row.propertyType,
      zoning: row.zoningClass,
      sqft: row.squareFeet,
      nextStep: row.nextStep,
      pin: pinByCoord.get(`${row.lat},${row.lon}`) ?? null,
    })),
    sources: [
      exportData.sources.trackedInventory,
      exportData.sources.vacantLandOwnership,
      exportData.sources.corridorMetrics,
      exportData.sources.zipBoundaries,
      exportData.sources.transportNetwork,
    ],
  };
}
