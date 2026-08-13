import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCommunityInvestment } from "../../lib/community-investment";

/**
 * Sol gate finding 5 (BLOCKER, round 2) — "The scanner parses compact
 * currency, but compares the normalized value to exact totals. Thus '$3.18B'
 * does not match $3,179,794,477.66; it also omits the print route and
 * generated documents from its designated files."
 *
 * Two fixes over round 1:
 *   1. ROUNDING-EQUIVALENCE comparison, not exact equality. A compact literal
 *      ("$3.18B", "$3,179,794,478", "44,000") is compared against each live
 *      total by rounding the total to the SAME precision the literal was
 *      written at (same decimal places within its scale, or the same
 *      trailing-zero granularity for a bare integer) — a "renders-to" check,
 *      not `===`.
 *   2. The designated set now includes the print route
 *      (app/print/investment/[area]/page.tsx) and the generated-doc outputs
 *      (README.md/REFRESH.md's GENERATED blocks). Those two ARE expected to
 *      legitimately state real totals (they're generator output, not
 *      hand-typed) — each such occurrence is allowlisted individually, by
 *      exact file+value, with a comment pointing at the generator that owns
 *      it, so the allowlist stays a reviewed inventory, not a blanket
 *      exemption.
 *
 * PR1 touches no UI copy, so the UI/print files are still expected to carry
 * PR2-pending STALE numbers — those don't round-trip to TODAY's live totals
 * and so don't trip this gate. The gate is a forward-looking guard against a
 * number (exact or rounded) that matches a live total today but isn't wired
 * to meta, which will silently go stale on the next regeneration.
 */
describe("no hand-typed Community Investment totals — UI/print/docs (Sol gate finding 5)", () => {
  const DESIGNATED_CONSUMER_FILES = [
    "components/investment/StatusCards.tsx",
    "components/investment/Methodology.tsx",
    "components/investment/EquityContext.tsx",
    "components/investment/YearBars.tsx",
    "app/investment/page.tsx",
    "app/print/investment/[area]/page.tsx",
    "data/curated/investment-inputs/README.md",
    "data/curated/investment-inputs/REFRESH.md",
  ].filter((f) => existsSync(join(process.cwd(), f)));

  // Narrow, explicit allowlist: (file, exact matched literal VALUE) pairs that
  // are KNOWN, reviewed, non-hand-typed occurrences — generator output
  // (README.md/REFRESH.md's GENERATED blocks, sourced from
  // foundation_audit_fresh.json / manifest.json by scripts/generate-investment-docs.ts,
  // never hand-edited — see the clean-diff gate in
  // investment-docs-clean-diff.test.ts) or an unrelated UI constant that
  // happens to render-to a live total. Add an entry ONLY with a comment
  // explaining why it is safe.
  const ALLOWLIST = new Set<string>([]);

  interface FoundLiteral {
    value: number;
    scale: number;
    mantissaDecimalPlaces: number;
    trailingZeros: number;
  }

  function findLiterals(text: string): FoundLiteral[] {
    const found: FoundLiteral[] = [];
    // $<number>[,<number>]*[.<decimals>]? optionally followed by a magnitude
    // word/suffix ("$7 billion", "$3.18B", "$3,179,794,477.66").
    const currencyRe = /\$\s*([\d,]+(?:\.(\d+))?)\s*(billion|million|thousand|B|M|K)?\b/gi;
    let m: RegExpExecArray | null;
    while ((m = currencyRe.exec(text))) {
      const mantissaText = m[1].replace(/,/g, "");
      const raw = Number(mantissaText);
      if (!Number.isFinite(raw)) continue;
      const suffix = (m[3] || "").toLowerCase();
      const scale =
        suffix === "billion" || suffix === "b"
          ? 1e9
          : suffix === "million" || suffix === "m"
            ? 1e6
            : suffix === "thousand" || suffix === "k"
              ? 1e3
              : 1;
      const decimalDigits = m[2] ?? "";
      found.push({
        value: raw * scale,
        scale,
        mantissaDecimalPlaces: decimalDigits.length,
        trailingZeros: decimalDigits.length === 0 ? trailingZeroCount(mantissaText) : 0,
      });
    }
    // Bare large comma-grouped integers (record counts): 44,061 / 44,000 / etc.
    // Deliberately NOT matched by currencyRe above (no leading "$"). The
    // FIRST lookbehind (?<![\d,]) is load-bearing, not cosmetic: without it,
    // a single-leading-digit dollar figure like "$4,425,000" (where \d{2,3}
    // cannot start on the lone leading "4") lets the regex start mid-number
    // at "425,000" instead, producing a false bare-integer match with a
    // fabricated value — exactly the bug that shipped in round 1 of this test.
    const countRe = /(?<![\d,])(?<!\$\s{0,3})\b(\d{2,3}(?:,\d{3})+)\b/g;
    while ((m = countRe.exec(text))) {
      const digits = m[1].replace(/,/g, "");
      const raw = Number(digits);
      if (!Number.isFinite(raw)) continue;
      found.push({ value: raw, scale: 1, mantissaDecimalPlaces: 0, trailingZeros: trailingZeroCount(digits) });
    }
    return found;
  }

  function trailingZeroCount(digits: string): number {
    const match = digits.match(/0+$/);
    return match ? match[0].length : 0;
  }

  /**
   * True when `total` ROUNDS TO the literal at the literal's own written
   * precision — not exact equality. A literal WITH a decimal component (or a
   * magnitude suffix) is compared by rounding `total` (scaled) to the same
   * number of decimal places. A bare integer is compared by rounding `total`
   * to the same trailing-zero granularity, capped at 1,000 (3 trailing
   * zeros) — conservative on purpose: Sol's concrete example ("$3.18B") is a
   * currency/decimal case, and an uncapped bare-integer granularity (e.g.
   * rounding to the nearest million) risks a coincidental false positive
   * against an unrelated round number already present in a designated file.
   */
  function rendersToProtectedTotal(lit: FoundLiteral, total: number): boolean {
    if (lit.scale !== 1 || lit.mantissaDecimalPlaces > 0) {
      const scaledTotal = total / lit.scale;
      const rounded = Number(scaledTotal.toFixed(lit.mantissaDecimalPlaces));
      return Math.abs(rounded - lit.value / lit.scale) < 1e-9;
    }
    const granularity = Math.pow(10, Math.min(lit.trailingZeros, 3));
    const roundedTotal = Math.round(total / granularity) * granularity;
    return roundedTotal === lit.value;
  }

  it("no designated UI/print/doc file contains a literal that RENDERS TO a live meta/bridge/dedupe total (rounding-equivalence, not exact)", () => {
    const data = loadCommunityInvestment()!;
    const meta = data.meta;
    // Every headline the audit/consult explicitly named, plus bridge + dedupe
    // claims — the exact set finding 5 called out as escaping the old scan.
    const liveTotals = [
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
    ].filter((n): n is number => typeof n === "number" && n !== 0);

    const violations: string[] = [];
    for (const file of DESIGNATED_CONSUMER_FILES) {
      const text = readFileSync(join(process.cwd(), file), "utf8");
      const literals = findLiterals(text);
      for (const lit of literals) {
        const matchedTotal = liveTotals.find((total) => rendersToProtectedTotal(lit, total));
        if (matchedTotal == null) continue;
        const key = `${file}:${lit.value}`;
        if (ALLOWLIST.has(key)) continue;
        violations.push(`${key} (renders-to live total ${matchedTotal})`);
      }
    }
    expect(
      violations,
      violations.length
        ? `Found literals in designated files that render-to a live total (add to ALLOWLIST only with a reviewed reason, or wire the file to meta instead):\n${violations.join("\n")}`
        : "",
    ).toEqual([]);
  });

  it("rendersToProtectedTotal itself: '$3.18B' renders-to $3,179,794,477.66; '$3.17B' and unrelated numbers do not", () => {
    const total = 3179794477.66;
    expect(rendersToProtectedTotal({ value: 3.18e9, scale: 1e9, mantissaDecimalPlaces: 2, trailingZeros: 0 }, total)).toBe(true);
    expect(rendersToProtectedTotal({ value: 3.17e9, scale: 1e9, mantissaDecimalPlaces: 2, trailingZeros: 0 }, total)).toBe(false);
    expect(rendersToProtectedTotal({ value: 7e9, scale: 1e9, mantissaDecimalPlaces: 0, trailingZeros: 0 }, total)).toBe(false);
    // A whole-dollar rounding of the exact total.
    expect(rendersToProtectedTotal({ value: 3179794478, scale: 1, mantissaDecimalPlaces: 0, trailingZeros: 0 }, total)).toBe(true);
  });
});
