import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCommunityInvestment } from "../community-investment";

/**
 * Sol gate finding 8 (BLOCKER) — "Interleaving the 33 held rows renumbered
 * 5,775 existing IDs: 647 TIF, 4,644 HUD, and 484 LIHTC. Those IDs persist in
 * saved items and notes, so an old saved ID can now identify a different
 * record."
 *
 * lib/__tests__/fixtures/pre-pr1-id-baseline.json is a frozen snapshot of
 * every tif/cdbg-home/lihtc record's `id` -> content key
 * (recipient|address|year|amountAwarded|authorizedAmount|creditAmount) from
 * the committed export at the PR's merge-base (origin/main, commit 2b912d6,
 * BEFORE any PR1 identity/location-taxonomy work). This is the ONLY test that
 * can catch a renumbering regression: comparing the new export against
 * ITSELF (same-ordering) would never see it, because both sides would already
 * share the bug.
 */
describe("export id baseline regression (Sol gate finding 8)", () => {
  const baseline = JSON.parse(
    readFileSync(join(process.cwd(), "lib/__tests__/fixtures/pre-pr1-id-baseline.json"), "utf8"),
  ) as Record<string, Record<string, string>>;

  function contentKey(r: {
    recipient: string;
    address: string | null;
    year: number | null;
    amountAwarded: number | null;
    authorizedAmount?: number | null;
    creditAmount?: number | null;
  }): string {
    return [r.recipient, r.address, r.year, r.amountAwarded, r.authorizedAmount ?? null, r.creditAmount ?? null].join(
      "|",
    );
  }

  it.each(["tif", "cdbg-home", "lihtc"] as const)(
    "every %s record that existed pre-PR1 keeps its EXACT prior id",
    (source) => {
      const data = loadCommunityInvestment()!;
      const current = data.records.filter((r) => r.source === source);
      const currentById = new Map(current.map((r) => [r.id, r]));
      const baselineForSource = baseline[source];
      expect(Object.keys(baselineForSource).length).toBeGreaterThan(0);

      let matched = 0;
      const mismatches: string[] = [];
      for (const [id, key] of Object.entries(baselineForSource)) {
        const record = currentById.get(id);
        if (!record) {
          mismatches.push(`${id}: MISSING from current export`);
          continue;
        }
        const currentKey = contentKey(record);
        if (currentKey !== key) {
          mismatches.push(`${id}: content changed (baseline "${key}" vs current "${currentKey}")`);
          continue;
        }
        matched++;
      }
      expect(mismatches, mismatches.slice(0, 10).join("\n")).toEqual([]);
      expect(matched).toBe(Object.keys(baselineForSource).length);
    },
  );

  it("held rows (new in PR1) are APPENDED with a distinct -held- namespace, never interleaved into the old sequence", () => {
    const data = loadCommunityInvestment()!;
    for (const source of ["tif", "cdbg-home", "lihtc"] as const) {
      const records = data.records.filter((r) => r.source === source);
      const baselineIds = new Set(Object.keys(baseline[source]));
      const newRecords = records.filter((r) => !baselineIds.has(r.id));
      expect(newRecords.length).toBeGreaterThan(0);
      for (const r of newRecords) {
        expect(r.id).toMatch(/-held-\d+$/);
        expect(r.geometry.kind).toBe("citywide");
        expect(r.locationReason).not.toBeNull();
      }
      // Every held id is genuinely NEW — never collides with (renumbers over) a
      // baseline id.
      for (const r of newRecords) {
        expect(baselineIds.has(r.id)).toBe(false);
      }
    }
  });
});
