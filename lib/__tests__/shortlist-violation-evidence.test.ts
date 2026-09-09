import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { incorporateVacancyCitations, type LocatedVacancyCitation } from "../shortlist-violation-evidence";
import { ShortlistUniverseFileSchema, validateEnvelopeCounts, type ShortlistUniverseFile } from "../shortlist-universe-schema";
import { runShortlistEngine } from "../shortlist-engine";
import { createEmptySiteMatchCriteria } from "../site-matchmaker";
import { shortlistCsv } from "../shortlist-csv";

const reference = new Date("2026-09-08T20:00:00Z");
function signal(overrides: Partial<LocatedVacancyCitation> = {}): LocatedVacancyCitation {
  return {
    id: "violation-building-group-1", zip: "60617", address: "1 TEST ST", lat: 41.73, lon: -87.55,
    citation: { id: "violation-building-group-1", sourceRowId: "1", sourceUrl: "https://data.cityofchicago.org/resource/22u3-xenr.json?id=1", recordDate: "2024-01-01T00:00:00.000Z", status: "OPEN", scope: "Vacancy citation: REAR UNIT VACANT", sourceAsOf: null, retrievedAt: "2026-09-08T19:00:00.000Z" },
    zoning: { status: "resolved", district: "B3-2", zoneType: 1, pdNum: null, pmdSubArea: null },
    overlays: Object.fromEntries(["ssa", "ccsa", "tif", "nof"].map((key) => [key, { present: false, name: null, unknown: true }])) as LocatedVacancyCitation["overlays"],
    incentiveCount: null, ...overrides,
  };
}
function empty(): ShortlistUniverseFile {
  const file = JSON.parse(readFileSync("data/exports/shortlist-universe/60617.json", "utf8"));
  return { ...file, rows: [], counts: { sourceRecords: 0, sourceRecordsByEvidenceType: { city_land: 0, "311_building": 0, "311_land": 0, assessor_vacant_land: 0, building_violation: 0 }, canonicalSites: 0, buildings: 0, land: 0, withPin: 0, withMeasuredArea: 0, withZoning: 0 }, dedupe: { collapsedRecords: 0, conflictingPropertyTypes: 0, unresolvedConflicts: 0 } };
}

describe("ranked vacancy citations", () => {
  it("retains partial vacancy, dated provenance and unknown parcel facts through ranking and CSV", () => {
    const file = incorporateVacancyCitations(empty(), [signal()], reference);
    expect(validateEnvelopeCounts(file)).toEqual([]);
    expect(ShortlistUniverseFileSchema.safeParse(file).success).toBe(true);
    expect(file.rows[0]).toMatchObject({ evidenceTypes: ["building_violation"], pin: null, buildingSqft: null, lotSqft: null, ownerConfidence: "needs_verification" });
    const result = runShortlistEngine({ rows: file.rows, sourceRecordsByEvidenceType: file.counts.sourceRecordsByEvidenceType, stations: [], criteria: { ...createEmptySiteMatchCriteria(), zip: "60617", projectUse: "retail-service", propertyType: "existing-building" } });
    expect(result.funnel.trackedEvidence).toBe(1);
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0].vacancyCitations?.[0].scope).toBe("Vacancy citation: REAR UNIT VACANT");
    const decorated = result.ranked.map((row) => ({ ...row, nearestRailDisplay: null, expresswayDisplay: null, nearestSchool: null, nearestLibrary: null }));
    const csv = shortlistCsv(decorated);
    expect(csv).toContain("Chicago Building Violations (22u3-xenr)");
    expect(csv).toContain("2024-01-01");
    expect(csv).toContain("REAR UNIT VACANT");
    expect(csv).toContain(signal().citation.sourceUrl);
  });

  it("adds evidence to a uniquely matching PIN-less site without changing its identity or measured facts", () => {
    const base = incorporateVacancyCitations(empty(), [signal()], reference);
    const original = { ...base.rows[0], canonicalKey: "site:existing", evidenceTypes: ["311_building" as const], vacancyCitations: undefined, violation: false, buildingSqft: 4000, buildingSqftSource: "311_building" as const };
    base.rows = [original]; base.counts.sourceRecordsByEvidenceType = { ...base.counts.sourceRecordsByEvidenceType, building_violation: 0, "311_building": 1 };
    const file = incorporateVacancyCitations(base, [signal()], reference);
    expect(file.rows).toHaveLength(1);
    expect(file.rows[0]).toMatchObject({ canonicalKey: "site:existing", buildingSqft: 4000, buildingSqftSource: "311_building", evidenceTypes: ["311_building", "building_violation"] });
    expect(file.dedupe.collapsedRecords).toBe(1);
    expect(validateEnvelopeCounts(file)).toEqual([]);
    expect(original.violation).toBe(false);
  });

  it("does not merge nearby different addresses or inherit an unverified PIN", () => {
    const base = incorporateVacancyCitations(empty(), [signal()], reference);
    base.rows[0] = { ...base.rows[0], canonicalKey: "pin:12345678901234", pin: "12345678901234", vacancyCitations: undefined };
    expect(incorporateVacancyCitations(base, [signal()], reference).rows).toHaveLength(2);
    base.rows[0] = { ...base.rows[0], pin: null, address: "3 TEST ST" };
    expect(incorporateVacancyCitations(base, [signal()], reference).rows).toHaveLength(2);
  });

  it("is idempotent and rejects changed source facts instead of silently overwriting them", () => {
    const file = incorporateVacancyCitations(empty(), [signal()], reference);
    expect(incorporateVacancyCitations(file, [signal()], reference)).toEqual(file);
    const changed = signal(); changed.citation.scope = "Different inspection";
    expect(() => incorporateVacancyCitations(file, [changed], reference)).toThrow("reconciliation");
  });

  it.each(["2020-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"])("rejects dates outside the selected window: %s", (recordDate) => {
    const entry = signal(); entry.citation.recordDate = recordDate;
    expect(() => incorporateVacancyCitations(empty(), [entry], reference)).toThrow("retention");
  });

  it("rejects wrong ZIPs, duplicate groups, and missing locations", () => {
    expect(() => incorporateVacancyCitations(empty(), [signal({ zip: "60649" })], reference)).toThrow("Wrong ZIP");
    expect(() => incorporateVacancyCitations(empty(), [signal(), signal()], reference)).toThrow("Duplicate");
    expect(() => incorporateVacancyCitations(empty(), [signal({ lat: NaN })], reference)).toThrow("Unlocated");
  });

  it("publishes exactly nine in-coverage citations and preserves all 25 in the source bundle", () => {
    const bundle = JSON.parse(readFileSync("data/exports/shortlist-universe/building-violations.json", "utf8"));
    const manifest = JSON.parse(readFileSync("data/exports/shortlist-universe/manifest.json", "utf8"));
    expect(bundle.signals).toHaveLength(25);
    const citations = manifest.zips.flatMap((zip: string) => {
      const file = ShortlistUniverseFileSchema.parse(JSON.parse(readFileSync(`data/exports/shortlist-universe/${zip}.json`, "utf8")));
      expect(validateEnvelopeCounts(file)).toEqual([]);
      return file.rows.flatMap((row) => row.vacancyCitations ?? []);
    });
    expect(citations).toHaveLength(9);
    expect(new Set(citations.map((item: { id: string }) => item.id)).size).toBe(9);
  });
});
