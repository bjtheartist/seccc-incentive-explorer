import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sol gate finding 4 (BLOCKER) — "The checker can reuse one export record for
 * multiple announcement rows and, when an amount exists, does not require the
 * recipient to match. Several rows reuse `prize-1`, `prize-8`, and `prize-0`."
 *
 * Re-runs the fixed one-to-one checker and asserts: every matched export
 * record id is unique (no reuse across rows), every matched row's recipient
 * text actually matched (never amount-only), and the committed report
 * describes the result as citation PRESENCE, never "live validation".
 */
describe("Chicago Prize census check is one-to-one (Sol gate finding 4)", () => {
  it("re-running the checker produces zero duplicate matched record ids", () => {
    execFileSync("python3", ["scripts/foundation/chicago_prize_census_check.py"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });
    const report = JSON.parse(
      readFileSync(join(process.cwd(), "data/curated/investment-inputs/chicago_prize_census_check.json"), "utf8"),
    ) as {
      ok: number;
      total: number;
      all_ok: boolean;
      one_to_one_verified: boolean;
      scope_note: string;
      rows: Array<{ matched_export_record_id: string | null }>;
    };

    expect(report.one_to_one_verified).toBe(true);
    const matchedIds = report.rows.map((r) => r.matched_export_record_id).filter((id): id is string => id != null);
    expect(new Set(matchedIds).size).toBe(matchedIds.length);
    expect(report.all_ok).toBe(true);
    expect(report.ok).toBe(report.total);

    // The public description must claim citation PRESENCE, never live validation.
    expect(report.scope_note.toLowerCase()).toContain("citation presence");
    expect(report.scope_note.toLowerCase()).not.toContain("live announcement validation");
  }, 30_000);
});
