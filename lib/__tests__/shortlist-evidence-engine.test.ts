import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptySiteMatchCriteria, type SiteMatchCriteria } from "../site-matchmaker";
import { prepareShortlistScreeningRows } from "../shortlist-screening-evidence";
import { runEvidenceShortlist } from "../shortlist-evidence-engine";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const u = read("data/exports/shortlist-universe/60617.json"), sidecar = read("data/exports/shortlist-universe/parcel-identity/60617.json");
const rows = prepareShortlistScreeningRows(u.rows, new Map(Object.entries(sidecar.entries)), new Map(Object.entries(sidecar.factsByPin)));
const stations = read("public/data/rail-stations.json").stations;
const run = (patch: Partial<SiteMatchCriteria>) => runEvidenceShortlist({ rows, stations, sourceRecordsByEvidenceType: u.counts.sourceRecordsByEvidenceType, criteria: { ...createEmptySiteMatchCriteria(), evidenceVersion: "2", zip: "60617", projectUse: "retail-service", propertyType: "existing-building", buildingTypes: ["commercial"], ...patch } });
const contains = (candidates: { address: string }[], address: string) => candidates.some((r) => r.address === address);

describe("evidence shortlist through the full selection entry point", () => {
  it("excludes recorded homes and apartments from commercial matches even in commercial zoning", () => {
    const result = run({ zoningAlignment: "aligned-only" });
    for (const address of ["9513 S OGLESBY AVE", "10802 S TORRENCE AVE", "8100 S BRANDON AVE", "8158 S SOUTH SHORE DR", "3019 E 83RD ST"]) expect(contains(result.ranked, address)).toBe(false);
    expect(contains(result.ranked, "3100 E 92ND ST")).toBe(true);
  });
  it("excludes commercial buildings and apartments from houses-only matches", () => {
    const result = run({ projectUse: "housing-mixed-use", buildingTypes: ["house"], zoningAlignment: "aligned-only" });
    expect(contains(result.ranked, "3100 E 92ND ST")).toBe(false);
    expect(contains(result.ranked, "8736 S MARQUETTE AVE")).toBe(false);
    expect(result.ranked.length).toBeGreaterThan(0);
  });
  it("keeps mixed use explicit and conversions out of ordinary matches", () => {
    expect(contains(run({}).ranked, "8716 S COMMERCIAL AVE")).toBe(false);
    expect(contains(run({ buildingTypes: ["commercial", "mixed-use"] }).ranked, "8716 S COMMERCIAL AVE")).toBe(true);
    const converted = run({ includeConversions: true });
    expect(contains(converted.ranked, "9513 S OGLESBY AVE")).toBe(false);
    expect(contains(converted.conversions, "9513 S OGLESBY AVE")).toBe(true);
  });
  it("supports assessor-area filtering without inventing available space", () => {
    const patch = { buildingTypes: ["mixed-use"] as const, minSquareFeet: 3000, maxSquareFeet: 4000 };
    const assessor = run({ ...patch, measurementBasis: "assessor-building" });
    expect(contains(assessor.ranked, "1857 E 79TH ST")).toBe(true);
    const available = run({ ...patch, measurementBasis: "available-interior" });
    expect(available.ranked).toHaveLength(0);
    expect(contains(available.review, "1857 E 79TH ST")).toBe(true);
  });
  it("keeps ambiguous identity and land/building conflicts in review", () => {
    expect(contains(run({}).review, "2715 E 83RD ST")).toBe(true);
    const land = run({ propertyType: "vacant-land", buildingTypes: [] });
    for (const address of ["8408 S BURLEY AVE", "9139 S BUFFALO AVE"]) {
      expect(contains(land.ranked, address)).toBe(false);
      expect(contains(land.review, address)).toBe(true);
    }
  });
  it("keeps land eligible when either is selected alongside commercial building types", () => {
    const result = run({ propertyType: "either" });
    expect(result.ranked.some((r) => r.propertyType === "vacant_land")).toBe(true);
    expect(result.ranked.filter((r) => r.propertyType === "vacant_building").every((r) => r.screeningEvidence?.recordedType === "commercial")).toBe(true);
  });
  it("does not certify PD/PMD as a broad alignment match", () => {
    const result = run({ buildingTypes: [], zoningAlignment: "aligned-only" });
    expect(result.ranked.every((r) => r.badge === "aligned")).toBe(true);
    expect(result.review.some((r) => r.badge === "planned-development")).toBe(true);
  });
});
