import { describe, expect, it } from "vitest";
import { loadShortlistUniverse } from "../shortlist-universe";
import { loadScreeningRows } from "../shortlist-screening-data";
import { runEvidenceShortlist } from "../shortlist-evidence-engine";
import { createEmptySiteMatchCriteria, SITE_BUILDING_TYPE_OPTIONS } from "../site-matchmaker";
import { railStations } from "../rail-stations";
import { readdirSync } from "node:fs";

const zips = readdirSync("data/exports/shortlist-universe").filter((f) => /^\d{5}\.json$/.test(f)).map((f) => f.slice(0, 5));
describe.each(zips)("ZIP %s full-universe evidence contract", (zip) => {
  it("preserves source lineage and admits no wrong type, conflicted record, unknown identity or out-of-band area", () => {
    const loaded = loadShortlistUniverse(zip);
    if (!loaded.ok) throw new Error("Invalid committed fixture: " + zip);
    const rows = loadScreeningRows(loaded.data);
    const lineage = rows.flatMap((r) => r.screeningEvidence!.sourceKeys);
    expect([...lineage].sort()).toEqual(loaded.data.rows.map((r) => r.canonicalKey).sort());
    expect(new Set(rows.map((r) => r.canonicalKey)).size).toBe(rows.length);
    for (const type of SITE_BUILDING_TYPE_OPTIONS) for (const aligned of [false, true]) for (const minimum of [null, 1000]) {
      const result = runEvidenceShortlist({ rows, stations: railStations(), sourceRecordsByEvidenceType: loaded.data.counts.sourceRecordsByEvidenceType,
        criteria: { ...createEmptySiteMatchCriteria(), evidenceVersion: "2", zip, projectUse: "retail-service", propertyType: "existing-building", buildingTypes: [type.value], zoningAlignment: aligned ? "aligned-only" : null, minSquareFeet: minimum, measurementBasis: "assessor-building" } });
      for (const candidate of result.ranked) {
        const evidence = candidate.screeningEvidence!;
        expect(evidence.recordedType).toBe(type.value);
        expect(evidence.conflictingPropertyEvidence).toBe(false);
        expect(["saved", "resolved"]).toContain(evidence.identityStatus);
        expect(evidence.identityReviewReason).toBeUndefined();
        if (aligned) expect(candidate.badge).toBe("aligned");
        if (minimum) expect(evidence.measurements["assessor-building"]!.value).toBeGreaterThanOrEqual(minimum);
      }
      const keys = [...result.ranked, ...result.review, ...result.conversions].map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  }, 30000);
});
