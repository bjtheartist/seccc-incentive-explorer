import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCommunityInvestment } from "../../lib/community-investment";

/**
 * Deliverable 5 — "Nothing downstream may hand-type a total (PR2 consumes
 * meta; you enforce the meta side + a repo scan test listing designated files
 * that must contain no literal dataset totals)."
 *
 * PR1's footprint is the data/export layer only (no API/UI/copy changes — see
 * the PR title and scope note). The designated files here are therefore the
 * PR1-owned surfaces: the exporter/lib source itself (which must COMPUTE every
 * total, never hardcode one) and the two generated documentation blocks. The
 * consumer-facing copy the audit flagged (StatusCards.tsx, Methodology.tsx,
 * app/investment/page.tsx) is explicitly PR2 scope — this test does not (and
 * should not) touch it, but the KNOWN-STALE literals the audit found are
 * scanned repo-wide below as a standing regression guard so they cannot
 * silently reappear while PR2 is pending.
 */
describe("no hand-typed Community Investment totals (PR1 designated files)", () => {
  const DESIGNATED_SOURCE_FILES = [
    "scripts/export-community-investment.ts",
    "lib/community-investment.ts",
  ];

  it("the exporter/lib source never hardcodes the live headline totals as numeric literals", () => {
    const data = loadCommunityInvestment()!;
    // Round to whole-cent strings the way a hand-typed literal would appear.
    const liveTotals = [
      data.meta.totalDollarsAwarded.toFixed(2),
      data.meta.totalAuthorizedTif.toFixed(2),
      data.meta.totalFederalProgram.toFixed(2),
      data.meta.totalCreditCapital.toFixed(2),
      data.meta.totalPublishedStateAppropriation.toFixed(2),
      data.meta.totalRecoveryHistorical.toFixed(2),
      data.meta.bridgeDisplayedHeroDollars.toFixed(2),
    ].filter((s) => s !== "0.00");

    for (const file of DESIGNATED_SOURCE_FILES) {
      const text = readFileSync(join(process.cwd(), file), "utf8");
      for (const total of liveTotals) {
        expect(
          text.includes(total),
          `${file} appears to hardcode a live headline total (${total}) instead of computing it`,
        ).toBe(false);
      }
    }
  });

  /**
   * Standing regression guard for the specific stale figures the audit found
   * already published (finding 1 / C1): the OLD 43,939-record / $3,103,926,547.66
   * headline the built dataset had already moved past, and the "no source
   * reports receipts" claim contradicted by $923.4M of disbursed recovery
   * records (finding 6). Repo-wide (not just PR1 files) because a stale
   * literal could reappear in the PR2 copy layer just as easily as here.
   */
  it("the known-stale audit-flagged figures do not appear anywhere in source", () => {
    const STALE_LITERALS = ["43,939", "3,103,926,547.66", "3103926547.66"];
    for (const literal of STALE_LITERALS) {
      let out = "";
      try {
        out = execFileSync(
          "git",
          ["grep", "-l", "-F", literal, "--", "*.ts", "*.tsx", "*.md"],
          { cwd: process.cwd(), encoding: "utf8" },
        );
      } catch {
        // git grep exits 1 when there are no matches — that is the PASSING case.
        out = "";
      }
      expect(out.trim(), `stale literal "${literal}" still appears in: ${out}`).toBe("");
    }
  });
});
