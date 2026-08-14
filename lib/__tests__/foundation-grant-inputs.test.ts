import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countBySource, loadCommunityInvestment } from "../community-investment";
import {
  assertDisjointFoundationFunders,
  isPlaceholderFoundationRow,
  mapFoundations,
  mergeFoundationStats,
  parseDelimited,
} from "../../scripts/export-community-investment";

/**
 * The private-foundation block of the Community Investment export is now built
 * from THREE input files that share one schema and one mapper:
 *
 *   foundation_grants_geocoded.csv          — the original 11-funder 990-PF parse
 *   foundation_grants_tier1_expansion.csv   — the Tier-1 expansion (20 more funders)
 *   foundation_grants_phase2_expansion.csv  — the Phase-2 expansion to the 80%
 *                                             capacity-coverage bar
 *
 * Splitting an input across files creates two failure modes that no downstream
 * assertion would attribute to their cause, so both are tested here directly:
 *
 *   1. DOUBLE COUNT — the same funder appearing in two parses would silently
 *      inflate the awarded headline by that funder's whole grant list.
 *   2. UNAPPLIED GUARD — a later file bypassing the placeholder rejection
 *      would let a grant-SCHEDULE aggregate ("SEE ATTACHED DETAIL", tens of
 *      millions in one row) enter the export as a single real award.
 */

const INPUT_DIR = path.join(process.cwd(), "data", "curated", "investment-inputs");
const BASE_FILE = "foundation_grants_geocoded.csv";
const TIER1_FILE = "foundation_grants_tier1_expansion.csv";
const PHASE2_FILE = "foundation_grants_phase2_expansion.csv";
const PHASE3_FILE = "foundation_grants_phase3_expansion.csv";
const QUARANTINE_FILE = "foundation_grants_tier1_quarantined_DO_NOT_EXPORT.csv";
const PHASE2_QUARANTINE_FILE = "foundation_grants_phase2_quarantined_DO_NOT_EXPORT.csv";
const PHASE3_QUARANTINE_FILE = "foundation_grants_phase3_quarantined_DO_NOT_EXPORT.csv";
const PRIZE_FILE = "chicago_prize.csv";

function readInput(file: string): Record<string, string>[] {
  return parseDelimited(readFileSync(path.join(INPUT_DIR, file), "utf8"), ",");
}

const baseRows = readInput(BASE_FILE);
const tier1Rows = readInput(TIER1_FILE);
const phase2Rows = readInput(PHASE2_FILE);
const phase3Rows = readInput(PHASE3_FILE);

const funderNames = (rows: Record<string, string>[]) =>
  new Set(rows.map((r) => (r.foundation || "").trim()).filter(Boolean));

describe("foundation grant inputs — three files, one mapper", () => {
  it("all three files carry the SAME 13-column schema, so one mapper can read them all", () => {
    const columns = (rows: Record<string, string>[]) => Object.keys(rows[0]);
    const expected = [
      "foundation",
      "tax_year",
      "recipient",
      "address_line1",
      "city",
      "state",
      "zip",
      "amount",
      "purpose",
      "source_form",
      "lat",
      "lng",
      "locType",
    ];
    expect(columns(baseRows)).toEqual(expected);
    expect(columns(tier1Rows)).toEqual(expected);
    expect(columns(phase2Rows)).toEqual(expected);
    expect(columns(phase3Rows)).toEqual(expected);
  });

  it("the committed files have PAIRWISE DISJOINT funder-name sets (no double count)", () => {
    const inputs = [
      { file: BASE_FILE, rows: baseRows },
      { file: TIER1_FILE, rows: tier1Rows },
      { file: PHASE2_FILE, rows: phase2Rows },
      { file: PHASE3_FILE, rows: phase3Rows },
    ];
    for (const input of inputs) {
      expect(funderNames(input.rows).size).toBeGreaterThan(0);
    }
    // The export asserts every pair itself, so the guard runs on every regen.
    for (let i = 0; i < inputs.length; i++) {
      for (let j = i + 1; j < inputs.length; j++) {
        const a = funderNames(inputs[i].rows);
        const shared = [...funderNames(inputs[j].rows)].filter((name) => a.has(name));
        expect(shared).toEqual([]);
        expect(() => assertDisjointFoundationFunders(inputs[i], inputs[j])).not.toThrow();
      }
    }
  });

  it("the disjointness guard FAILS LOUDLY on an overlap, naming the funder", () => {
    const overlap = [{ foundation: " joyce foundation " }]; // case/whitespace insensitive
    expect(() =>
      assertDisjointFoundationFunders(
        { file: BASE_FILE, rows: [{ foundation: "Joyce Foundation" }] },
        { file: TIER1_FILE, rows: overlap },
      ),
    ).toThrow(/joyce foundation/i);
  });

  it("keeps the four DIFFERENT Pritzker filers apart — a shared surname is not a collision", () => {
    // Four distinct EINs. Normalizing a surname into a match would DELETE real
    // grants; these names stay exactly as their CSVs have them.
    expect(() =>
      assertDisjointFoundationFunders(
        { file: BASE_FILE, rows: [{ foundation: "Pritzker Traubert Foundation" }] },
        {
          file: TIER1_FILE,
          rows: [
            { foundation: "Pritzker Family Foundation" },
            { foundation: "Pritzker Foundation" },
            { foundation: "Anthony Pritzker Fam Foundation" },
          ],
        },
      ),
    ).not.toThrow();
  });

  it("APPLIES the placeholder guard to the tier-1 file — it rejects zero rows there, but it still rejects", () => {
    // Zero is the expected count for a reconciliation-gated file. It is only
    // meaningful alongside proof that the guard is live rather than vacuous, so
    // both halves are asserted together.
    expect(tier1Rows.filter(isPlaceholderFoundationRow)).toEqual([]);
    expect(mapFoundations(tier1Rows, "foundation-t1").stats.droppedPlaceholder).toBe(0);

    // The same guard, on the same file's schema, still rejects every placeholder
    // shape: the quarantined rows are exactly what it exists to stop.
    const quarantined = readInput(QUARANTINE_FILE);
    expect(quarantined.length).toBeGreaterThan(0);
    for (const row of quarantined) {
      expect(isPlaceholderFoundationRow(row)).toBe(true);
    }
    const { records, stats } = mapFoundations(quarantined, "foundation-t1");
    expect(records).toEqual([]);
    expect(stats.droppedPlaceholder).toBe(quarantined.length);
  });

  it("NEVER reads either quarantine file: none of their rows reach the export", () => {
    const data = loadCommunityInvestment();
    if (!data) return; // export not generated yet
    // A bare amount would false-positive against an unrelated grant of the same
    // size — and a funder really does repeat the same grant to the same
    // recipient across years (RRF's held FY2023 vs its published FY2024) — so
    // quarantined rows are keyed by funder|recipient|amount|YEAR.
    const quarantinedKeys = new Set(
      [...readInput(QUARANTINE_FILE), ...readInput(PHASE2_QUARANTINE_FILE), ...readInput(PHASE3_QUARANTINE_FILE)].map(
        (r) =>
          `${(r.foundation || "").trim()}|${(r.recipient || "").trim()}|${Number(r.amount)}|${(r.tax_year || "").trim()}`,
      ),
    );
    expect(quarantinedKeys.size).toBeGreaterThan(0);
    for (const record of data.records) {
      if (record.source !== "foundation") continue;
      const key = `${record.funderName}|${record.recipient}|${record.amountAwarded ?? Number.NaN}|${record.year ?? ""}`;
      expect(quarantinedKeys.has(key)).toBe(false);
      expect(record.recipient).not.toMatch(/see attached|see statement/i);
    }
  }, 30_000);

  it("APPLIES the placeholder guard to the phase-2 file, and its quarantine explains every row", () => {
    // Same shape as the tier-1 assertion: zero placeholders in the publishable
    // file, proven alongside a live guard rather than left vacuous.
    expect(phase2Rows.filter(isPlaceholderFoundationRow)).toEqual([]);
    expect(mapFoundations(phase2Rows, "foundation-p2").stats.droppedPlaceholder).toBe(0);
    expect(phase3Rows.filter(isPlaceholderFoundationRow)).toEqual([]);
    expect(mapFoundations(phase3Rows, "foundation-p3").stats.droppedPlaceholder).toBe(0);

    // Phase-2 quarantine holds TWO shapes: attachment-aggregate placeholders,
    // and whole filings the reconciliation or review pass refused. Either way a
    // row must say why it is there, and placeholder-shaped rows must still be
    // exactly what the guard rejects. The length assertion is what keeps this
    // loop from passing VACUOUSLY on an empty file.
    const quarantined = readInput(PHASE2_QUARANTINE_FILE);
    expect(quarantined.length).toBeGreaterThan(0);
    expect(quarantined.some(isPlaceholderFoundationRow)).toBe(true);
    for (const row of quarantined) {
      expect((row.exclusion_reason || "").length).toBeGreaterThan(0);
      if (isPlaceholderFoundationRow(row)) {
        expect(mapFoundations([row], "foundation-p2").records).toEqual([]);
      } else {
        expect(row.exclusion_reason).toMatch(/filing_not_publishable|review_excluded/);
      }
    }
  });

  it("phase-3 quarantine is non-empty and every row states its reason", () => {
    const quarantined = readInput(PHASE3_QUARANTINE_FILE);
    expect(quarantined.length).toBeGreaterThan(0);
    for (const row of quarantined) {
      expect((row.exclusion_reason || "").length).toBeGreaterThan(0);
      if (isPlaceholderFoundationRow(row)) {
        expect(mapFoundations([row], "foundation-p3").records).toEqual([]);
      } else {
        expect(row.exclusion_reason).toMatch(/filing_not_publishable|review_excluded/);
      }
    }
  });

  it("rejects the unitemized-RECIPIENT family, but only where the GRANTEE should be", () => {
    // The three shapes that shipped as sited grants before the guard learned
    // them: Field's individuals pool and contributions bucket, Grand Victoria's
    // miscellaneous bucket.
    for (const recipient of [
      "10 INDIVIDUALS - DETAILS UPON REQUEST",
      "Matching Gifts - Details Available upon request",
      "MISCELLANEOUS GRANTS",
      "OTHER CONTRIBUTIONS",
    ]) {
      expect(isPlaceholderFoundationRow({ recipient, address_line1: "123 W Real St", zip: "60601" })).toBe(true);
    }
    // In the ADDRESS field the same phrase means a real named grantee whose
    // street address is withheld — an honest citywide row, never a placeholder.
    expect(
      isPlaceholderFoundationRow({
        recipient: "ART INSTITUTE OF CHICAGO",
        address_line1: "AVAILABLE UPON REQUEST",
        zip: "60603",
      }),
    ).toBe(false);
    // The bare aggregate nouns must be the WHOLE recipient — a real org whose
    // name contains the word is untouched.
    expect(
      isPlaceholderFoundationRow({ recipient: "Other Voices Theater", address_line1: "1 N Main St", zip: "60601" }),
    ).toBe(false);
  });

  it("routes phase-2 rows through the SAME mapper contract as the earlier files", () => {
    const { records } = mapFoundations(phase2Rows, "foundation-p2");
    expect(records.length).toBe(phase2Rows.length);
    for (const [i, record] of records.entries()) {
      const row = phase2Rows[i];
      expect(record.source).toBe("foundation");
      expect(record.funderType).toBe("philanthropic");
      expect(record.capitalClass).toBe("grant");
      expect(record.funderName).toBe(row.foundation);
      if (row.locType === "intermediary_or_citywide") {
        expect(record.geometry).toEqual({ kind: "citywide" });
      }
    }
    expect(records[0].id).toBe("foundation-p2-0");
  });

  it("routes tier-1 rows through the SAME locType/citywide handling as the base file", () => {
    const { records } = mapFoundations(tier1Rows, "foundation-t1");
    expect(records.length).toBe(tier1Rows.length); // nothing dropped
    let sited = 0;
    for (const [i, record] of records.entries()) {
      const row = tier1Rows[i];
      expect(record.source).toBe("foundation");
      expect(record.funderType).toBe("philanthropic");
      expect(record.capitalClass).toBe("grant");
      // Funder names travel through VERBATIM — no normalization, no merging.
      expect(record.funderName).toBe(row.foundation);
      if (row.locType === "intermediary_or_citywide") {
        expect(record.geometry).toEqual({ kind: "citywide" });
      } else if (record.geometry.kind === "point") {
        sited++;
      }
    }
    expect(sited).toBeGreaterThan(0);
    // Ids live in their own namespace so the base file's published ids are
    // neither collided with nor renumbered.
    expect(records[0].id).toBe("foundation-t1-0");
  });

  it("nulls a negative (return-of-grant) amount in tier-1 exactly as in the base file", () => {
    const { records, stats } = mapFoundations(tier1Rows, "foundation-t1");
    const negatives = tier1Rows.filter((r) => Number(r.amount) < 0);
    expect(negatives.length).toBeGreaterThan(0); // the file really does carry corrections
    expect(stats.negativeAmountsNulled).toBe(negatives.length);
    for (const record of records) {
      if (record.amountAwarded != null) expect(record.amountAwarded).toBeGreaterThanOrEqual(0);
    }
  });

  it("mergeFoundationStats sums BOTH files' tallies, so meta never under-reports drops", () => {
    const a = {
      citywideFallback: 1,
      droppedPlaceholder: 3,
      droppedPlaceholderDollars: 30000,
      outOfBoundsGeocodes: 3,
      negativeAmountsNulled: 1,
      dedupeCollapsed: 2,
      dedupeCollapsedDollars: 20000,
      identityResolved: 5,
      identityUnresolved: 1,
    };
    const b = {
      citywideFallback: 0,
      droppedPlaceholder: 0,
      droppedPlaceholderDollars: 0,
      outOfBoundsGeocodes: 0,
      negativeAmountsNulled: 3,
      dedupeCollapsed: 0,
      dedupeCollapsedDollars: 0,
      identityResolved: 2,
      identityUnresolved: 0,
    };
    expect(mergeFoundationStats(a, b)).toEqual({
      citywideFallback: 1,
      droppedPlaceholder: 3,
      droppedPlaceholderDollars: 30000,
      outOfBoundsGeocodes: 3,
      negativeAmountsNulled: 4,
      dedupeCollapsed: 2,
      dedupeCollapsedDollars: 20000,
      identityResolved: 7,
      identityUnresolved: 1,
    });
  });
});

const EXPORT_PATH = path.join(process.cwd(), "data/private/community-investment.json");

describe.skipIf(!existsSync(EXPORT_PATH))("committed export — foundation block", () => {
  /**
   * A cross-file PARTITION rather than a pinned count, following the HUD-bbox
   * precedent in community-investment.test.ts: it reconciles the export against
   * the inputs that produced it, so a legitimate data refresh moves both sides
   * together while a parser that eats rows — or a second file silently not being
   * read at all — trips it.
   */
  it("PARTITIONS all foundation inputs plus Chicago Prize against the mapped records", () => {
    const data = loadCommunityInvestment()!;
    const mapped = countBySource(data.records)["foundation"] ?? 0;
    const prizeRows = readInput(PRIZE_FILE).length;

    expect(mapped + data.meta.droppedPlaceholder).toBe(
      baseRows.length + tier1Rows.length + phase2Rows.length + phase3Rows.length + prizeRows,
    );
    // Every file is genuinely present — the identity above would also hold if
    // one of the expansion files were empty.
    expect(tier1Rows.length).toBeGreaterThan(0);
    expect(phase2Rows.length).toBeGreaterThan(0);
    expect(data.records.some((r) => r.id.startsWith("foundation-t1-"))).toBe(true);
    expect(data.records.some((r) => r.id.startsWith("foundation-p2-"))).toBe(true);
  }, 30_000);

  it("carries every funder from BOTH files, minus the one whose 990 rows are ALL placeholders", () => {
    const data = loadCommunityInvestment()!;
    const inExport = new Set(
      data.records.filter((r) => r.source === "foundation").map((r) => r.funderName),
    );

    // Pritzker Traubert is the single documented exception, and it is the guard
    // working rather than data loss: all three of its 990 rows are "SEE ATTACHED"
    // schedule aggregates (2022–2024, $151M combined) with no itemization, so
    // every one is rejected. Its real grants reach the export through the curated
    // chicago_prize.csv instead, under the distinct Chicago Prize funder label.
    const placeholderOnlyFunders = new Set(["Pritzker Traubert Foundation"]);
    for (const name of placeholderOnlyFunders) {
      const rows = baseRows.filter((r) => (r.foundation || "").trim() === name);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(isPlaceholderFoundationRow)).toBe(true);
      expect(inExport.has(name)).toBe(false);
    }

    for (const name of [
      ...funderNames(baseRows),
      ...funderNames(tier1Rows),
      ...funderNames(phase2Rows),
      ...funderNames(phase3Rows),
    ]) {
      if (placeholderOnlyFunders.has(name)) continue;
      expect(inExport.has(name)).toBe(true);
    }

    // The only name in the export that comes from none of the grant files is
    // the Chicago Prize label, which is its own curated input.
    const extras = [...inExport].filter(
      (name) =>
        !funderNames(baseRows).has(name) &&
        !funderNames(tier1Rows).has(name) &&
        !funderNames(phase2Rows).has(name) &&
        !funderNames(phase3Rows).has(name),
    );
    expect(extras).toEqual(["Pritzker Traubert Foundation — Chicago Prize"]);
  }, 30_000);

  it("record ids stay unique across the three foundation namespaces", () => {
    const data = loadCommunityInvestment()!;
    const ids = data.records.filter((r) => r.source === "foundation").map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 30_000);
});
