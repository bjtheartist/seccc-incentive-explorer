/**
 * Permit History Exhibit — evidence spine, release-gate suite.
 *
 * Every DB call is injected via `options.sql` (a `vi.fn()` standing in for
 * the tagged-template `sql` function) — no `@/lib/db` mock, no live
 * database, per the Hard Rule: mock at the boundary. Every network call
 * (CookViewer parcel lookup, live zoning-district lookup) is injected via
 * `options.fetchImpl`. `resolveZonesAtPoint` (TIF/overlay resolution) is
 * exercised for REAL against this repo's own committed static zone
 * GeoJSON files (DATABASE_URL is unset in the test process, verified
 * directly — see below — so it always takes the static-file fallback path,
 * never a live DB or network call); its output is asserted only at the
 * shape level, never for specific matched zones, since which real zones
 * cover an arbitrary test coordinate is not this suite's concern.
 */
import { describe, expect, it, vi } from "vitest";
import {
  PERMIT_EXHIBIT_ALLOWED_RADIUS_FT,
  PERMIT_EXHIBIT_COST_LABEL,
  PERMIT_EXHIBIT_COVERAGE_NOTE,
  PERMIT_EXHIBIT_LIMITS,
  PERMIT_EXHIBIT_MATCH_CONFIDENCE,
  PERMIT_EXHIBIT_PROXIMITY_SUBSECTION_TITLE,
  PermitExhibitBuildError,
  buildPermitExhibit,
  buildPermitSourceRecordUrl,
  classifyPermitExhibitMatch,
  computePermitExhibitId,
  formatBoundaryContextLimitNote,
  formatExhibitIdFooter,
  polygonCentroid,
  radiusCirclePolygon,
  radiusFeetToMeters,
  subjectCandidateRadiusMeters,
  type ExhibitParcel,
  type PermitExhibitFilters,
  type PermitExhibitResult,
} from "../permit-exhibit";
import type { Ring } from "../shortlist-parcel-identity-resolver";

// ────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ────────────────────────────────────────────────────────────────────────

/** A realistic 25ft x 125ft Chicago lot (~7.6m x 38.1m), small enough that
 *  a point 15-20m from its centroid is guaranteed to fall OUTSIDE it while
 *  staying inside the 25m proximity radius — see the file-level comment on
 *  why this matters for exercising the proximity tier honestly. */
const LOT_WEST = -87.63;
const LOT_EAST = -87.6299081; // +0.0000919° ≈ 7.62 m at this latitude
const LOT_SOUTH = 41.73;
const LOT_NORTH = 41.7303423; // +0.0003423° ≈ 38.1 m

const PARCEL_RINGS: Ring[] = [
  [
    [LOT_WEST, LOT_SOUTH],
    [LOT_EAST, LOT_SOUTH],
    [LOT_EAST, LOT_NORTH],
    [LOT_WEST, LOT_NORTH],
    [LOT_WEST, LOT_SOUTH],
  ],
];
const PARCEL_BBOX: [number, number, number, number] = [LOT_WEST, LOT_SOUTH, LOT_EAST, LOT_NORTH];
const PARCEL_CENTROID = polygonCentroid(PARCEL_RINGS, PARCEL_BBOX);

const TEST_PARCEL: ExhibitParcel = {
  pin: "20363230080000",
  situsAddress: "8525 S EUCLID AVE, CHICAGO, IL 60617",
  rings: PARCEL_RINGS,
  bbox: PARCEL_BBOX,
  centroid: PARCEL_CENTROID,
};
const NORMALIZED_SITUS_ADDRESS = "8525seuclidavechicagoil60617";

function metersEastOf(lon: number, lat: number, meters: number): { lat: number; lon: number } {
  const metersPerDegreeLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  return { lat, lon: lon + meters / metersPerDegreeLon };
}

const INSIDE_POINT = { lat: PARCEL_CENTROID.lat, lon: PARCEL_CENTROID.lon }; // pin_parcel
const PROXIMITY_POINT = metersEastOf(PARCEL_CENTROID.lon, PARCEL_CENTROID.lat, 15); // outside lot, within 25 m
const FAR_POINT = metersEastOf(PARCEL_CENTROID.lon, PARCEL_CENTROID.lat, 200); // outside lot AND outside 25 m

function cookViewerParcelResponse(feature: {
  street_address: string;
  city_state_zip: string;
  rings: Ring[];
} | null) {
  return {
    ok: true,
    json: async () => ({
      features: feature
        ? [
            {
              attributes: {
                street_address: feature.street_address,
                city_state_zip: feature.city_state_zip,
              },
              geometry: { rings: feature.rings },
            },
          ]
        : [],
    }),
  };
}

function zoningArcgisResponse(zoneClass: string | null) {
  return {
    ok: true,
    json: async () => ({
      features: zoneClass
        ? [{ attributes: { ZONE_CLASS: zoneClass, UPDATE_TIMESTAMP: 1_700_000_000_000 } }]
        : [],
    }),
  };
}

/** Standard fetchImpl: routes CookViewer parcel lookups to the fixed test
 *  parcel and zoning lookups to a fixed zone class, by URL host. */
function standardFetchImpl(): typeof fetch {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("cookcountyil.gov")) {
      return cookViewerParcelResponse({
        street_address: "8525 S EUCLID AVE",
        city_state_zip: "CHICAGO, IL 60617",
        rings: PARCEL_RINGS,
      }) as unknown as Response;
    }
    if (url.includes("gisapps.chicago.gov")) {
      return zoningArcgisResponse("RS-3") as unknown as Response;
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as unknown as typeof fetch;
}

interface PermitFixture {
  permit_id: string;
  permit_type?: string;
  address?: string;
  issue_date?: string | null;
  permit_status?: string | null;
  permit_milestone?: string | null;
  work_type?: string | null;
  work_description?: string | null;
  reported_cost?: number | string | null;
  lat?: number | null;
  lon?: number | null;
  fetched_at?: string | null;
}

function normalizeAddr(address: string | undefined): string {
  return (address ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rawRow(fixture: PermitFixture) {
  return {
    permit_id: fixture.permit_id,
    permit_type: fixture.permit_type ?? "PERMIT - RENOVATION/ALTERATION",
    address: fixture.address ?? null,
    issue_date: fixture.issue_date ?? "2020-01-01",
    permit_status: fixture.permit_status ?? "COMPLETE",
    permit_milestone: fixture.permit_milestone ?? null,
    work_type: fixture.work_type ?? null,
    work_description: fixture.work_description ?? null,
    reported_cost: fixture.reported_cost ?? null,
    lat: fixture.lat ?? null,
    lon: fixture.lon ?? null,
    fetched_at: fixture.fetched_at ?? "2026-08-20T00:00:00.000Z",
    normalized_address: normalizeAddr(fixture.address),
  };
}

/** Builds an injectable `sql` mock that returns `subjectRows` for the S1
 *  (candidates) query and `areaRows` (each carrying `located_via`) for the
 *  S2 (point_matches/address_only) query — routed by whether the query
 *  text contains "located_via", never by call order. */
function sqlMockFor(subjectRows: PermitFixture[], areaRows: (PermitFixture & { locatedVia: "point" | "address_only" })[]) {
  return vi.fn(async (strings: TemplateStringsArray) => {
    const text = strings.join("");
    if (text.includes("located_via")) {
      return areaRows.map((row) => ({ ...rawRow(row), located_via: row.locatedVia }));
    }
    return subjectRows.map((row) => rawRow(row));
  });
}

function baseOptions(overrides: {
  subjectRows?: PermitFixture[];
  areaRows?: (PermitFixture & { locatedVia: "point" | "address_only" })[];
  fetchImpl?: typeof fetch;
  filters?: PermitExhibitFilters;
  now?: () => Date;
} = {}) {
  return {
    pin: TEST_PARCEL.pin,
    radiusFt: 500 as const,
    filters: overrides.filters,
    sql: sqlMockFor(overrides.subjectRows ?? [], overrides.areaRows ?? []) as unknown as ReturnType<
      typeof import("../db").getSQL
    >,
    fetchImpl: overrides.fetchImpl ?? standardFetchImpl(),
    now: overrides.now ?? (() => new Date("2026-08-25T12:00:00.000Z")),
    readZoningArchiveVintageRange: async () => ({ earliest: null, latest: null, snapshotCount: 0 }),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Pure functions
// ────────────────────────────────────────────────────────────────────────

describe("classifyPermitExhibitMatch — precedence & exclusivity (pin_parcel ⊃ address_exact ⊃ proximity)", () => {
  const parcel = { rings: PARCEL_RINGS, bbox: PARCEL_BBOX, centroid: PARCEL_CENTROID };

  it("a geocoded point INSIDE the polygon is pin_parcel, even when its address also matches", () => {
    const method = classifyPermitExhibitMatch(
      { lat: INSIDE_POINT.lat, lon: INSIDE_POINT.lon, normalizedAddress: NORMALIZED_SITUS_ADDRESS },
      parcel,
      NORMALIZED_SITUS_ADDRESS,
    );
    expect(method).toBe("pin_parcel");
  });

  it("an address match OUTSIDE the polygon is address_exact, never proximity or pin_parcel", () => {
    const method = classifyPermitExhibitMatch(
      { lat: FAR_POINT.lat, lon: FAR_POINT.lon, normalizedAddress: NORMALIZED_SITUS_ADDRESS },
      parcel,
      NORMALIZED_SITUS_ADDRESS,
    );
    expect(method).toBe("address_exact");
  });

  it("a nearby (within 25 m) point that is OUTSIDE the polygon and has a different address is proximity", () => {
    const method = classifyPermitExhibitMatch(
      { lat: PROXIMITY_POINT.lat, lon: PROXIMITY_POINT.lon, normalizedAddress: "999wunrelatedst" },
      parcel,
      NORMALIZED_SITUS_ADDRESS,
    );
    expect(method).toBe("proximity");
  });

  it("proximity NEVER wins over address_exact — a nearby point that ALSO matches the address is address_exact", () => {
    const method = classifyPermitExhibitMatch(
      { lat: PROXIMITY_POINT.lat, lon: PROXIMITY_POINT.lon, normalizedAddress: NORMALIZED_SITUS_ADDRESS },
      parcel,
      NORMALIZED_SITUS_ADDRESS,
    );
    expect(method).toBe("address_exact");
  });

  it("a point beyond 25 m with a non-matching address is excluded (null) — never forced into a bucket", () => {
    const method = classifyPermitExhibitMatch(
      { lat: FAR_POINT.lat, lon: FAR_POINT.lon, normalizedAddress: "999wunrelatedst" },
      parcel,
      NORMALIZED_SITUS_ADDRESS,
    );
    expect(method).toBeNull();
  });

  it("a row with no geocode and a non-matching address is excluded (null)", () => {
    const method = classifyPermitExhibitMatch(
      { lat: null, lon: null, normalizedAddress: "999wunrelatedst" },
      parcel,
      NORMALIZED_SITUS_ADDRESS,
    );
    expect(method).toBeNull();
  });

  it("a short/garbage normalized situs address never produces an address_exact match", () => {
    const method = classifyPermitExhibitMatch(
      { lat: null, lon: null, normalizedAddress: "unk" },
      parcel,
      "unk",
    );
    expect(method).toBeNull();
  });

  it("the literal placeholder 'unknown' situs address never matches, even against an identical row address", () => {
    const method = classifyPermitExhibitMatch(
      { lat: null, lon: null, normalizedAddress: "unknown" },
      parcel,
      "unknown",
    );
    expect(method).toBeNull();
  });
});

describe("computePermitExhibitId — deterministic both directions", () => {
  const base = { pin: "20363230080000", radiusFt: 500, filters: {}, snapshotVintage: "2026-08-20T00:00:00.000Z" };

  it("identical inputs (including vintage) always produce the same id", () => {
    expect(computePermitExhibitId(base)).toBe(computePermitExhibitId({ ...base }));
  });

  it("a different PIN changes the id", () => {
    expect(computePermitExhibitId({ ...base, pin: "20363230090000" })).not.toBe(computePermitExhibitId(base));
  });

  it("a different radius changes the id", () => {
    expect(computePermitExhibitId({ ...base, radiusFt: 1000 })).not.toBe(computePermitExhibitId(base));
  });

  it("different filters change the id", () => {
    expect(
      computePermitExhibitId({ ...base, filters: { permitTypeKeys: ["new_construction"] } }),
    ).not.toBe(computePermitExhibitId(base));
  });

  it("filter KEY ORDER does not change the id (canonicalized before hashing)", () => {
    const a = computePermitExhibitId({
      ...base,
      filters: { permitTypeKeys: ["new_construction", "signs"] },
    });
    const b = computePermitExhibitId({
      ...base,
      filters: { permitTypeKeys: ["signs", "new_construction"] },
    });
    expect(a).toBe(b);
  });

  it("a DIFFERENT snapshot vintage alone changes the id — a data refresh must mint a new exhibit id", () => {
    expect(computePermitExhibitId({ ...base, snapshotVintage: "2026-09-01T00:00:00.000Z" })).not.toBe(
      computePermitExhibitId(base),
    );
  });

  it("a null vintage is distinct from any real vintage string", () => {
    expect(computePermitExhibitId({ ...base, snapshotVintage: null })).not.toBe(computePermitExhibitId(base));
  });
});

describe("polygonCentroid", () => {
  it("returns the true centroid of a simple rectangle", () => {
    const rings: Ring[] = [
      [
        [0, 0],
        [10, 0],
        [10, 4],
        [0, 4],
        [0, 0],
      ],
    ];
    const bbox: [number, number, number, number] = [0, 0, 10, 4];
    const centroid = polygonCentroid(rings, bbox);
    expect(centroid.lon).toBeCloseTo(5, 6);
    expect(centroid.lat).toBeCloseTo(2, 6);
  });

  it("falls back to the bbox center for a degenerate (too-short) ring", () => {
    const rings: Ring[] = [[[1, 1], [2, 2]]];
    const bbox: [number, number, number, number] = [0, 0, 4, 4];
    expect(polygonCentroid(rings, bbox)).toEqual({ lat: 2, lon: 2 });
  });
});

describe("radiusFeetToMeters", () => {
  it("converts feet to meters correctly", () => {
    expect(radiusFeetToMeters(500)).toBeCloseTo(152.4, 1);
    expect(radiusFeetToMeters(1000)).toBeCloseTo(304.8, 1);
  });
});

describe("subjectCandidateRadiusMeters", () => {
  it("is floored at 150 m for a small parcel", () => {
    expect(subjectCandidateRadiusMeters(PARCEL_BBOX)).toBe(150);
  });

  it("grows with the parcel's own bbox diagonal for a large parcel", () => {
    const bigBbox: [number, number, number, number] = [-87.65, 41.87, -87.6, 41.9]; // several km across
    expect(subjectCandidateRadiusMeters(bigBbox)).toBeGreaterThan(150);
  });

  it("is capped at 2000 m for an absurdly large bbox", () => {
    const hugeBbox: [number, number, number, number] = [-88, 41, -87, 42];
    expect(subjectCandidateRadiusMeters(hugeBbox)).toBe(2000);
  });
});

describe("radiusCirclePolygon", () => {
  it("returns a closed GeoJSON Polygon with the expected ring shape", () => {
    const polygon = radiusCirclePolygon(41.73, -87.63, 150);
    expect(polygon.type).toBe("Polygon");
    const ring = polygon.coordinates[0];
    expect(ring.length).toBeGreaterThan(32); // 64 steps + closing point
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
  });
});

describe("buildPermitSourceRecordUrl", () => {
  it("builds the verified Socrata SoQL explore/query deep link keyed on permit_", () => {
    const url = buildPermitSourceRecordUrl("101046020");
    expect(url).toContain(
      "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu/explore/query/",
    );
    expect(url).toContain("/page/filter");
    const decoded = decodeURIComponent(url.split("/query/")[1].split("/page/filter")[0]);
    expect(decoded).toContain('WHERE `permit_` = "101046020"');
  });

  it("escapes an embedded double-quote in the permit number rather than breaking the SoQL string", () => {
    const url = buildPermitSourceRecordUrl('abc"123');
    const decoded = decodeURIComponent(url.split("/query/")[1].split("/page/filter")[0]);
    expect(decoded).toContain('WHERE `permit_` = "abc\\"123"');
  });
});

describe("verbatim copy — pinned character-for-character", () => {
  it("PERMIT_EXHIBIT_COST_LABEL is exactly the spec's required string", () => {
    expect(PERMIT_EXHIBIT_COST_LABEL).toBe("Estimated cost (self-reported to City)");
  });

  it("PERMIT_EXHIBIT_PROXIMITY_SUBSECTION_TITLE is exactly the spec's required heading", () => {
    expect(PERMIT_EXHIBIT_PROXIMITY_SUBSECTION_TITLE).toBe("Nearby, not matched to this parcel");
  });

  it("PERMIT_EXHIBIT_LIMITS has exactly the three spec sentences, verbatim", () => {
    expect(PERMIT_EXHIBIT_LIMITS).toHaveLength(3);
    expect(PERMIT_EXHIBIT_LIMITS[0]).toBe(
      "A permit shows work was authorized. It does not show that a use occurred or continued. Business licenses, certificates of occupancy, utility records, photographs, and sworn affidavits are the usual companion evidence.",
    );
    expect(PERMIT_EXHIBIT_LIMITS[1]).toBe(
      "The absence of a permit is not evidence of absence: the City's electronic permit record thins sharply before the mid-2000s, and unpermitted work occurs.",
    );
    expect(PERMIT_EXHIBIT_LIMITS[2]).toBe(
      "This exhibit is a derivative of the public record, not the record itself. Verify every row against the City's own dataset at the linked source.",
    );
  });

  it("formatBoundaryContextLimitNote interpolates the date into the exact S3 sentence", () => {
    expect(formatBoundaryContextLimitNote("2026-08-25")).toBe(
      "Boundary context is as of 2026-08-25. District boundaries in effect at each permit's issue date are not yet reconstructable from this tool; verify era-specific zoning with the City's ordinance record.",
    );
  });

  it("formatExhibitIdFooter interpolates the id into the exact S4 footer sentence", () => {
    expect(formatExhibitIdFooter("abc123")).toBe(
      "Exhibit abc123. Regenerating after a data refresh may include newer permits; the snapshot date above identifies this exhibit's data vintage.",
    );
  });

  it("PERMIT_EXHIBIT_COVERAGE_NOTE mentions both the full-history scope and the address-only inference (not summarized elsewhere without this context)", () => {
    expect(PERMIT_EXHIBIT_COVERAGE_NOTE).toContain("full ingested history");
    expect(PERMIT_EXHIBIT_COVERAGE_NOTE).toContain("address-only");
  });

  it("PERMIT_EXHIBIT_ALLOWED_RADIUS_FT is exactly the spec's fixed set", () => {
    expect(PERMIT_EXHIBIT_ALLOWED_RADIUS_FT).toEqual([250, 500, 1000]);
  });

  it("match-method confidence grading is fixed per method", () => {
    expect(PERMIT_EXHIBIT_MATCH_CONFIDENCE).toEqual({
      pin_parcel: "high",
      address_exact: "medium",
      proximity: "low",
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// buildPermitExhibit — validation
// ────────────────────────────────────────────────────────────────────────

describe("buildPermitExhibit — PIN and radius validation (junk → typed error)", () => {
  it("rejects a non-14-digit PIN with a typed invalid_pin error", async () => {
    await expect(buildPermitExhibit({ ...baseOptions(), pin: "not-a-pin" })).rejects.toMatchObject({
      code: "invalid_pin",
    });
  });

  it("rejects an empty PIN", async () => {
    await expect(buildPermitExhibit({ ...baseOptions(), pin: "" })).rejects.toMatchObject({
      code: "invalid_pin",
    });
  });

  it("accepts a dashed PIN, normalizing it", async () => {
    const result = await buildPermitExhibit({ ...baseOptions(), pin: "20-36-323-008-0000" });
    expect(result.meta.subjectParcel.pin).toBe("20363230080000");
  });

  it("rejects a radius outside the fixed allowed set with a typed invalid_radius error", async () => {
    // @ts-expect-error deliberately passing an out-of-union value to prove runtime validation, not just types
    await expect(buildPermitExhibit({ ...baseOptions(), radiusFt: 999 })).rejects.toMatchObject({
      code: "invalid_radius",
    });
  });

  it("thrown errors are instances of PermitExhibitBuildError", async () => {
    await expect(buildPermitExhibit({ ...baseOptions(), pin: "junk" })).rejects.toBeInstanceOf(
      PermitExhibitBuildError,
    );
  });
});

describe("buildPermitExhibit — parcel resolution failures", () => {
  it("throws parcel_not_found when CookViewer returns zero features for a well-formed PIN", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("cookcountyil.gov")) return cookViewerParcelResponse(null) as unknown as Response;
      return zoningArcgisResponse(null) as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(buildPermitExhibit({ ...baseOptions({ fetchImpl }) })).rejects.toMatchObject({
      code: "parcel_not_found",
    });
  });

  it("throws parcel_source_unavailable when the CookViewer call itself fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(buildPermitExhibit({ ...baseOptions({ fetchImpl }) })).rejects.toMatchObject({
      code: "parcel_source_unavailable",
    });
  });

  it("throws database_unavailable when no sql client is configured", async () => {
    const options = baseOptions();
    await expect(
      buildPermitExhibit({ ...options, sql: null as unknown as typeof options.sql }),
    ).rejects.toMatchObject({ code: "database_unavailable" });
  });
});

// ────────────────────────────────────────────────────────────────────────
// buildPermitExhibit — the happy path, and every pinned invariant
// ────────────────────────────────────────────────────────────────────────

describe("buildPermitExhibit — S1 subject rows: exclusivity, chronological order, real-world classification", () => {
  it("classifies a mixed candidate set with exactly one method per row, in chronological (oldest-first) order", async () => {
    const result = await buildPermitExhibit(
      baseOptions({
        subjectRows: [
          {
            permit_id: "P-PIN",
            address: "8525 S EUCLID AVE",
            lat: INSIDE_POINT.lat,
            lon: INSIDE_POINT.lon,
            issue_date: "2022-06-01",
          },
          {
            permit_id: "P-ADDR",
            address: "8525 S EUCLID AVE",
            lat: FAR_POINT.lat,
            lon: FAR_POINT.lon,
            issue_date: "2018-03-15",
          },
          {
            permit_id: "P-PROX",
            address: "999 W UNRELATED ST",
            lat: PROXIMITY_POINT.lat,
            lon: PROXIMITY_POINT.lon,
            issue_date: "2020-01-01",
          },
          {
            permit_id: "P-EXCLUDED",
            address: "999 W UNRELATED ST",
            lat: FAR_POINT.lat,
            lon: FAR_POINT.lon,
            issue_date: "2021-01-01",
          },
        ],
      }),
    );

    // The excluded candidate (neither on the parcel, nor address-matched,
    // nor within 25 m) must never appear in subject[].
    expect(result.subject.map((row) => row.permitNumber)).toEqual(["P-ADDR", "P-PROX", "P-PIN"]);

    const byId = new Map(result.subject.map((row) => [row.permitNumber, row]));
    expect(byId.get("P-PIN")?.matchMethod).toBe("pin_parcel");
    expect(byId.get("P-ADDR")?.matchMethod).toBe("address_exact");
    expect(byId.get("P-PROX")?.matchMethod).toBe("proximity");

    // Chronological, oldest first.
    expect(result.subject.map((row) => row.issueDate)).toEqual(["2018-03-15", "2020-01-01", "2022-06-01"]);
  });

  it("a pin_parcel row is never ALSO counted as address_exact or proximity in the match-method breakdown", async () => {
    const result = await buildPermitExhibit(
      baseOptions({
        subjectRows: [
          {
            permit_id: "P-BOTH",
            address: "8525 S EUCLID AVE", // matches situs address too
            lat: INSIDE_POINT.lat,
            lon: INSIDE_POINT.lon,
          },
        ],
      }),
    );
    expect(result.subject).toHaveLength(1);
    expect(result.subject[0].matchMethod).toBe("pin_parcel");
    expect(result.coverage.matchMethodBreakdown).toEqual({ pinParcel: 1, addressExact: 0, proximity: 0 });
  });

  it("renders the proximity subsection heading only via the exported constant, never inline text elsewhere in the row", async () => {
    const result = await buildPermitExhibit(
      baseOptions({
        subjectRows: [
          {
            permit_id: "P-PROX",
            address: "999 W UNRELATED ST",
            lat: PROXIMITY_POINT.lat,
            lon: PROXIMITY_POINT.lon,
          },
        ],
      }),
    );
    expect(result.subject[0].matchMethod).toBe("proximity");
    expect(result.subject[0].matchConfidence).toBe("low");
  });
});

describe("buildPermitExhibit — S2 area rows: point vs address-only, byYear/byType aggregation", () => {
  it("tags point-in-radius and address-only rows distinctly via locatedVia", async () => {
    const result = await buildPermitExhibit(
      baseOptions({
        areaRows: [
          { permit_id: "A-POINT", address: "100 W MAIN ST", issue_date: "2021-05-01", locatedVia: "point" },
          { permit_id: "A-ADDRONLY", address: "100 W MAIN ST", issue_date: "2019-02-01", locatedVia: "address_only" },
        ],
      }),
    );
    const byId = new Map(result.area.rows.map((row) => [row.permitNumber, row]));
    expect(byId.get("A-POINT")?.locatedVia).toBe("point");
    expect(byId.get("A-ADDRONLY")?.locatedVia).toBe("address_only");
    expect(result.coverage.area).toEqual({ geolocatedCount: 1, unlocatedCount: 1, totalCount: 2 });
  });

  it("aggregates byYear and byType as COUNTS ONLY — no cost field appears in either aggregate", async () => {
    const result = await buildPermitExhibit(
      baseOptions({
        areaRows: [
          {
            permit_id: "A1",
            issue_date: "2020-01-01",
            permit_type: "PERMIT - NEW CONSTRUCTION",
            reported_cost: 500_000,
            locatedVia: "point",
          },
          {
            permit_id: "A2",
            issue_date: "2020-06-01",
            permit_type: "PERMIT - NEW CONSTRUCTION",
            reported_cost: 250_000,
            locatedVia: "point",
          },
          {
            permit_id: "A3",
            issue_date: "2021-01-01",
            permit_type: "PERMIT - SIGNS",
            reported_cost: 1_000,
            locatedVia: "point",
          },
        ],
      }),
    );
    expect(result.area.byYear).toEqual([
      { year: 2021, count: 1 },
      { year: 2020, count: 2 },
    ]);
    const newConstruction = result.area.byType.find((t) => t.key === "new_construction");
    expect(newConstruction?.count).toBe(2);
    for (const entry of [...result.area.byYear, ...result.area.byType]) {
      expect(Object.keys(entry)).not.toContain("cost");
      expect(Object.keys(entry).some((key) => /cost/i.test(key))).toBe(false);
    }
  });
});

describe("buildPermitExhibit — permitTypeKeys filter restricts rows AND aggregates consistently", () => {
  it("excludes non-matching types from subject, area rows, and area aggregates alike", async () => {
    const result = await buildPermitExhibit(
      baseOptions({
        subjectRows: [
          { permit_id: "S-NC", permit_type: "PERMIT - NEW CONSTRUCTION", address: "8525 S EUCLID AVE", lat: INSIDE_POINT.lat, lon: INSIDE_POINT.lon },
          { permit_id: "S-SIGN", permit_type: "PERMIT - SIGNS", address: "8525 S EUCLID AVE", lat: INSIDE_POINT.lat, lon: INSIDE_POINT.lon },
        ],
        areaRows: [
          { permit_id: "A-NC", permit_type: "PERMIT - NEW CONSTRUCTION", locatedVia: "point" },
          { permit_id: "A-SIGN", permit_type: "PERMIT - SIGNS", locatedVia: "point" },
        ],
        filters: { permitTypeKeys: ["new_construction"] },
      }),
    );
    expect(result.subject.map((r) => r.permitNumber)).toEqual(["S-NC"]);
    expect(result.area.rows.map((r) => r.permitNumber)).toEqual(["A-NC"]);
    expect(result.area.byType.every((t) => t.key === "new_construction")).toBe(true);
    expect(result.meta.queryParams.filters).toEqual({ permitTypeKeys: ["new_construction"] });
  });
});

describe("buildPermitExhibit — reported_cost: enters the SELECT, is labeled, and is NEVER aggregated", () => {
  it("the subject-candidate and area SQL text both explicitly select reported_cost (mirrors, does not touch, the analysis route's exclusion)", async () => {
    const sqlMock = sqlMockFor(
      [{ permit_id: "P1", address: "8525 S EUCLID AVE", lat: INSIDE_POINT.lat, lon: INSIDE_POINT.lon }],
      [{ permit_id: "A1", locatedVia: "point" }],
    );
    await buildPermitExhibit({ ...baseOptions(), sql: sqlMock as unknown as ReturnType<typeof import("../db").getSQL> });

    expect(sqlMock).toHaveBeenCalledTimes(2);
    for (const call of sqlMock.mock.calls) {
      const text = (call[0] as TemplateStringsArray).join("");
      expect(text).toContain("reported_cost");
      // A parallel, permit-area-style pin: this route's own query text must
      // never itself compute a sum/average of cost.
      expect(text.toLowerCase()).not.toMatch(/sum\s*\(\s*reported_cost/);
      expect(text.toLowerCase()).not.toMatch(/avg\s*\(\s*reported_cost/);
    }
  });

  it("estimatedCostSelfReported carries the raw applicant estimate on the row, unlabeled numerically (the label lives in meta.costLabel)", async () => {
    const result = await buildPermitExhibit(
      baseOptions({
        subjectRows: [
          {
            permit_id: "P1",
            address: "8525 S EUCLID AVE",
            lat: INSIDE_POINT.lat,
            lon: INSIDE_POINT.lon,
            reported_cost: 742_500,
          },
        ],
      }),
    );
    expect(result.subject[0].estimatedCostSelfReported).toBe(742_500);
    expect(result.meta.costLabel).toBe(PERMIT_EXHIBIT_COST_LABEL);
  });

  it("NO cost aggregate exists anywhere in the built exhibit object — walked recursively", async () => {
    const result = await buildPermitExhibit(
      baseOptions({
        subjectRows: [
          { permit_id: "P1", address: "8525 S EUCLID AVE", lat: INSIDE_POINT.lat, lon: INSIDE_POINT.lon, reported_cost: 100_000 },
          { permit_id: "P2", address: "8525 S EUCLID AVE", lat: FAR_POINT.lat, lon: FAR_POINT.lon, reported_cost: 250_000 },
        ],
        areaRows: [
          { permit_id: "A1", reported_cost: 50_000, locatedVia: "point" },
          { permit_id: "A2", reported_cost: 1_000_000, locatedVia: "address_only" },
        ],
      }),
    );

    const trueSum = 100_000 + 250_000 + 50_000 + 1_000_000;

    const suspiciousKeyPattern = /(total|sum|aggregate).*cost|cost.*(total|sum|aggregate)/i;
    const seenNumbers = new Set<number>();
    const badKeys: string[] = [];

    function walk(value: unknown, keyPath: string): void {
      if (Array.isArray(value)) {
        value.forEach((item, i) => walk(item, `${keyPath}[${i}]`));
        return;
      }
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          if (suspiciousKeyPattern.test(key)) badKeys.push(`${keyPath}.${key}`);
          walk(child, `${keyPath}.${key}`);
        }
        return;
      }
      if (typeof value === "number") seenNumbers.add(value);
    }
    walk(result as unknown, "$");

    expect(badKeys).toEqual([]);
    expect(seenNumbers.has(trueSum)).toBe(false);
  });
});

describe("buildPermitExhibit — coverage arithmetic", () => {
  it("geolocatedCount + unlocatedCount === totalCount, and matchMethodBreakdown matches actual subject counts", async () => {
    const result = await buildPermitExhibit(
      baseOptions({
        subjectRows: [
          { permit_id: "S1", address: "8525 S EUCLID AVE", lat: INSIDE_POINT.lat, lon: INSIDE_POINT.lon },
          { permit_id: "S2", address: "8525 S EUCLID AVE", lat: FAR_POINT.lat, lon: FAR_POINT.lon },
          { permit_id: "S3", address: "999 W UNRELATED ST", lat: PROXIMITY_POINT.lat, lon: PROXIMITY_POINT.lon },
        ],
        areaRows: [
          { permit_id: "A1", locatedVia: "point" },
          { permit_id: "A2", locatedVia: "point" },
          { permit_id: "A3", locatedVia: "address_only" },
        ],
      }),
    );
    expect(result.coverage.matchMethodBreakdown).toEqual({ pinParcel: 1, addressExact: 1, proximity: 1 });
    const { geolocatedCount, unlocatedCount, totalCount } = result.coverage.area;
    expect(geolocatedCount + unlocatedCount).toBe(totalCount);
    expect(geolocatedCount).toBe(2);
    expect(unlocatedCount).toBe(1);
  });
});

describe("buildPermitExhibit — exhibit id determinism, end to end", () => {
  it("the same query against the same dataset vintage produces the same exhibitId", async () => {
    const fixture = () =>
      baseOptions({
        subjectRows: [{ permit_id: "P1", address: "8525 S EUCLID AVE", lat: INSIDE_POINT.lat, lon: INSIDE_POINT.lon, fetched_at: "2026-08-20T00:00:00.000Z" }],
      });
    const a = await buildPermitExhibit(fixture());
    const b = await buildPermitExhibit(fixture());
    expect(a.meta.exhibitId).toBe(b.meta.exhibitId);
    expect(a.meta.datasetLastUpdate).toBe("2026-08-20T00:00:00.000Z");
  });

  it("a different dataset vintage (fetched_at) produces a different exhibitId", async () => {
    const optionsA = baseOptions({
      subjectRows: [{ permit_id: "P1", address: "8525 S EUCLID AVE", lat: INSIDE_POINT.lat, lon: INSIDE_POINT.lon, fetched_at: "2026-08-20T00:00:00.000Z" }],
    });
    const optionsB = baseOptions({
      subjectRows: [{ permit_id: "P1", address: "8525 S EUCLID AVE", lat: INSIDE_POINT.lat, lon: INSIDE_POINT.lon, fetched_at: "2026-09-01T00:00:00.000Z" }],
    });
    const a = await buildPermitExhibit(optionsA);
    const b = await buildPermitExhibit(optionsB);
    expect(a.meta.exhibitId).not.toBe(b.meta.exhibitId);
  });

  it("exhibitId is embedded verbatim in the S4 footer sentence", async () => {
    const result = await buildPermitExhibit(baseOptions());
    expect(result.meta.exhibitIdFooter).toBe(formatExhibitIdFooter(result.meta.exhibitId));
  });
});

describe("buildPermitExhibit — meta, history window, and boundary context shape", () => {
  it("states full_ingested_history explicitly and carries the ingest floor date for context", async () => {
    const result = await buildPermitExhibit(baseOptions());
    expect(result.meta.historyWindow).toBe("full_ingested_history");
    expect(result.meta.ingestFloorDate).toBe("2015-01-01");
  });

  it("echoes queryParams verbatim, including the formatted PIN", async () => {
    const result = await buildPermitExhibit(baseOptions());
    expect(result.meta.queryParams).toEqual({
      pin: "20363230080000",
      pinFormatted: "20-36-323-008-0000",
      radiusFt: 500,
      filters: {},
    });
  });

  it("carries the subject parcel's PIN and situs address in meta, mirrored in boundaryContext.parcelAddress", async () => {
    const result = await buildPermitExhibit(baseOptions());
    expect(result.meta.subjectParcel.situsAddress).toBe(TEST_PARCEL.situsAddress);
    expect(result.boundaryContext.parcelAddress).toBe(result.meta.subjectParcel.situsAddress);
  });

  it("boundaryContext resolves a zoning district live via the injected fetchImpl and states the S3 limit for today's date", async () => {
    const now = () => new Date("2026-08-25T12:00:00.000Z");
    const result: PermitExhibitResult = await buildPermitExhibit(baseOptions({ now }));
    expect(result.boundaryContext.asOfDate).toBe("2026-08-25");
    expect(result.boundaryContext.zoningDistrict.status).toBe("resolved");
    expect(result.boundaryContext.zoningDistrict.zoneClass).toBe("RS-3");
    expect(result.boundaryContext.limitNote).toBe(formatBoundaryContextLimitNote("2026-08-25"));
    expect(Array.isArray(result.boundaryContext.tifDistricts)).toBe(true);
    expect(Array.isArray(result.boundaryContext.overlays)).toBe(true);
  });

  it("zoning district resolves to 'not_found' (not 'unavailable') when the City publishes nothing at the point", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("cookcountyil.gov")) {
        return cookViewerParcelResponse({
          street_address: "8525 S EUCLID AVE",
          city_state_zip: "CHICAGO, IL 60617",
          rings: PARCEL_RINGS,
        }) as unknown as Response;
      }
      return zoningArcgisResponse(null) as unknown as Response;
    }) as unknown as typeof fetch;
    const result = await buildPermitExhibit(baseOptions({ fetchImpl }));
    expect(result.boundaryContext.zoningDistrict.status).toBe("not_found");
  });

  it("zoning district resolves to 'unavailable' (never a crash) when the live ArcGIS call itself fails", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("cookcountyil.gov")) {
        return cookViewerParcelResponse({
          street_address: "8525 S EUCLID AVE",
          city_state_zip: "CHICAGO, IL 60617",
          rings: PARCEL_RINGS,
        }) as unknown as Response;
      }
      throw new Error("ArcGIS is down");
    }) as unknown as typeof fetch;
    const result = await buildPermitExhibit(baseOptions({ fetchImpl }));
    expect(result.boundaryContext.zoningDistrict.status).toBe("unavailable");
  });

  it("a missing/unreadable archive index degrades to an honest null vintage range, never a failure", async () => {
    const options = baseOptions();
    const result = await buildPermitExhibit({
      ...options,
      readZoningArchiveVintageRange: async () => ({ earliest: null, latest: null, snapshotCount: 0 }),
    });
    expect(result.boundaryContext.archiveVintageRange).toEqual({
      earliest: null,
      latest: null,
      snapshotCount: 0,
    });
  });
});

describe("buildPermitExhibit — this route's own SQL never conflicts with the analysis route's pinned exclusion", () => {
  it("this exhibit's SQL selects reported_cost while the SEPARATE app/api/permit-area/route.ts pinned test (untouched by this PR) continues to assert its own query excludes it", async () => {
    // This test only proves THIS file's half of the mirror. The analysis
    // route's own pinned assertion (`expect(query).not.toContain("reported_cost")`)
    // lives in app/api/permit-area/route.test.ts, is not modified by this
    // PR, and is re-verified by the full suite run this PR requires green.
    const sqlMock = sqlMockFor(
      [{ permit_id: "P1", address: "8525 S EUCLID AVE", lat: INSIDE_POINT.lat, lon: INSIDE_POINT.lon }],
      [],
    );
    await buildPermitExhibit({ ...baseOptions(), sql: sqlMock as unknown as ReturnType<typeof import("../db").getSQL> });
    const subjectQueryText = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join("");
    expect(subjectQueryText).toContain("reported_cost");
  });
});
