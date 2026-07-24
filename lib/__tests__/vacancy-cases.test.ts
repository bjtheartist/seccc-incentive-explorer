import { describe, expect, it } from "vitest";
import { PILOT_ZIPS } from "../pilot-zips";
import {
  CASE_KEYS,
  CASE_TYPES,
  DEFAULT_CASE_KEY,
  caseMatches,
  caseTypeFor,
  deriveAllCases,
  deriveCase,
  parseCaseParam,
  type VacancyCaseRecord,
} from "../vacancy-cases";
import { buildCaseRecords } from "../vacancy-cases-data";

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

  it("ownership-check = owner not yet classified (unknown), either universe", () => {
    expect(caseMatches("ownership-check", rec({ universe: "land", ownerType: "unknown" }))).toBe(true);
    expect(caseMatches("ownership-check", rec({ universe: "building_report", ownerType: "unknown" }))).toBe(true);
    expect(caseMatches("ownership-check", rec({ ownerType: "local_private" }))).toBe(false);
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
    expect(buildCaseRecords("00000")).toEqual({ records: [], areas: [], recordsAsOf: "" });
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
    expect(buildingReview.buildingCount).toBe(1303);
  });
});
