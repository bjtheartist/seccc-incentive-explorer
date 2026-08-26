/**
 * lib/permit-exhibit-fixtures.ts — realistic, typed PermitExhibitResult
 * fixtures for Phase A of the Permit History Exhibit surface (PR2). Used by:
 *   - lib/permit-exhibit-source.ts (Phase A data source, swapped for the
 *     real spine import once feat/permit-exhibit-spine lands — see that
 *     file's header comment for the Phase A -> Phase B plan),
 *   - every component/page render test in components/permit-exhibit/__tests__
 *     and app/permit-exhibit, so section rendering can be asserted against
 *     known inputs without a database or the spine module.
 *
 * Every fixture is shaped exactly like the frozen PR1 contract
 * (lib/permit-exhibit-types.ts) so swapping the real data source in later
 * requires no changes to any test that imports these builders directly.
 */

import {
  PERMIT_EXHIBIT_DEFAULT_RADIUS_FT,
  type PermitExhibitBoundaryContext,
  type PermitExhibitCoverage,
  type PermitExhibitMeta,
  type PermitExhibitResult,
  type PermitExhibitRow,
  type PermitExhibitMatchMethod,
} from "./permit-exhibit-types";

let rowCounter = 0;

export function fixturePermitExhibitRow(
  overrides: Partial<PermitExhibitRow> = {},
): PermitExhibitRow {
  rowCounter += 1;
  return {
    issueDate: "2019-05-14",
    permitNumber: `10${String(1000000 + rowCounter).padStart(7, "0")}`,
    type: "PERMIT - RENOVATION/ALTERATION",
    workDescription: "INTERIOR BUILD-OUT OF EXISTING COMMERCIAL SPACE",
    estimatedCostSelfReported: 42_000,
    status: "PERMIT ISSUED",
    matchMethod: "pin_parcel",
    ...overrides,
  };
}

function coverageFor(rows: PermitExhibitRow[], unlocatedCount = 3): PermitExhibitCoverage {
  const counts = { pinParcel: 0, addressExact: 0, proximity: 0 };
  for (const row of rows) {
    if (row.matchMethod === "pin_parcel") counts.pinParcel += 1;
    else if (row.matchMethod === "address_exact") counts.addressExact += 1;
    else counts.proximity += 1;
  }
  const geolocatedRows = rows.length;
  return {
    totalSourceRowsInRadius: geolocatedRows + unlocatedCount,
    geolocatedRows,
    unlocatedCount,
    matchMethodCounts: counts,
  };
}

function metaFor(pin: string, radiusFt: number, exhibitId: string): PermitExhibitMeta {
  return {
    snapshotDate: "2026-08-24",
    datasetLastUpdate: "2026-08-24T06:15:00.000Z",
    exhibitId,
    queryParams: { pin, radiusFt },
  };
}

function boundaryContextFor(
  overrides: Partial<PermitExhibitBoundaryContext> = {},
): PermitExhibitBoundaryContext {
  return {
    parcelAddress: "7529 N CLARK ST",
    zoningDistrict: "B3-2",
    tifDistricts: [],
    overlays: [],
    asOfDate: "2026-08-01",
    ...overrides,
  };
}

function byYearFrom(rows: PermitExhibitRow[]): { year: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const year = new Date(row.issueDate).getUTCFullYear();
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count }));
}

function byTypeFrom(rows: PermitExhibitRow[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count }));
}

/**
 * The general-purpose realistic fixture: a subject parcel with a mix of
 * `pin_parcel` and `address_exact` rows (chronological), an area radius
 * that additionally carries `proximity` rows, and a small unlocated count.
 */
export function fixturePermitExhibit(
  overrides: {
    pin?: string;
    radiusFt?: number;
    exhibitId?: string;
    subject?: PermitExhibitRow[];
    areaRows?: PermitExhibitRow[];
    unlocatedCount?: number;
    boundaryContext?: Partial<PermitExhibitBoundaryContext>;
  } = {},
): PermitExhibitResult {
  const pin = overrides.pin ?? "17091190280000";
  const radiusFt = overrides.radiusFt ?? PERMIT_EXHIBIT_DEFAULT_RADIUS_FT;
  const exhibitId = overrides.exhibitId ?? "pex_9f2c1a7e0b3d";

  const subject =
    overrides.subject ??
    [
      fixturePermitExhibitRow({
        issueDate: "2011-03-02",
        permitNumber: "100234567",
        type: "PERMIT - EASY PERMIT PROCESS",
        workDescription: "REPLACE (3) ROOFTOP HVAC UNITS IN KIND",
        estimatedCostSelfReported: 18_500,
        status: "PERMIT ISSUED",
        matchMethod: "pin_parcel",
      }),
      fixturePermitExhibitRow({
        issueDate: "2016-09-21",
        permitNumber: "100561234",
        type: "PERMIT - RENOVATION/ALTERATION",
        workDescription: "INTERIOR BUILD-OUT FOR NEW RESTAURANT TENANT",
        estimatedCostSelfReported: 125_000,
        status: "PERMIT ISSUED",
        matchMethod: "address_exact",
      }),
      fixturePermitExhibitRow({
        issueDate: "2022-06-11",
        permitNumber: "100987654",
        type: "PERMIT - SIGNS",
        workDescription: "INSTALL ILLUMINATED WALL SIGN",
        estimatedCostSelfReported: 6_200,
        status: "PERMIT ISSUED",
        matchMethod: "pin_parcel",
      }),
    ];

  const areaRows =
    overrides.areaRows ??
    [
      ...subject,
      fixturePermitExhibitRow({
        issueDate: "2018-01-30",
        permitNumber: "100445566",
        type: "PERMIT - NEW CONSTRUCTION",
        workDescription: "NEW 2-STORY MIXED-USE BUILDING",
        estimatedCostSelfReported: 890_000,
        status: "PERMIT ISSUED",
        matchMethod: "proximity",
      }),
      fixturePermitExhibitRow({
        issueDate: "2020-11-04",
        permitNumber: "100778899",
        type: "PERMIT - ELECTRIC WIRING",
        workDescription: "SERVICE UPGRADE, 400 AMP",
        estimatedCostSelfReported: 9_800,
        status: "PERMIT ISSUED",
        matchMethod: "proximity",
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
    coverage: coverageFor(areaRows, overrides.unlocatedCount ?? 4),
    meta: metaFor(pin, radiusFt, exhibitId),
  };
}

/** No permits at all on the subject parcel, but area rows exist — the
 *  honest "zero subject rows" case (never a false unavailable state). */
export function fixturePermitExhibitEmptySubject(): PermitExhibitResult {
  const areaRows = [
    fixturePermitExhibitRow({
      issueDate: "2021-04-18",
      permitNumber: "100112233",
      type: "PERMIT - RENOVATION/ALTERATION",
      matchMethod: "proximity",
    }),
    fixturePermitExhibitRow({
      issueDate: "2023-02-09",
      permitNumber: "100223344",
      type: "PERMIT - SIGNS",
      matchMethod: "proximity",
    }),
  ];
  return {
    subject: [],
    area: {
      byYear: byYearFrom(areaRows),
      byType: byTypeFrom(areaRows),
      rows: areaRows,
    },
    boundaryContext: boundaryContextFor({ parcelAddress: "1200 W VACANT PARCEL AVE" }),
    coverage: coverageFor(areaRows, 1),
    meta: metaFor("16111050040000", PERMIT_EXHIBIT_DEFAULT_RADIUS_FT, "pex_00000empty01"),
  };
}

/** Every area row is `proximity` — nothing matched the subject parcel
 *  itself. Exercises the "Nearby, not matched to this parcel" subsection
 *  in isolation, with an empty main S1 table. */
export function fixturePermitExhibitProximityOnly(): PermitExhibitResult {
  const areaRows = [
    fixturePermitExhibitRow({
      issueDate: "2017-08-01",
      permitNumber: "100334455",
      type: "PERMIT - NEW CONSTRUCTION",
      matchMethod: "proximity",
    }),
    fixturePermitExhibitRow({
      issueDate: "2019-12-15",
      permitNumber: "100556677",
      type: "PERMIT - DEMOLITION",
      matchMethod: "proximity",
    }),
    fixturePermitExhibitRow({
      issueDate: "2024-03-27",
      permitNumber: "100667788",
      type: "PERMIT - ELECTRIC WIRING",
      matchMethod: "proximity",
    }),
  ];
  return {
    subject: [],
    area: {
      byYear: byYearFrom(areaRows),
      byType: byTypeFrom(areaRows),
      rows: areaRows,
    },
    boundaryContext: boundaryContextFor({ parcelAddress: "3300 S PROXIMITY ONLY ST" }),
    coverage: coverageFor(areaRows, 0),
    meta: metaFor("20363230080000", PERMIT_EXHIBIT_DEFAULT_RADIUS_FT, "pex_proximityonly1"),
  };
}

/** A parcel with a large unlocated count relative to geolocated rows — for
 *  asserting the S4 coverage arithmetic renders the honest unlocated note. */
export function fixturePermitExhibitHighUnlocated(): PermitExhibitResult {
  const base = fixturePermitExhibit({
    pin: "14212030050000",
    exhibitId: "pex_highunlocated1",
    unlocatedCount: 41,
  });
  return base;
}

/** Every match method represented at least once in BOTH the subject rows
 *  (pin_parcel, address_exact) and the area-only rows (proximity) — the
 *  canonical fixture for match-method-exclusivity assertions. */
export const FIXTURE_PERMIT_EXHIBIT_MIXED = fixturePermitExhibit();
