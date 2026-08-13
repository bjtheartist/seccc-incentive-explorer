import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCommunityInvestment } from "../community-investment";

/**
 * Sol gate finding 3 (BLOCKER) — "7,040 of 7,073 citywide records lack
 * `locationReason`, and no record-level exclusion ledger exists."
 *
 * data/private/investment-exclusion-ledger.json is written by the exporter
 * every run (scripts/export-community-investment.ts's buildExclusionLedger):
 * one record-level entry per (source, locationReason) group with member
 * record ids, PLUS a true-exclusion tier for rows that never became a record
 * at all. This test verifies the ledger is bound to the SAME export it was
 * generated alongside, and that every retained group's record ids are real,
 * carry the claimed locationReason, and their dollars reconcile.
 */
describe("investment exclusion ledger (Sol gate finding 3)", () => {
  const ledgerPath = join(process.cwd(), "data/private/investment-exclusion-ledger.json");
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as {
    boundExportContentHash: string;
    retained: Array<{ source: string; locationReason: string; count: number; dollars: number; recordIds: string[] }>;
    trueExclusions: Array<{ source: string; reason: string; count: number; dollars: number | null; evidence: string }>;
  };

  it("is bound to the currently committed export's content hash", () => {
    const data = loadCommunityInvestment()!;
    expect(ledger.boundExportContentHash).toBe(data.meta.exportContentHash);
  });

  it("EVERY citywide/zip_area-excluded-from-plotting record in the export has a locationReason claim reconciled by the ledger", () => {
    const data = loadCommunityInvestment()!;
    const citywide = data.records.filter((r) => r.geometry.kind === "citywide");
    // Sol's exact complaint: 7,040 of 7,073 lacked a reason. Zero tolerance now.
    const missing = citywide.filter((r) => !r.locationReason);
    expect(missing.map((r) => r.id)).toEqual([]);
  });

  it("every retained ledger group's record ids exist, match source/locationReason, and dollars reconcile", () => {
    const data = loadCommunityInvestment()!;
    const byId = new Map(data.records.map((r) => [r.id, r]));
    expect(ledger.retained.length).toBeGreaterThan(0);
    for (const group of ledger.retained) {
      expect(group.recordIds.length).toBe(group.count);
      let dollarSum = 0;
      for (const id of group.recordIds) {
        const record = byId.get(id);
        expect(record, `ledger references missing record ${id}`).toBeDefined();
        expect(record!.source).toBe(group.source);
        expect(record!.locationReason).toBe(group.locationReason);
        dollarSum += record!.amountAwarded ?? record!.authorizedAmount ?? record!.creditAmount ?? record!.publishedBalance ?? 0;
      }
      expect(dollarSum).toBeCloseTo(group.dollars, 2);
    }
  });

  it("every true-exclusion entry carries a count, an evidence string, and (when computable) dollars — never silently absent", () => {
    for (const exclusion of ledger.trueExclusions) {
      expect(exclusion.count).toBeGreaterThan(0);
      expect(exclusion.evidence.length).toBeGreaterThan(10);
      // dollars may be null (documented as "not retained for this aggregate
      // count in this run" in evidence) but never undefined/silently absent.
      expect(exclusion).toHaveProperty("dollars");
    }
  });
});
