/**
 * lib/permit-exhibit-fixtures.ts — realistic, typed PermitExhibitResult
 * fixtures for the Permit History Exhibit surface (PR2), shaped exactly
 * like the real PR1 spine contract in lib/permit-exhibit.ts (imported
 * directly, not duplicated). Used by:
 *   - lib/permit-exhibit-source.ts's mockable module boundary in tests
 *     (page/route tests mock "@/lib/permit-exhibit-source" the same way
 *     app/vacancy/[zip]/shortlist's tests mock "@/lib/shortlist-universe"),
 *   - every component render test in components/permit-exhibit/__tests__,
 *     so section rendering can be asserted against known inputs without a
 *     database.
 */

import {
  PERMIT_EXHIBIT_COST_LABEL,
  PERMIT_EXHIBIT_COVERAGE_NOTE,
  PERMIT_EXHIBIT_DEFAULT_RADIUS_FT,
  PERMIT_EXHIBIT_LIMITS,
  PERMIT_EXHIBIT_MATCH_CONFIDENCE,
  buildPermitSourceRecordUrl,
  formatBoundaryContextLimitNote,
  formatExhibitIdFooter,
  type PermitExhibitAreaLocation,
  type PermitExhibitAreaRow,
  type PermitExhibitBoundaryContext,
  type PermitExhibitCoverage,
  type PermitExhibitMatchMethod,
  type PermitExhibitMeta,
  type PermitExhibitResult,
  type PermitExhibitSubjectRow,
  type PermitExhibitTypeCount,
  type PermitExhibitYearCount,
} from "./permit-exhibit";

let rowCounter = 0;

function nextPermitNumber(): string {
  rowCounter += 1;
  return `10${String(1000000 + rowCounter).padStart(7, "0")}`;
}

export function fixturePermitExhibitSubjectRow(
  overrides: Partial<PermitExhibitSubjectRow> = {},
): PermitExhibitSubjectRow {
  const permitNumber = overrides.permitNumber ?? nextPermitNumber();
  const matchMethod: PermitExhibitMatchMethod = overrides.matchMethod ?? "pin_parcel";
  return {
    permitNumber,
    type: "Renovation/Alteration",
    typeKey: "renovation_alteration",
    rawType: "PERMIT - RENOVATION/ALTERATION",
    workDescription: "INTERIOR BUILD-OUT OF EXISTING COMMERCIAL SPACE",
    issueDate: "2019-05-14",
    estimatedCostSelfReported: 42_000,
    status: "PERMIT ISSUED",
    milestone: null,
    matchMethod,
    matchConfidence: PERMIT_EXHIBIT_MATCH_CONFIDENCE[matchMethod],
    sourceRecordUrl: buildPermitSourceRecordUrl(permitNumber),
    ...overrides,
  };
}

export function fixturePermitExhibitAreaRow(
  overrides: Partial<PermitExhibitAreaRow> = {},
): PermitExhibitAreaRow {
  const permitNumber = overrides.permitNumber ?? nextPermitNumber();
  return {
    permitNumber,
    type: "Renovation/Alteration",
    typeKey: "renovation_alteration",
    rawType: "PERMIT - RENOVATION/ALTERATION",
    workDescription: "INTERIOR BUILD-OUT",
    issueDate: "2019-05-14",
    estimatedCostSelfReported: 42_000,
    status: "PERMIT ISSUED",
    milestone: null,
    sourceRecordUrl: buildPermitSourceRecordUrl(permitNumber),
    locatedVia: "point" as PermitExhibitAreaLocation,
    ...overrides,
  };
}

function coverageFor(
  subject: PermitExhibitSubjectRow[],
  areaRows: PermitExhibitAreaRow[],
): PermitExhibitCoverage {
  return {
    matchMethodBreakdown: {
      pinParcel: subject.filter((row) => row.matchMethod === "pin_parcel").length,
      addressExact: subject.filter((row) => row.matchMethod === "address_exact").length,
      proximity: subject.filter((row) => row.matchMethod === "proximity").length,
    },
    area: {
      geolocatedCount: areaRows.filter((row) => row.locatedVia === "point").length,
      unlocatedCount: areaRows.filter((row) => row.locatedVia === "address_only").length,
      totalCount: areaRows.length,
    },
    coverageNote: PERMIT_EXHIBIT_COVERAGE_NOTE,
  };
}

function metaFor(pin: string, radiusFt: number, exhibitId: string, situsAddress: string | null): PermitExhibitMeta {
  return {
    snapshotDate: "2026-08-24",
    datasetLastUpdate: "2026-08-24T06:15:00.000Z",
    exhibitId,
    queryParams: { pin, pinFormatted: pin, radiusFt, filters: {} },
    sourceLabel: "City of Chicago Building Permits (ydr8-5enu)",
    sourceUrl: "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu/about_data",
    sourcePortalUrl: "https://webapps1.chicago.gov/buildingrecords/",
    historyWindow: "full_ingested_history",
    ingestFloorDate: "2006-01-01",
    costLabel: PERMIT_EXHIBIT_COST_LABEL,
    limitsBlock: PERMIT_EXHIBIT_LIMITS,
    exhibitIdFooter: formatExhibitIdFooter(exhibitId),
    subjectParcel: { pin, pinFormatted: pin, situsAddress },
  };
}

function boundaryContextFor(
  overrides: Partial<PermitExhibitBoundaryContext> = {},
): PermitExhibitBoundaryContext {
  const asOfDate = "2026-08-01";
  return {
    asOfDate,
    parcelAddress: "7529 N CLARK ST",
    zoningDistrict: {
      status: "resolved",
      zoneClass: "B3-2",
      recordUpdatedAt: "2025-01-15",
      sourceLabel: "City of Chicago zoning boundaries",
      sourceUrl: "https://data.cityofchicago.org/Community-Economic-Development/Boundaries-Zoning-Districts-current-/dj47-wfun",
    },
    tifDistricts: [],
    overlays: [],
    archiveVintageRange: { earliest: null, latest: null, snapshotCount: 0 },
    limitNote: formatBoundaryContextLimitNote(asOfDate),
    ...overrides,
  };
}

function byYearFrom(rows: { issueDate: string | null }[]): PermitExhibitYearCount[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (!row.issueDate) continue;
    const year = new Date(row.issueDate).getUTCFullYear();
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count }));
}

function byTypeFrom(rows: { typeKey: PermitExhibitAreaRow["typeKey"]; type: string }[]): PermitExhibitTypeCount[] {
  const counts = new Map<string, { key: PermitExhibitAreaRow["typeKey"]; label: string; count: number }>();
  for (const row of rows) {
    const bucketKey = row.typeKey ?? row.type;
    const existing = counts.get(bucketKey);
    if (existing) existing.count += 1;
    else counts.set(bucketKey, { key: row.typeKey, label: row.type, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * The general-purpose realistic fixture: a subject parcel with a mix of
 * `pin_parcel` and `address_exact` rows (chronological), an area radius
 * that additionally carries `address_only` rows, and a small unlocated
 * count.
 */
export function fixturePermitExhibit(
  overrides: {
    pin?: string;
    radiusFt?: number;
    exhibitId?: string;
    subject?: PermitExhibitSubjectRow[];
    areaRows?: PermitExhibitAreaRow[];
    boundaryContext?: Partial<PermitExhibitBoundaryContext>;
  } = {},
): PermitExhibitResult {
  const pin = overrides.pin ?? "17091190280000";
  const radiusFt = overrides.radiusFt ?? PERMIT_EXHIBIT_DEFAULT_RADIUS_FT;
  const exhibitId = overrides.exhibitId ?? "pex_9f2c1a7e0b3d";

  const subject =
    overrides.subject ??
    [
      fixturePermitExhibitSubjectRow({
        issueDate: "2011-03-02",
        permitNumber: "100234567",
        type: "Easy Permit Process",
        typeKey: "easy_permit_process",
        rawType: "PERMIT - EASY PERMIT PROCESS",
        workDescription: "REPLACE (3) ROOFTOP HVAC UNITS IN KIND",
        estimatedCostSelfReported: 18_500,
        matchMethod: "pin_parcel",
      }),
      fixturePermitExhibitSubjectRow({
        issueDate: "2016-09-21",
        permitNumber: "100561234",
        type: "Renovation/Alteration",
        typeKey: "renovation_alteration",
        rawType: "PERMIT - RENOVATION/ALTERATION",
        workDescription: "INTERIOR BUILD-OUT FOR NEW RESTAURANT TENANT",
        estimatedCostSelfReported: 125_000,
        matchMethod: "address_exact",
      }),
      fixturePermitExhibitSubjectRow({
        issueDate: "2022-06-11",
        permitNumber: "100987654",
        type: "Signs",
        typeKey: "signs",
        rawType: "PERMIT - SIGNS",
        workDescription: "INSTALL ILLUMINATED WALL SIGN",
        estimatedCostSelfReported: 6_200,
        matchMethod: "pin_parcel",
      }),
      fixturePermitExhibitSubjectRow({
        issueDate: "2014-07-19",
        permitNumber: "100345678",
        type: "New Construction",
        typeKey: "new_construction",
        rawType: "PERMIT - NEW CONSTRUCTION",
        workDescription: "REAR PORCH REPLACEMENT AT ADJACENT LOT",
        estimatedCostSelfReported: 31_000,
        matchMethod: "proximity",
      }),
    ];

  const areaRows =
    overrides.areaRows ??
    [
      ...subject.map((row) => ({
        permitNumber: row.permitNumber,
        type: row.type,
        typeKey: row.typeKey,
        rawType: row.rawType,
        workDescription: row.workDescription,
        issueDate: row.issueDate,
        estimatedCostSelfReported: row.estimatedCostSelfReported,
        status: row.status,
        milestone: row.milestone,
        sourceRecordUrl: row.sourceRecordUrl,
        locatedVia: "point" as PermitExhibitAreaLocation,
      })),
      fixturePermitExhibitAreaRow({
        issueDate: "2018-01-30",
        permitNumber: "100445566",
        type: "New Construction",
        typeKey: "new_construction",
        rawType: "PERMIT - NEW CONSTRUCTION",
        workDescription: "NEW 2-STORY MIXED-USE BUILDING",
        estimatedCostSelfReported: 890_000,
        locatedVia: "point",
      }),
      fixturePermitExhibitAreaRow({
        issueDate: "2020-11-04",
        permitNumber: "100778899",
        type: "Electric Wiring",
        typeKey: null,
        rawType: "PERMIT - ELECTRIC WIRING",
        workDescription: "SERVICE UPGRADE, 400 AMP",
        estimatedCostSelfReported: 9_800,
        locatedVia: "address_only",
      }),
    ];

  return {
    subject,
    area: {
      byYear: byYearFrom(areaRows),
      byType: byTypeFrom(areaRows),
      rows: areaRows,
    },
    boundaryContext: boundaryContextFor(overrides.boundaryContext),
    coverage: coverageFor(subject, areaRows),
    meta: metaFor(pin, radiusFt, exhibitId, boundaryContextFor(overrides.boundaryContext).parcelAddress),
  };
}

/** No permits at all on the subject parcel, but area rows exist — the
 *  honest "zero subject rows" case (never a false unavailable state). */
export function fixturePermitExhibitEmptySubject(): PermitExhibitResult {
  const areaRows: PermitExhibitAreaRow[] = [
    fixturePermitExhibitAreaRow({
      issueDate: "2021-04-18",
      permitNumber: "100112233",
      type: "Renovation/Alteration",
      typeKey: "renovation_alteration",
      locatedVia: "point",
    }),
    fixturePermitExhibitAreaRow({
      issueDate: "2023-02-09",
      permitNumber: "100223344",
      type: "Signs",
      typeKey: "signs",
      locatedVia: "address_only",
    }),
  ];
  const boundaryContext = boundaryContextFor({ parcelAddress: "1200 W VACANT PARCEL AVE" });
  return {
    subject: [],
    area: { byYear: byYearFrom(areaRows), byType: byTypeFrom(areaRows), rows: areaRows },
    boundaryContext,
    coverage: coverageFor([], areaRows),
    meta: metaFor("16111050040000", PERMIT_EXHIBIT_DEFAULT_RADIUS_FT, "pex_00000empty01", boundaryContext.parcelAddress),
  };
}

/** Every subject row is `proximity` — nothing matched the subject parcel
 *  by PIN or address. Exercises the "Nearby, not matched to this parcel"
 *  subsection in isolation, with an empty main S1 table. */
export function fixturePermitExhibitProximityOnly(): PermitExhibitResult {
  const subject: PermitExhibitSubjectRow[] = [
    fixturePermitExhibitSubjectRow({
      issueDate: "2017-08-01",
      permitNumber: "100334455",
      type: "New Construction",
      typeKey: "new_construction",
      matchMethod: "proximity",
    }),
    fixturePermitExhibitSubjectRow({
      issueDate: "2019-12-15",
      permitNumber: "100556677",
      type: "Wrecking/Demolition",
      typeKey: "wrecking_demolition",
      matchMethod: "proximity",
    }),
    fixturePermitExhibitSubjectRow({
      issueDate: "2024-03-27",
      permitNumber: "100667788",
      type: "Electric Wiring",
      typeKey: null,
      matchMethod: "proximity",
    }),
  ];
  const areaRows: PermitExhibitAreaRow[] = subject.map((row) => ({
    permitNumber: row.permitNumber,
    type: row.type,
    typeKey: row.typeKey,
    rawType: row.rawType,
    workDescription: row.workDescription,
    issueDate: row.issueDate,
    estimatedCostSelfReported: row.estimatedCostSelfReported,
    status: row.status,
    milestone: row.milestone,
    sourceRecordUrl: row.sourceRecordUrl,
    locatedVia: "point",
  }));
  const boundaryContext = boundaryContextFor({ parcelAddress: "3300 S PROXIMITY ONLY ST" });
  return {
    subject,
    area: { byYear: byYearFrom(areaRows), byType: byTypeFrom(areaRows), rows: areaRows },
    boundaryContext,
    coverage: coverageFor(subject, areaRows),
    meta: metaFor("20363230080000", PERMIT_EXHIBIT_DEFAULT_RADIUS_FT, "pex_proximityonly1", boundaryContext.parcelAddress),
  };
}

/** A parcel with a large area unlocated count relative to geolocated rows
 *  — for asserting the S4 coverage arithmetic renders the honest unlocated
 *  note. */
export function fixturePermitExhibitHighUnlocated(): PermitExhibitResult {
  const subject = [
    fixturePermitExhibitSubjectRow({ matchMethod: "pin_parcel", issueDate: "2015-01-01" }),
  ];
  const pointRows = Array.from({ length: 5 }, (_, i) =>
    fixturePermitExhibitAreaRow({ issueDate: `201${i}-02-01`, locatedVia: "point" }),
  );
  const addressOnlyRows = Array.from({ length: 41 }, (_, i) =>
    fixturePermitExhibitAreaRow({ issueDate: `200${i % 9}-03-01`, locatedVia: "address_only" }),
  );
  const areaRows = [...pointRows, ...addressOnlyRows];
  const boundaryContext = boundaryContextFor();
  return {
    subject,
    area: { byYear: byYearFrom(areaRows), byType: byTypeFrom(areaRows), rows: areaRows },
    boundaryContext,
    coverage: coverageFor(subject, areaRows),
    meta: metaFor("14212030050000", PERMIT_EXHIBIT_DEFAULT_RADIUS_FT, "pex_highunlocated1", boundaryContext.parcelAddress),
  };
}

/** Every match method represented at least once in the subject rows
 *  (pin_parcel, address_exact, proximity) plus area rows with both
 *  locatedVia values — the canonical fixture for match-method-exclusivity
 *  and separation assertions. */
export const FIXTURE_PERMIT_EXHIBIT_MIXED = fixturePermitExhibit();

/** boundaryContext with a resolved archive vintage range, for testing S3's
 *  archive-availability line. */
export function fixturePermitExhibitWithArchive(): PermitExhibitResult {
  return fixturePermitExhibit({
    boundaryContext: {
      archiveVintageRange: { earliest: "2026-07-01", latest: "2026-08-24", snapshotCount: 12 },
    },
  });
}

/** boundaryContext with an unresolved/not-found zoning status, for testing
 *  S3's status-aware rendering (never collapsed to one "no zoning" state). */
export function fixturePermitExhibitZoningNotFound(): PermitExhibitResult {
  return fixturePermitExhibit({
    boundaryContext: {
      zoningDistrict: {
        status: "not_found",
        zoneClass: null,
        recordUpdatedAt: null,
        sourceLabel: "City of Chicago zoning boundaries",
        sourceUrl: "https://data.cityofchicago.org/Community-Economic-Development/Boundaries-Zoning-Districts-current-/dj47-wfun",
      },
    },
  });
}
