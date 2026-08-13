import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCommunityInvestment } from "../community-investment";

/**
 * Deliverable 2 — "existing positional foundation-N ids must not renumber on
 * future appends (define the mapping once, test it)."
 *
 * data/curated/investment-inputs/foundation-id-map.json is the FROZEN mapping
 * from every foundation record's positional `id` (foundation-N / foundation-t1-N
 * / foundation-p2-N / foundation-p3-N) to its content-derived `stableId`
 * (deliverable 2 — sha256(filingObjectId|taxPeriodEnd|schedulePart|
 * sourceRowOrdinal), or a fingerprint-only fallback when identity did not
 * resolve). Committed once; a future run must be a SUPERSET that never changes
 * an EXISTING entry — a positional id renumbering, or a stableId drifting for
 * the SAME underlying row, would both be silent breaking changes for any PR2
 * consumer that persists a stableId as a durable key.
 */
describe("foundation-id-map.json (stable identity, PR1 deliverable 2)", () => {
  const mapPath = join(process.cwd(), "data", "curated", "investment-inputs", "foundation-id-map.json");
  const idMap = JSON.parse(readFileSync(mapPath, "utf8")) as Record<
    string,
    { stableId: string; filingObjectId: string | null; sourceRowOrdinal: number | null }
  >;

  const PRIZE_FUNDER = "Pritzker Traubert Foundation — Chicago Prize";

  it("every committed IRS-filing foundation record's id/stableId pair matches the frozen map exactly", () => {
    const data = loadCommunityInvestment()!;
    // Chicago Prize rows share the `foundation` source but are award
    // announcements, not IRS filings (consult Q3) — deliverable 2 identity
    // (filingObjectId/schedulePart/sourceRowOrdinal) never applies to them, so
    // they are excluded from this map exactly like the fresh SRS audit excludes
    // them from its universe.
    const foundation = data.records.filter((r) => r.source === "foundation" && r.funderName !== PRIZE_FUNDER);
    expect(foundation.length).toBeGreaterThan(0);
    for (const r of foundation) {
      const entry = idMap[r.id];
      expect(entry, `id-map is missing an entry for ${r.id}`).toBeDefined();
      expect(entry.stableId).toBe(r.stableId);
      expect(entry.filingObjectId).toBe(r.filingObjectId);
      expect(entry.sourceRowOrdinal).toBe(r.sourceRowOrdinal);
    }
    // The map must not carry stale entries for ids the export no longer has.
    const liveIds = new Set(foundation.map((r) => r.id));
    for (const id of Object.keys(idMap)) {
      expect(liveIds.has(id), `id-map carries a stale entry ${id} not in the committed export`).toBe(true);
    }
  });

  it("stableId is content-derived, never a bare re-serialization of the positional id", () => {
    for (const [id, entry] of Object.entries(idMap)) {
      expect(entry.stableId).not.toBe(id);
      expect(entry.stableId).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  /**
   * PIN — a handful of specific rows, so a future regeneration that silently
   * renumbers or reshuffles identity resolution fails THIS test immediately,
   * not just the broader "matches the frozen map" check above (which reads
   * both sides from the same regenerated file and would not catch a
   * regenerate-then-commit that moved both together).
   */
  it("PINNED sample stableIds never change across a regeneration", () => {
    expect(idMap["foundation-0"]?.stableId).toBe("86010b8966c25c17");
    expect(idMap["foundation-0"]?.filingObjectId).toBe("202303179349103040");
  });
});
