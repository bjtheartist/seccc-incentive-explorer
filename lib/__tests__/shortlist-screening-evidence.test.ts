import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessShortlistEvidence, consolidateScreeningRows, prepareShortlistScreeningRows, recordedPropertyType } from "../shortlist-screening-evidence";
import { createEmptySiteMatchCriteria } from "../site-matchmaker";
import type { ShortlistUniverseFile } from "../shortlist-universe-schema";
import type { PrecomputedCountyParcelFacts, ShortlistParcelIdentityEntry } from "../shortlist-parcel-identity";

const universe = JSON.parse(readFileSync("data/exports/shortlist-universe/60617.json", "utf8")) as ShortlistUniverseFile;
const sidecar = JSON.parse(readFileSync("data/exports/shortlist-universe/parcel-identity/60617.json", "utf8"));
const identities = new Map<string, ShortlistParcelIdentityEntry>(Object.entries(sidecar.entries));
const facts = new Map<string, PrecomputedCountyParcelFacts>(Object.entries(sidecar.factsByPin));
const prepared = prepareShortlistScreeningRows(universe.rows, identities, facts);
const at = (address: string) => prepared.find((row) => row.address === address)!.screeningEvidence!;

describe("pre-screening recorded evidence", () => {
  it("distinguishes the actual houses and apartments from commercial and mixed use", () => {
    expect(at("9513 S OGLESBY AVE").recordedType).toBe("house");
    expect(at("10802 S TORRENCE AVE").recordedType).toBe("house");
    expect(at("8100 S BRANDON AVE").recordedType).toBe("multifamily");
    expect(at("3100 E 92ND ST").recordedType).toBe("commercial");
    expect(at("8716 S COMMERCIAL AVE").recordedType).toBe("mixed-use");
    expect(recordedPropertyType("2-12")).toBe("mixed-use");
    expect(recordedPropertyType("318")).toBe("mixed-use");
    expect(recordedPropertyType("EX")).toBe("exempt");
    expect(recordedPropertyType("599")).toBe("commercial");
    expect(recordedPropertyType("500")).toBe("land");
  });

  it("joins an assessor measurement with its source year without inventing available space", () => {
    const evidence = at("1857 E 79TH ST");
    expect(evidence.measurements["assessor-building"]).toMatchObject({ value: 3375, basis: "assessor-building", effectiveYear: "2024" });
    expect(evidence.measurements["available-interior"]).toBeNull();
    expect(evidence.measurements.footprint).toBeNull();
    expect(universe.rows.find((r) => r.address === "1857 E 79TH ST")!.buildingSqft).toBeNull();
  });

  it("retains the unresolved corner alias rather than borrowing intersecting parcel facts", () => {
    const evidence = at("2715 E 83RD ST");
    expect(evidence.pin).toBeNull();
    expect(evidence.recordedType).toBe("unknown");
    expect(evidence.measurements["assessor-building"]).toBeNull();
  });

  it("flags both frozen land versus building conflicts without choosing a newer truth", () => {
    expect(at("8408 S BURLEY AVE").conflictingPropertyEvidence).toBe(true);
    expect(at("9139 S BUFFALO AVE").conflictingPropertyEvidence).toBe(true);
  });

  it("does not attach another PIN's facts or use a sidecar to replace an invalid saved PIN", () => {
    const source = universe.rows.find((r) => r.address === "1857 E 79TH ST")!;
    const [row] = prepareShortlistScreeningRows([{ ...source, pin: "invalid" }], identities, facts);
    expect(row.screeningEvidence).toMatchObject({ pin: null, identityStatus: "invalid", countyClass: null });
    const [missing] = prepareShortlistScreeningRows([source], new Map(), facts);
    expect(missing.screeningEvidence!.recordedType).toBe("unknown");
  });

  it("does not turn land or minor improvements into an industrial or commercial building", () => {
    expect(recordedPropertyType("550")).toBe("land");
    for (const code of ["201", "535", "580", "587", "590", "999"]) expect(recordedPropertyType(code)).toBe("unknown");
    expect(recordedPropertyType("593")).toBe("industrial");
    expect(recordedPropertyType("592")).toBe("commercial");
  });
  it("routes unresolved identities to review even when the user explicitly selects any building type", () => {
    const row = prepared.find((r) => r.address === "2715 E 83RD ST")!;
    expect(assessShortlistEvidence(row, { ...createEmptySiteMatchCriteria(), evidenceVersion: "2", buildingTypes: [], propertyType: "existing-building" }).disposition).toBe("review");
  });
  it("allows independent land evidence without borrowing County identity or measurements", () => {
    const source = prepared.find((r) => !r.hasVacantBuildingEvidence && r.hasVacantLandEvidence && r.screeningEvidence?.identityStatus === "unresolved")!;
    const row = { ...source, screeningEvidence: { ...source.screeningEvidence!, conflictingPropertyEvidence: false, identityReviewReason: undefined } };
    const criteria = { ...createEmptySiteMatchCriteria(), evidenceVersion: "2" as const, propertyType: "vacant-land" as const, buildingTypes: [] };
    expect(assessShortlistEvidence(row, criteria).disposition).toBe("match");
    expect(row.screeningEvidence.pin).toBeNull();
    expect(assessShortlistEvidence(row, { ...criteria, minSquareFeet: 1000, measurementBasis: "assessor-building" }).disposition).toBe("review");
  });

  it("preserves different unit addresses and flags them instead of merging them", () => {
    const source = prepared.find((r) => r.screeningEvidence?.pin)!;
    const result = consolidateScreeningRows([source, { ...source, canonicalKey: "unit:b", address: source.address + " UNIT B" }]);
    expect(result).toHaveLength(2);
    expect(result.every((r) => Boolean(r.screeningEvidence?.identityReviewReason))).toBe(true);
  });

  it("normalizes unavailable area sentinel values without fallback to a different measurement type", () => {
    const source = universe.rows.find((r) => r.address === "1857 E 79TH ST")!;
    const entry = identities.get(source.canonicalKey)!;
    if (entry.status !== "resolved") throw new Error("fixture must resolve");
    const bad = new Map(facts);
    bad.set(entry.pin, { ...facts.get(entry.pin)!, assessorBuildingSqft: -1, lotAreaSqft: 0 });
    const [row] = prepareShortlistScreeningRows([source], identities, bad);
    expect(row.screeningEvidence!.measurements["assessor-building"]).toBeNull();
  });
});
