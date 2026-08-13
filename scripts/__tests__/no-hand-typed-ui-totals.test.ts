import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCommunityInvestment } from "../../lib/community-investment";

/**
 * Sol gate finding 5 (BLOCKER) — "The scan test, however, deliberately
 * excludes UI/docs and searches only exact unformatted decimal strings;
 * current rounded copy such as '$7 billion' escapes it."
 *
 * Extends the deliverable-5 guard (scripts/__tests__/no-hand-typed-investment-totals.test.ts,
 * scoped to the exporter/lib source) to the actual UI/print/doc CONSUMER
 * files, with a currency/count NORMALIZER that catches rounded prose forms
 * ("$7 billion", "$3.18B", "44,061 records") — not just exact unformatted
 * decimal strings — and checks bridge values and the dedupe kept-flagged
 * claim too, not only the headline awarded total.
 *
 * This is PR1 (data/export layer only — no UI/copy changes here), so the
 * UI/print files below are EXPECTED to still carry PR2-pending stale copy.
 * The gate this test enforces is narrower and forward-looking: no NUMERIC
 * LITERAL in a designated file may equal one of TODAY's live meta totals
 * unless it is explicitly allowlisted as intentionally sourced from meta
 * (i.e., NOT a hand-typed literal — a template/computed value the scanner's
 * naive regex happens to also match). A literal match to a live total that
 * ISN'T allowlisted is exactly the failure mode finding 1/5 describe: a
 * number that will silently drift the next time the export regenerates.
 */
describe("no hand-typed Community Investment totals — UI/print/docs (Sol gate finding 5)", () => {
  const DESIGNATED_CONSUMER_FILES = [
    "components/investment/StatusCards.tsx",
    "components/investment/Methodology.tsx",
    "components/investment/EquityContext.tsx",
    "components/investment/YearBars.tsx",
    "app/investment/page.tsx",
  ].filter((f) => existsSync(join(process.cwd(), f)));

  // Narrow, explicit allowlist: a (file, literal) pair here is a KNOWN,
  // reviewed case where the number is NOT a hand-typed dataset total (e.g. a
  // year, a percentage threshold, an unrelated UI constant). Empty today —
  // add an entry only with a comment explaining why it's safe.
  const ALLOWLIST = new Set<string>([]);

  function normalizeAmountsFromText(text: string): number[] {
    const found: number[] = [];
    // $<number>[,<number>]*[.<decimals>]? optionally followed by a magnitude word/suffix.
    const re = /\$\s*([\d,]+(?:\.\d+)?)\s*(billion|million|thousand|B|M|K)?\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const raw = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(raw)) continue;
      const suffix = (m[2] || "").toLowerCase();
      const scale = suffix === "billion" || suffix === "b" ? 1e9 : suffix === "million" || suffix === "m" ? 1e6 : suffix === "thousand" || suffix === "k" ? 1e3 : 1;
      found.push(raw * scale);
    }
    // Bare large comma-grouped integers (record counts): 44,061 / 26,501 / 7,073 etc.
    const countRe = /\b(\d{2,3}(?:,\d{3})+)\b/g;
    while ((m = countRe.exec(text))) {
      const raw = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(raw)) found.push(raw);
    }
    return found;
  }

  it("no designated UI/print/doc file contains a numeric literal matching a LIVE meta/bridge/dedupe total (normalized currency + count forms)", () => {
    const data = loadCommunityInvestment()!;
    const meta = data.meta;
    // Every headline the audit/consult explicitly named, plus bridge + dedupe
    // claims — the exact set finding 5 called out as escaping the old scan.
    const liveTotals = new Set<number>(
      [
        meta.totalDollarsAwarded,
        meta.totalAuthorizedTif,
        meta.totalFederalProgram,
        meta.totalCreditCapital,
        meta.totalPublishedStateAppropriation,
        meta.totalRecoveryHistorical,
        meta.bridgeFullAwardedDollars,
        meta.bridgeNoCommunityAreaDollars,
        meta.bridgePre2020SitedDollars,
        meta.bridgeDisplayedHeroDollars,
        meta.bridgeFullAwardedRows,
        meta.bridgeNoCommunityAreaRows,
        meta.bridgePre2020SitedRows,
        meta.bridgeDisplayedHeroRows,
        meta.dedupeKeptFlaggedDollars,
        meta.dedupeKeptFlaggedRows,
        meta.dedupeCandidateGroups,
        meta.totalRecords,
        meta.pointCount,
        meta.citywideCount,
      ].filter((n): n is number => typeof n === "number" && n !== 0),
    );

    const violations: string[] = [];
    for (const file of DESIGNATED_CONSUMER_FILES) {
      const text = readFileSync(join(process.cwd(), file), "utf8");
      const literals = normalizeAmountsFromText(text);
      for (const literal of literals) {
        if (!liveTotals.has(literal)) continue;
        const key = `${file}:${literal}`;
        if (ALLOWLIST.has(key)) continue;
        violations.push(key);
      }
    }
    expect(
      violations,
      violations.length
        ? `Found live-total literals in designated UI/doc files (add to ALLOWLIST only with a reviewed reason, or wire the file to meta instead):\n${violations.join("\n")}`
        : "",
    ).toEqual([]);
  });
});
