import { describe, expect, it } from "vitest";
import { loadShortlistUniverse } from "../shortlist-universe";
import { loadScreeningRows, loadPreparedEvidenceShortlist } from "../shortlist-screening-data";
import { runEvidenceShortlist } from "../shortlist-evidence-engine";
import { createEmptySiteMatchCriteria } from "../site-matchmaker";
import { railStations } from "../rail-stations";

const loaded = loadShortlistUniverse("60617");
if (!loaded.ok) throw new Error("60617 fixture unavailable");
const rows = loadScreeningRows(loaded.data);
describe("validated screening snapshot production loader", () => {
  it("consolidates duplicate parcel/address leads while retaining source lineage", () => {
    const matches = rows.filter((r) => r.screeningEvidence?.pin === "20361010320000" && r.address === "7944 S RIDGELAND AVE");
    expect(matches).toHaveLength(1);
    expect(matches[0].screeningEvidence!.sourceKeys).toHaveLength(2);
    expect(matches[0].screeningEvidence!.sourceKeys).toContain("pin:20361010320000");
  });
  it("joins actual community polygons without equating the ZIP with South Chicago", () => {
    expect(rows.find((r) => r.address === "9513 S OGLESBY AVE")!.screeningEvidence!.communityArea).toBe("SOUTH DEERING");
    expect(rows.find((r) => r.address === "8100 S BRANDON AVE")!.screeningEvidence!.communityArea).toBe("SOUTH CHICAGO");
    const result = runEvidenceShortlist({ rows, stations: railStations(), sourceRecordsByEvidenceType: loaded.data.counts.sourceRecordsByEvidenceType, criteria: { ...createEmptySiteMatchCriteria(), evidenceVersion: "2", zip: "60617", projectUse: "housing-mixed-use", propertyType: "existing-building", buildingTypes: [], communityArea: "SOUTH CHICAGO" } });
    expect(result.ranked.length).toBeGreaterThan(0);
    expect(result.ranked.every((r) => r.screeningEvidence!.communityArea === "SOUTH CHICAGO")).toBe(true);
  });
});

describe("dated live-source contradictions", () => {
  it("quarantines the saved-PIN mismatch without replacing it with the neighboring parcel", () => {
    const row = rows.find((r) => r.canonicalKey === "pin:26073140170000")!;
    expect(row.pin).toBe("26073140170000"); // untouched source identity
    expect(row.screeningEvidence).toMatchObject({ pin: null, identityStatus: "ambiguous", countyClass: null });
    expect(Object.values(row.screeningEvidence!.measurements).every((value) => value === null)).toBe(true);
  });
});


describe("bounded prepared-brief cache", () => {
  it("reuses immutable evidence calculations without mixing different building requirements", () => {
    const criteria = { ...createEmptySiteMatchCriteria(), evidenceVersion: "2" as const, zip: "60617", projectUse: "retail-service" as const, propertyType: "existing-building" as const, buildingTypes: ["commercial"] as const };
    const first = loadPreparedEvidenceShortlist(loaded.data, criteria, railStations());
    expect(loadPreparedEvidenceShortlist(loaded.data, { ...criteria }, railStations())).toBe(first);
    const homes = loadPreparedEvidenceShortlist(loaded.data, { ...criteria, buildingTypes: ["house"] }, railStations());
    expect(homes).not.toBe(first);
    expect(homes.displayed.every((r) => r.screeningEvidence?.recordedType === "house")).toBe(true);
    expect(first.displayed.every((r) => r.screeningEvidence?.recordedType === "commercial")).toBe(true);
  });
});
