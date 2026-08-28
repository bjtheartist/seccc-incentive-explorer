import { describe, expect, it, vi } from "vitest";
import { PILOT_ZIPS } from "../pilot-zips";

// This suite rebuilds case records from the large committed data artifacts
// for every pilot ZIP, with tens of thousands of synchronous assertions.
// Wall time swings 2-3x under vitest worker CPU contention, so a tight
// timeout flakes the heaviest tests in full-suite runs even though every
// assertion passes. Sync tests cannot be interrupted mid-run — the timeout
// only retro-fails completed work — so a generous ceiling weakens nothing.
vi.setConfig({ testTimeout: 60_000 });
import {
  CASE_KEYS,
  CASE_POINT_CAP,
  CASE_TYPES,
  DEFAULT_CASE_KEY,
  caseMatches,
  caseTypeFor,
  deriveAllCases,
  deriveCase,
  deriveCaseUniverse,
  isLandUniverseTruncated,
  parseCaseParam,
  recordSector,
  sampleCasePoints,
  type CasePoint,
  type VacancyCaseRecord,
} from "../vacancy-cases";
import { buildCaseRecords } from "../vacancy-cases-data";
import { deriveLandUniverse, getVacancyIndexEdition } from "../vacancy-index";

// Owner names, taxpayer strings, mailing addresses, and any rank/score field
// must never travel on a case record — the anonymization rail, string-asserted.
const FORBIDDEN_KEYS = [
  "ownerName",
  "owner_name",
  "taxpayer",
  "taxpayerName",
  "mailingAddress",
  "name",
  "priorityScore",
  "priorityTier",
  "portfolio",
  "score",
  "rank",
  "tier",
];

function rec(overrides: Partial<VacancyCaseRecord>): VacancyCaseRecord {
  return {
    id: "r",
    address: "1 FAKE ST",
    pin: null,
    universe: "land",
    ownerType: "local_private",
    ownerStructure: null,
    ownerGeography: null,
    saleYear: null,
    violation: false,
    squareFeet: null,
    lat: null,
    lon: null,
    ...overrides,
  };
}

describe("case metadata + param parsing", () => {
  it("exposes exactly the three case types, in order, each with copy", () => {
    expect(CASE_KEYS).toEqual(["public-land", "title-holder", "property-review"]);
    expect(CASE_TYPES.map((type) => type.name)).toEqual([
      "Find public land",
      "Identify a title holder",
      "Investigate a property",
    ]);
    expect(caseTypeFor("title-holder").definition).toBe(
      "Select a property, then open CookViewer or the Cook County Assessor by PIN.",
    );
    for (const key of CASE_KEYS) {
      const type = caseTypeFor(key);
      expect(type.name.length).toBeGreaterThan(0);
      expect(type.definition.length).toBeGreaterThan(0);
      expect(type.caveat.length).toBeGreaterThan(0);
    }
    expect(CASE_TYPES).toHaveLength(3);
  });

  it("parses current ?case= values and normalizes all three legacy values", () => {
    expect(parseCaseParam("property-review")).toBe("property-review");
    expect(parseCaseParam("private-outreach")).toBe("title-holder");
    expect(parseCaseParam("ownership-check")).toBe("property-review");
    expect(parseCaseParam(["building-review"])).toBe("property-review");
    expect(parseCaseParam("tax-title")).toBe("property-review");
    expect(parseCaseParam("not-a-case")).toBe(DEFAULT_CASE_KEY);
    expect(parseCaseParam(undefined)).toBe(DEFAULT_CASE_KEY);
    expect(DEFAULT_CASE_KEY).toBe("public-land");
  });
});

describe("caseMatches predicates", () => {
  it("public-land = City/public LAND only", () => {
    expect(caseMatches("public-land", rec({ universe: "land", ownerType: "city_public" }))).toBe(true);
    expect(caseMatches("public-land", rec({ universe: "land", ownerType: "local_private" }))).toBe(false);
    // A building is never public-land even if labeled city_public.
    expect(caseMatches("public-land", rec({ universe: "building_report", ownerType: "city_public" }))).toBe(false);
  });

  it("title-holder = LAND with a known non-government owner", () => {
    for (const t of ["local_private", "corporate_llc", "out_of_state"] as const) {
      expect(caseMatches("title-holder", rec({ universe: "land", ownerType: t }))).toBe(true);
    }
    expect(caseMatches("title-holder", rec({ universe: "land", ownerType: "city_public" }))).toBe(false);
    expect(caseMatches("title-holder", rec({ universe: "land", ownerType: "unknown" }))).toBe(false);
  });

  // ── Regression: 311 ownership enrichment (a reported building's legacy
  //    ownerType is "unknown" by construction — the 311 feed carries no
  //    ownership — but the export writes the matched parcel's taxpayer
  //    STRUCTURE onto the record. Reading only the legacy field discarded that
  //    and filed every reported building under "owner not yet identified". ──

  it("title-holder reaches a reported BUILDING whose matched parcel resolved a private taxpayer", () => {
    for (const structure of ["individual", "entity", "trust"] as const) {
      const record = rec({
        universe: "building_report",
        ownerType: "unknown",
        ownerStructure: structure,
        pin: "16143270130000",
      });
      expect(caseMatches("title-holder", record), structure).toBe(true);
      // Every reported-building record also belongs in the property-review
      // union, even when its matched taxpayer resolves to private.
      expect(caseMatches("property-review", record), structure).toBe(true);
    }
  });

  it("title-holder excludes a reported building whose parcel resolved a GOVERNMENT taxpayer", () => {
    const record = rec({
      universe: "building_report",
      ownerType: "unknown",
      ownerStructure: "government",
    });
    expect(caseMatches("title-holder", record)).toBe(false);
    expect(caseMatches("property-review", record)).toBe(true);
    expect(recordSector(record)).toBe("public");
  });

  it("property-review is the union of unresolved ownership, buildings, and distress signals", () => {
    expect(
      caseMatches(
        "property-review",
        rec({ universe: "land", ownerType: "unknown", ownerStructure: "unresolved" }),
      ),
    ).toBe(true);
    expect(
      caseMatches(
        "property-review",
        rec({ universe: "building_report", ownerType: "local_private" }),
      ),
    ).toBe(true);
    expect(caseMatches("property-review", rec({ saleYear: 2015 }))).toBe(true);
    expect(caseMatches("property-review", rec({ violation: true }))).toBe(true);
    expect(
      caseMatches(
        "property-review",
        rec({ ownerType: "local_private", saleYear: null, violation: false }),
      ),
    ).toBe(false);
  });
});

describe("deriveCase counts + preview cap", () => {
  const records: VacancyCaseRecord[] = [
    rec({ id: "a", universe: "land", ownerType: "city_public", lat: 41.7, lon: -87.5 }),
    rec({ id: "b", universe: "land", ownerType: "city_public", lat: null, lon: null }),
    rec({ id: "c", universe: "land", ownerType: "local_private", lat: 41.71, lon: -87.55 }),
    rec({ id: "d", universe: "building_report", ownerType: "unknown", violation: true, lat: 41.72, lon: -87.56 }),
  ];

  it("landCount + buildingCount always equals matches", () => {
    for (const key of CASE_KEYS) {
      const d = deriveCase(key, records);
      expect(d.landCount + d.buildingCount).toBe(d.matches);
    }
  });

  it("public-land counts the two city_public land records, 0 buildings, mapped=1", () => {
    const d = deriveCase("public-land", records);
    expect(d.landCount).toBe(2);
    expect(d.buildingCount).toBe(0);
    expect(d.matches).toBe(2);
    // one of the two carries no coordinate -> only one mapped point
    expect(d.mappedTotal).toBe(1);
    expect(d.points).toHaveLength(1);
  });

  it("caps the preview points at pointCap while keeping the true match count", () => {
    const many: VacancyCaseRecord[] = Array.from({ length: 50 }, (_, i) =>
      rec({ id: `m${i}`, universe: "building_report", lat: 41 + i / 1000, lon: -87 - i / 1000 }),
    );
    const d = deriveCase("property-review", many, 10);
    expect(d.matches).toBe(50);
    expect(d.buildingCount).toBe(50);
    expect(d.mappedTotal).toBe(50);
    expect(d.points).toHaveLength(10); // capped
  });

  it("counts a record with several property-review signals only once", () => {
    const overlapping = rec({
      id: "overlapping-signals",
      universe: "building_report",
      ownerType: "unknown",
      ownerStructure: "unresolved",
      saleYear: 2015,
      violation: true,
      lat: 41.72,
      lon: -87.56,
    });
    const d = deriveCase("property-review", [overlapping]);
    expect(d.matches).toBe(1);
    expect(d.landCount).toBe(0);
    expect(d.buildingCount).toBe(1);
    expect(d.mappedTotal).toBe(1);
    expect(d.points).toHaveLength(1);
  });

  // ── Regression: the preview took the FIRST `cap` mapped points. The record
  //    array is land-then-buildings, so a mixed case over the cap plotted only
  //    land and captioned it "geographic spread". ──

  it("samples the capped preview across the whole mapped set, not the head", () => {
    const mapped: CasePoint[] = Array.from({ length: 1000 }, (_, i) => ({
      lat: 41 + i / 10000,
      lon: -87,
      universe: i < 500 ? ("land" as const) : ("building_report" as const),
    }));
    const sampled = sampleCasePoints(mapped, 10);
    expect(sampled).toHaveLength(10);
    // Both ends of the array are represented — a head slice would be all land.
    expect(sampled[0]).toEqual(mapped[0]);
    expect(sampled[sampled.length - 1]).toEqual(mapped[900]);
    expect(new Set(sampled.map((p) => p.universe))).toEqual(
      new Set(["land", "building_report"]),
    );
    // Strictly increasing source indices — no point is drawn twice.
    const indices = sampled.map((p) => mapped.indexOf(p));
    for (let i = 1; i < indices.length; i += 1) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it("sampleCasePoints is deterministic, and a no-op at or under the cap", () => {
    const mapped: CasePoint[] = Array.from({ length: 25 }, (_, i) => ({
      lat: 41 + i / 1000,
      lon: -87,
      universe: "land" as const,
    }));
    expect(sampleCasePoints(mapped, 25)).toEqual(mapped);
    expect(sampleCasePoints(mapped, 99)).toEqual(mapped);
    expect(sampleCasePoints(mapped, 0)).toEqual([]);
    expect(sampleCasePoints(mapped, 7)).toEqual(sampleCasePoints(mapped, 7));
  });

  it("the capped case preview spans both universes when the mapped set does", () => {
    // 400 land then 400 buildings, cap 10: a head slice would be all land.
    const records: VacancyCaseRecord[] = [
      ...Array.from({ length: 400 }, (_, i) =>
        rec({ id: `l${i}`, universe: "land", ownerType: "unknown", violation: true, lat: 41 + i / 1e4, lon: -87 }),
      ),
      ...Array.from({ length: 400 }, (_, i) =>
        rec({ id: `b${i}`, universe: "building_report", violation: true, lat: 42 + i / 1e4, lon: -87 }),
      ),
    ];
    const d = deriveCase("property-review", records, 10);
    expect(d.mappedTotal).toBe(800);
    expect(new Set(d.points.map((p) => p.universe))).toEqual(
      new Set(["land", "building_report"]),
    );
  });

  it("deriveCaseUniverse reports both totals and flags a short land enumeration", () => {
    const u = deriveCaseUniverse(records, 99);
    expect(u.land).toBe(3);
    expect(u.building).toBe(1);
    expect(u.landTotal).toBe(99);
    expect(isLandUniverseTruncated(u)).toBe(true);
    expect(isLandUniverseTruncated(deriveCaseUniverse(records, 3))).toBe(false);
    // An absent denominator is never treated as a shortfall.
    expect(isLandUniverseTruncated(deriveCaseUniverse(records, null))).toBe(false);
  });

  it("deriveAllCases returns all three in order", () => {
    const all = deriveAllCases(records);
    expect(all.map((c) => c.key)).toEqual([...CASE_KEYS]);
  });
});

describe("buildCaseRecords (real per-ZIP data)", () => {
  for (const entry of PILOT_ZIPS) {
    it(`returns records, areas, and an as-of date for ${entry.zip} (${entry.primaryNeighborhood})`, () => {
      const { records, areas, recordsAsOf } = buildCaseRecords(entry.zip);
      expect(records.length).toBeGreaterThan(0);
      expect(areas.length).toBeGreaterThan(0);
      expect(recordsAsOf.length).toBeGreaterThan(0);
      // universes stay distinct — never a third value
      for (const r of records) {
        expect(r.universe === "land" || r.universe === "building_report").toBe(true);
      }
    });
  }

  it("returns an honest empty result for a non-pilot / unknown ZIP", () => {
    expect(buildCaseRecords("00000")).toEqual({
      records: [],
      areas: [],
      recordsAsOf: "",
      // An unknown ZIP has no denominator to report — landTotal is null, never a
      // fabricated 0 that would read as a real "0-parcel" universe.
      universe: { land: 0, landTotal: null, building: 0 },
    });
  });

  it("keeps the structural case invariants on every pilot ZIP", () => {
    for (const entry of PILOT_ZIPS) {
      const { records } = buildCaseRecords(entry.zip);
      for (const c of deriveAllCases(records)) {
        expect(c.landCount + c.buildingCount).toBe(c.matches);
        expect(c.mappedTotal).toBeLessThanOrEqual(c.matches);
        expect(c.points.length).toBeLessThanOrEqual(c.mappedTotal);
      }
      const byKey = Object.fromEntries(deriveAllCases(records).map((c) => [c.key, c]));
      // public-land remains land-only; property-review includes every reported
      // building plus any land record that carries a review signal.
      expect(byKey["public-land"].buildingCount).toBe(0);
      expect(byKey["property-review"].buildingCount).toBe(
        records.filter((record) => record.universe === "building_report").length,
      );
    }
  });

  it(
    "never carries an owner name, taxpayer string, or ranking field on any record",
    () => {
      for (const entry of PILOT_ZIPS) {
        const { records } = buildCaseRecords(entry.zip);
        for (const record of records) {
          const serialized = record as unknown as Record<string, unknown>;
          for (const key of FORBIDDEN_KEYS) {
            expect(serialized, `record on ${entry.zip}`).not.toHaveProperty(key);
          }
          // Ranking/score words must not leak as a string VALUE. Scoped to
          // fields that carry derived data — the `address` is legitimate public
          // data (and street names like "FRANKLIN" contain "rank" as a
          // substring), so it is not scanned. Word-boundary to avoid substrings.
          for (const [key, value] of Object.entries(serialized)) {
            if (key === "address" || typeof value !== "string") continue;
            expect(value, `record.${key} on ${entry.zip}/${record.id}`).not.toMatch(
              /\b(priority|score|rank|tier)\b/i,
            );
          }
        }
      }
    },
    // No explicit timeout — an explicit value here would override the
    // file-level vi.setConfig testTimeout ceiling above.
  );

  it("60617 public-land land count equals the reconciled land-universe city fold", () => {
    // Consistency guard: public-land land parcels are the report's reconciled
    // City/public land figure (deriveLandUniverse city_public), not a made-up
    // number. Verified against the committed 60617 edition.
    const { records } = buildCaseRecords("60617");
    const publicLand = deriveCase("public-land", records);
    expect(publicLand.landCount).toBe(867);
    expect(publicLand.buildingCount).toBe(0);
    const propertyReview = deriveCase("property-review", records);
    // Updated against the 2026-08-12 vacancy-index.json refresh (was 1252
    // against the 2026-07-22 vintage) — a live-source count, expected to
    // drift with each real refresh.
    expect(propertyReview.buildingCount).toBe(1260);
  });
});

// ── Universe disclosure ──────────────────────────────────────────────────────
//
// Regression for the defect that reads as "this count is mathematically
// impossible": the workbench published case counts with no denominator on the
// page, so the only per-ZIP list available to check them against was the All
// Properties directory file — a DIFFERENT universe (the tracked City-inventory
// + 311 operational list). On 60624 the title-holder case correctly reports
// 1,348 land parcels out of a 2,739-parcel land universe, while the directory
// file carries 1,339 land rows; benchmarked against the wrong denominator the
// right answer looks broken. These tests bind the denominator the page now
// prints to the report's own identity-enforced deriveLandUniverse figure.

describe("case universe denominators", () => {
  for (const entry of PILOT_ZIPS) {
    const zip = entry.zip;

    it(`${zip}: landTotal is the report's own land-universe total`, () => {
      const { universe } = buildCaseRecords(zip);
      const edition = getVacancyIndexEdition(zip);
      expect(edition, `${zip} edition`).not.toBeNull();
      const landUniverse = deriveLandUniverse(edition!);
      expect(universe.landTotal).toBe(landUniverse?.total ?? null);
      expect(universe.building).toBeGreaterThan(0);
    });

    it(`${zip}: every case count fits inside the stated universe`, () => {
      const { records, universe } = buildCaseRecords(zip);
      for (const c of deriveAllCases(records)) {
        expect(c.landCount, `${zip} ${c.key} land`).toBeLessThanOrEqual(universe.land);
        expect(c.buildingCount, `${zip} ${c.key} building`).toBeLessThanOrEqual(universe.building);
        expect(c.landCount + c.buildingCount).toBe(c.matches);
      }
    });

    it(`${zip}: land counts reconcile with the report, or the shortfall is disclosed`, () => {
      const { records, universe } = buildCaseRecords(zip);
      const edition = getVacancyIndexEdition(zip)!;
      const landUniverse = deriveLandUniverse(edition);
      if (landUniverse == null) return;

      const city =
        landUniverse.byOwnerType.find((r) => r.ownerType === "city_public")?.count ?? 0;
      const priv = landUniverse.byOwnerType
        .filter((r) => ["corporate_llc", "out_of_state", "local_private"].includes(r.ownerType))
        .reduce((sum, r) => sum + r.count, 0);
      const byKey = Object.fromEntries(deriveAllCases(records).map((c) => [c.key, c]));

      if (edition.landPointsTruncated) {
        // The export caps published land points per edition, so this ZIP cannot
        // enumerate its whole land universe. The page must SAY so rather than
        // present the short count as a total.
        expect(isLandUniverseTruncated(universe), `${zip} truncation flagged`).toBe(true);
        expect(universe.land).toBeLessThan(universe.landTotal!);
        expect(byKey["public-land"].landCount).toBeLessThanOrEqual(city);
        expect(byKey["title-holder"].landCount).toBeLessThanOrEqual(priv);
      } else {
        expect(isLandUniverseTruncated(universe), `${zip} no false truncation`).toBe(false);
        expect(universe.land, `${zip} land universe`).toBe(landUniverse.total);
        expect(byKey["public-land"].landCount, `${zip} public-land`).toBe(city);
        expect(byKey["title-holder"].landCount, `${zip} private land`).toBe(priv);
      }
    });
  }
});

// ── 311 ownership enrichment over the real committed data ────────────────────

describe("reported-building ownership enrichment (committed data)", () => {
  for (const entry of PILOT_ZIPS) {
    const zip = entry.zip;

    it(`${zip}: every reported building remains in property review after ownership enrichment`, () => {
      const { records } = buildCaseRecords(zip);
      const buildings = records.filter((r) => r.universe === "building_report");
      expect(buildings.length).toBeGreaterThan(0);
      for (const record of buildings) {
        expect(caseMatches("property-review", record), `${zip} ${record.id}`).toBe(true);
      }
      expect(deriveCase("property-review", records).buildingCount).toBe(buildings.length);
      // The enrichment still reaches this ZIP: some reported building resolves
      // to a private taxpayer, so title-holder is not structurally land-only.
      const titleHolder = deriveCase("title-holder", records);
      expect(titleHolder.buildingCount, `${zip} private buildings`).toBeGreaterThan(0);
    });

    it(`${zip}: property review matches the source-separated union once per record`, () => {
      const { records } = buildCaseRecords(zip);
      const expectedIds = new Set(
        records
          .filter(
            (record) =>
              recordSector(record) === "unclassified" ||
              record.universe === "building_report" ||
              record.saleYear != null ||
              record.violation,
          )
          .map((record) => record.id),
      );
      expect(deriveCase("property-review", records).matches).toBe(expectedIds.size);
    });
  }
});

// ── Preview sampling over the real committed data ────────────────────────────

describe("preview point sampling (committed data)", () => {
  it("plots at most the cap on every pilot ZIP, sampled across the mapped set", () => {
    for (const entry of PILOT_ZIPS) {
      const { records } = buildCaseRecords(entry.zip);
      for (const c of deriveAllCases(records)) {
        expect(c.points.length, `${entry.zip} ${c.key}`).toBeLessThanOrEqual(CASE_POINT_CAP);
        expect(c.points.length).toBe(Math.min(c.mappedTotal, CASE_POINT_CAP));
      }
    }
  });
});
