import { describe, expect, it } from "vitest";
import { PILOT_ZIPS } from "../pilot-zips";
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
  it("exposes exactly the five case types, in order, each with copy", () => {
    expect(CASE_KEYS).toEqual([
      "public-land",
      "private-outreach",
      "ownership-check",
      "building-review",
      "tax-title",
    ]);
    for (const key of CASE_KEYS) {
      const type = caseTypeFor(key);
      expect(type.name.length).toBeGreaterThan(0);
      expect(type.definition.length).toBeGreaterThan(0);
      expect(type.caveat.length).toBeGreaterThan(0);
    }
    expect(CASE_TYPES).toHaveLength(5);
  });

  it("parses ?case= to a known key and falls back to the default otherwise", () => {
    expect(parseCaseParam("tax-title")).toBe("tax-title");
    expect(parseCaseParam(["ownership-check"])).toBe("ownership-check");
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

  it("private-outreach = LAND with a known non-government owner", () => {
    for (const t of ["local_private", "corporate_llc", "out_of_state"] as const) {
      expect(caseMatches("private-outreach", rec({ universe: "land", ownerType: t }))).toBe(true);
    }
    expect(caseMatches("private-outreach", rec({ universe: "land", ownerType: "city_public" }))).toBe(false);
    expect(caseMatches("private-outreach", rec({ universe: "land", ownerType: "unknown" }))).toBe(false);
  });

  // ── Regression: 311 ownership enrichment (a reported building's legacy
  //    ownerType is "unknown" by construction — the 311 feed carries no
  //    ownership — but the export writes the matched parcel's taxpayer
  //    STRUCTURE onto the record. Reading only the legacy field discarded that
  //    and filed every reported building under "owner not yet identified". ──

  it("private-outreach reaches a reported BUILDING whose matched parcel resolved a private taxpayer", () => {
    for (const structure of ["individual", "entity", "trust"] as const) {
      const record = rec({
        universe: "building_report",
        ownerType: "unknown",
        ownerStructure: structure,
        pin: "16143270130000",
      });
      expect(caseMatches("private-outreach", record), structure).toBe(true);
      // ...and it is no longer ALSO an ownership follow-up.
      expect(caseMatches("ownership-check", record), structure).toBe(false);
    }
  });

  it("private-outreach excludes a reported building whose parcel resolved a GOVERNMENT taxpayer", () => {
    const record = rec({
      universe: "building_report",
      ownerType: "unknown",
      ownerStructure: "government",
    });
    expect(caseMatches("private-outreach", record)).toBe(false);
    expect(caseMatches("ownership-check", record)).toBe(false);
    expect(recordSector(record)).toBe("public");
  });

  it("ownership-check = unresolved on BOTH axes, either universe", () => {
    // Unmatched 311 row: no PIN, no structure -> genuinely not yet identified.
    expect(
      caseMatches(
        "ownership-check",
        rec({ universe: "building_report", ownerType: "unknown", ownerStructure: "unresolved" }),
      ),
    ).toBe(true);
    // Land with neither axis resolved.
    expect(
      caseMatches("ownership-check", rec({ universe: "land", ownerType: "unknown", ownerStructure: null })),
    ).toBe(true);
    // Either axis resolving takes the record OUT of the follow-up case.
    expect(caseMatches("ownership-check", rec({ ownerType: "local_private" }))).toBe(false);
    expect(
      caseMatches("ownership-check", rec({ ownerType: "unknown", ownerStructure: "entity" })),
    ).toBe(false);
  });

  it("building-review = the reported-building universe", () => {
    expect(caseMatches("building-review", rec({ universe: "building_report" }))).toBe(true);
    expect(caseMatches("building-review", rec({ universe: "land" }))).toBe(false);
  });

  it("tax-title = any distress signal (tax-sale year OR violation)", () => {
    expect(caseMatches("tax-title", rec({ saleYear: 2015 }))).toBe(true);
    expect(caseMatches("tax-title", rec({ violation: true }))).toBe(true);
    expect(caseMatches("tax-title", rec({ saleYear: null, violation: false }))).toBe(false);
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
    const d = deriveCase("building-review", many, 10);
    expect(d.matches).toBe(50);
    expect(d.buildingCount).toBe(50);
    expect(d.mappedTotal).toBe(50);
    expect(d.points).toHaveLength(10); // capped
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
    const d = deriveCase("tax-title", records, 10);
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

  it("deriveAllCases returns all five in order", () => {
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
      // public-land is land-only; building-review is building-only.
      expect(byKey["public-land"].buildingCount).toBe(0);
      expect(byKey["building-review"].landCount).toBe(0);
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
    15_000,
  );

  it("60617 public-land land count equals the reconciled land-universe city fold", () => {
    // Consistency guard: public-land land parcels are the report's reconciled
    // City/public land figure (deriveLandUniverse city_public), not a made-up
    // number. Verified against the committed 60617 edition.
    const { records } = buildCaseRecords("60617");
    const publicLand = deriveCase("public-land", records);
    expect(publicLand.landCount).toBe(867);
    expect(publicLand.buildingCount).toBe(0);
    const buildingReview = deriveCase("building-review", records);
    expect(buildingReview.buildingCount).toBe(1252);
  });
});

// ── Universe disclosure ──────────────────────────────────────────────────────
//
// Regression for the defect that reads as "this count is mathematically
// impossible": the workbench published case counts with no denominator on the
// page, so the only per-ZIP list available to check them against was the All
// Properties directory file — a DIFFERENT universe (the tracked City-inventory
// + 311 operational list). On 60624 the private-outreach case correctly reports
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
        expect(byKey["private-outreach"].landCount).toBeLessThanOrEqual(priv);
      } else {
        expect(isLandUniverseTruncated(universe), `${zip} no false truncation`).toBe(false);
        expect(universe.land, `${zip} land universe`).toBe(landUniverse.total);
        expect(byKey["public-land"].landCount, `${zip} public-land`).toBe(city);
        expect(byKey["private-outreach"].landCount, `${zip} private land`).toBe(priv);
      }
    });
  }
});

// ── 311 ownership enrichment over the real committed data ────────────────────

describe("reported-building ownership enrichment (committed data)", () => {
  for (const entry of PILOT_ZIPS) {
    const zip = entry.zip;

    it(`${zip}: a reported building with a resolved taxpayer is not an ownership follow-up`, () => {
      const { records } = buildCaseRecords(zip);
      const buildings = records.filter((r) => r.universe === "building_report");
      expect(buildings.length).toBeGreaterThan(0);
      for (const record of buildings) {
        if (recordSector(record) !== "unclassified") {
          expect(
            caseMatches("ownership-check", record),
            `${zip} ${record.id} resolved sector still in ownership-check`,
          ).toBe(false);
        }
      }
      // ...and the enrichment actually reaches this ZIP: some reported building
      // resolves to a private taxpayer, so private-outreach is no longer
      // structurally land-only.
      const privateOutreach = deriveCase("private-outreach", records);
      expect(privateOutreach.buildingCount, `${zip} private buildings`).toBeGreaterThan(0);
    });

    it(`${zip}: ownership follow-up is exactly the records unresolved on both axes`, () => {
      const { records } = buildCaseRecords(zip);
      const expected = records.filter((r) => recordSector(r) === "unclassified").length;
      expect(deriveCase("ownership-check", records).matches).toBe(expected);
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
