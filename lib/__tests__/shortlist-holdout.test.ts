import { describe, expect, it } from "vitest";
import fixture from "./fixtures/matchmaker-holdout-2026-09-13.json";
import { loadShortlistUniverse } from "../shortlist-universe";
import { loadScreeningRows } from "../shortlist-screening-data";
import { runEvidenceShortlist } from "../shortlist-evidence-engine";
import { createEmptySiteMatchCriteria } from "../site-matchmaker";
import { railStations } from "../rail-stations";

describe("independent 90-record holdout frozen before source adjudication", () => {
  it("keeps every observed contradiction or unresolved identity out of ordinary matches", () => {
    expect(fixture.records).toHaveLength(90);
    for (const zip of new Set(fixture.records.map((r) => r.zip))) {
      const loaded = loadShortlistUniverse(zip); if (!loaded.ok) throw new Error(zip);
      const result = runEvidenceShortlist({ rows: loadScreeningRows(loaded.data), stations: railStations(), sourceRecordsByEvidenceType: loaded.data.counts.sourceRecordsByEvidenceType,
        criteria: { ...createEmptySiteMatchCriteria(), evidenceVersion: "2", zip, projectUse: "retail-service", propertyType: "either", buildingTypes: [] } });
      const main = new Set(result.ranked.flatMap((r) => r.screeningEvidence!.sourceKeys));
      const review = new Set(result.review.flatMap((r) => r.screeningEvidence!.sourceKeys));
      for (const frozen of fixture.records.filter((r) => r.zip === zip && r.mustReview)) {
        expect(main.has(frozen.canonicalKey), frozen.address).toBe(false);
        expect(review.has(frozen.canonicalKey), frozen.address).toBe(true);
      }
    }
  });
});
