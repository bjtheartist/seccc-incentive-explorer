/**
 * Fork duplication ratchet: the two report renderers may only converge —
 * and, since 2026-09-03, may not diverge again.
 *
 * lib/__tests__/fork-parity-guard.test.ts fences already-unified slices
 * (drawn-area rendering, generic report actions). This test covered the
 * rest: the raw volume of byte-identical markup pasted between
 * app/report/page.tsx's local `ReportDisplay` and
 * components/report/ReportDisplay.tsx. That local `ReportDisplay` has now
 * been deleted — /report renders the exported component — so the measured
 * number is 0 and the baseline is 0. See
 * lib/source-guard/fork-similarity-ratchet.ts for the counting
 * methodology, which is fixed, and docs/report-renderer-unification.md for
 * the merge itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeRatchetStatus,
  measureForkSimilarity,
  measureForkSimilarityBetween,
  MIN_BLOCK_LINES,
  MIN_LINE_LENGTH,
  normalizeSourceLines,
  RATCHET_FORK_FILE_PATHS,
} from "../source-guard/fork-similarity-ratchet";

const ROOT_DIR = path.resolve(__dirname, "../..");

/**
 * Duplicated lines shared by the two fork files.
 *
 * ── 2026-09-03: 0 lines, 0 blocks. The fork was merged. ───────────────
 * app/report/page.tsx's private `ReportDisplay` (1,936 lines) was deleted
 * and /report now renders components/report/ReportDisplay.tsx with
 * `surface="live"`; everything the two copies did differently is derived
 * from that one prop. The number went 1,275 -> 0 because the duplication
 * was REMOVED, not because the scanner stopped working — which is exactly
 * the distinction #258 built the counter-lock below to enforce, and which
 * the "zero is honest" test now verifies directly against the reason.
 *
 * From here the constant is a RE-FORK guard: paste a block of report markup
 * from the renderer back into app/report/page.tsx and the number rises
 * above 0 and this suite goes red in the same commit.
 *
 * ── History ───────────────────────────────────────────────────────────
 * Measured 2026-09-02, AFTER the metric was hardened: 1,275 significant
 * lines across 22 contiguous blocks, largest 261.
 *
 * ── Why this number moved without the debt moving ─────────────────────
 * The previous baseline, 1,383 / 30 / 244 (measured 2026-09-01), was taken
 * with the raw-line metric, which compared every line including comments
 * and blanks. Review of PR #251 showed that metric could be driven to
 * ZERO by injecting a JSX comment every 7th line into one fork — the noise
 * split every run below `MIN_BLOCK_LINES`, and the ratchet then invited a
 * baseline of 0, retiring the guard while the duplication was untouched.
 * The scanner now deletes comments and blank lines before comparing, so
 * interleaved noise cannot split a run (see the module's methodology note,
 * step 0, and the "survives comment injection" tests below).
 *
 * The drop from 1,383 to 1,275 is therefore a METRIC change, not a debt
 * reduction: the same duplication is now counted in significant lines only
 * (comments and blank lines inside a pasted block no longer add to the
 * total), and adjacent runs formerly separated by a comment now merge into
 * one longer block, which is why the block count fell and the largest
 * block grew. No markup was unified in the commit that moved this number.
 *
 * THIS NUMBER MAY ONLY GO DOWN from here. It is now at the floor. RAISING
 * it means a paste-back landed and requires an explicit owner ruling
 * recorded here — it is not a way to get a red test green.
 */
const FORK_DUPLICATION_BASELINE = 0;

describe("fork duplication ratchet: app/report/page.tsx vs components/report/ReportDisplay.tsx", () => {
  const report = measureForkSimilarity(ROOT_DIR);

  it("fails only when duplication EXCEEDS the committed baseline; a drop asks for a lower baseline instead", () => {
    const status = describeRatchetStatus(report, FORK_DUPLICATION_BASELINE);

    // A one-directional ratchet. An unrelated PR that edits three lines
    // inside a duplicated block makes the number fall, and that must not
    // turn CI red on a change which improved things — it prints the status
    // asking for the baseline to be lowered, and passes.
    if (report.duplicatedLineCount < FORK_DUPLICATION_BASELINE) {
      console.warn(status);
    }

    expect(report.duplicatedLineCount).toBeLessThanOrEqual(FORK_DUPLICATION_BASELINE);
    if (report.duplicatedLineCount > FORK_DUPLICATION_BASELINE) {
      throw new Error(status);
    }
  });

  /**
   * #258's counter-lock, inverted now that zero has actually been reached.
   *
   * The ratchet's one remaining escape was driving the measured number down
   * WITHOUT removing duplication: a metric change, a normalization bug, or a
   * deliberate run-splitting edit would each report zero while 1,275 pasted
   * lines sat untouched. #258 refused zero outright, on the reasoning that
   * "the only honest way to reach zero is to delete or merge a fork file."
   *
   * That is what happened on 2026-09-03. Both PATHS still exist on disk —
   * app/report/page.tsx is still the /report route — so the disk check #258
   * used cannot tell the honest zero from the dishonest one any more. The
   * check that can is the REASON for zero: the second renderer is gone.
   * app/report/page.tsx declares no `ReportDisplay` of its own, and it
   * renders the shared one instead. Both halves matter: without the second,
   * deleting the report body outright would also read as "unified".
   */
  it("zero is honest: the second renderer is gone, and /report renders the shared one", () => {
    const [pagePath, rendererPath] = RATCHET_FORK_FILE_PATHS;
    const page = readFileSync(path.join(ROOT_DIR, pagePath), "utf8");
    const renderer = readFileSync(path.join(ROOT_DIR, rendererPath), "utf8");

    expect(report.duplicatedLineCount).toBe(0);
    expect(report.blocks.length).toBe(0);

    // No second renderer...
    expect(
      /\bfunction ReportDisplay\b/.test(page),
      `${pagePath} declares a ReportDisplay again. The two report renderers ` +
        "were merged deliberately (docs/report-renderer-unification.md); a " +
        "second copy is the exact debt this ratchet exists to keep out. " +
        "Render the shared component with the props your surface needs.",
    ).toBe(false);

    // ...and the route still renders the surviving one, so a zero produced
    // by deleting the report body instead of sharing it fails here.
    expect(page).toContain(
      'import { ReportDisplay } from "@/components/report/ReportDisplay";',
    );
    expect(page).toContain('<ReportDisplay');
    expect(page).toContain('surface="live"');
    expect(renderer).toContain("export function ReportDisplay(");
  });

  it("is fast enough to stay in the default suite (<2s)", () => {
    // Best of three: a single wall-clock sample on a loaded machine measures
    // the scheduler as much as the scan, and a guard that flakes is worse
    // than no guard. Three samples still catch a real algorithmic
    // regression — the scan runs in tens of milliseconds, so nothing that
    // stays under two seconds three times over has quietly gone quadratic.
    const samples = [0, 1, 2].map(() => {
      const startedAt = Date.now();
      measureForkSimilarity(ROOT_DIR);
      return Date.now() - startedAt;
    });
    expect(Math.min(...samples)).toBeLessThan(2000);
  });

  it("is deterministic — the same tree measures the same number", () => {
    expect(measureForkSimilarity(ROOT_DIR).duplicatedLineCount).toBe(
      report.duplicatedLineCount,
    );
  });

  // The scanner's "has it silently stopped matching?" sanity check used to
  // run against the real repo (blocks.length > 5), which only worked while
  // the repo HAD duplication. It moves to a fixture in the second describe
  // below ("still finds real, substantial blocks"), where it proves the same
  // thing — the scanner still finds substantial pasted runs — against input
  // that does not change when the codebase improves. The per-block
  // invariants stay here and hold vacuously at zero, so they turn back on
  // the moment a paste-back reintroduces a block.
  it("every counted block is substantial (a run of bare closing braces is structure, not duplication)", () => {
    for (const block of report.blocks) {
      expect(block.lineCount).toBeGreaterThanOrEqual(MIN_BLOCK_LINES);
      expect(block.preview.length).toBeGreaterThan(MIN_LINE_LENGTH);
    }
  });

  it("counts no source line twice (blocks claimed longest-first never overlap)", () => {
    const forEachFork = [
      report.blocks.map((block) => [block.startLineA, block.endLineA] as const),
      report.blocks.map((block) => [block.startLineB, block.endLineB] as const),
    ];

    for (const ranges of forEachFork) {
      const ordered = [...ranges].sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < ordered.length; i++) {
        // Blocks are claimed on non-overlapping runs of significant lines,
        // and significant lines map to original line numbers in order, so
        // the original line RANGES must not overlap either.
        expect(ordered[i][0]).toBeGreaterThan(ordered[i - 1][1]);
      }
      for (const [start, end] of ranges) {
        expect(end).toBeGreaterThanOrEqual(start);
      }
    }

    expect(report.blocks.reduce((total, block) => total + block.lineCount, 0)).toBe(
      report.duplicatedLineCount,
    );
  });

  it("reports both forks by their real paths", () => {
    expect([report.filePathA, report.filePathB]).toEqual([...RATCHET_FORK_FILE_PATHS]);
  });

  it("tells a contributor to LOWER the baseline when duplication drops", () => {
    const status = describeRatchetStatus(report, FORK_DUPLICATION_BASELINE + 50);
    expect(status).toContain("DECREASED");
    expect(status).toContain(`Set FORK_DUPLICATION_BASELINE to ${report.duplicatedLineCount}`);
    expect(status).toContain("NOT a test failure");
  });

  it("tells a contributor to share the block — not raise the baseline — when duplication grows", () => {
    const status = describeRatchetStatus(report, FORK_DUPLICATION_BASELINE - 50);
    expect(status).toContain("INCREASED");
    expect(status).toContain("requires an owner ruling");
  });
});

/**
 * The hardening proof. PR #251's review showed the raw-line metric fell
 * from 1,383 to 0 when a JSX comment was injected every 7th line — a change
 * that removes no duplication at all. These fixtures reproduce that exact
 * attack against the current scanner and require the number to be
 * UNCHANGED, not merely non-zero.
 */
describe("fork duplication ratchet: the measurement survives interleaved cosmetic noise", () => {
  /**
   * Two files sharing one long, obviously-pasted JSX block. Lines are long
   * enough to clear `MIN_LINE_LENGTH` so the block is substantial, and the
   * run is comfortably longer than `MIN_BLOCK_LINES`.
   */
  const sharedBlock = Array.from(
    { length: 24 },
    (_, index) =>
      `        <p className="text-[11px] text-[#0C1B33]/60">Duplicated narrative row number ${index}</p>`,
  );

  const fixtureA = [
    `export function ForkA() {`,
    `  return (`,
    `    <section>`,
    ...sharedBlock,
    `    </section>`,
    `  );`,
    `}`,
  ].join("\n");

  const fixtureB = [
    `export function ForkB({ variant }: { variant: string }) {`,
    `  return (`,
    `    <section data-variant={variant}>`,
    ...sharedBlock,
    `    </section>`,
    `  );`,
    `}`,
  ].join("\n");

  /** The audit's attack: one cosmetic line inserted after every 7th line. */
  function injectEverySeventhLine(source: string, noise: string): string {
    return source
      .split("\n")
      .flatMap((line, index) => ((index + 1) % 7 === 0 ? [line, noise] : [line]))
      .join("\n");
  }

  const clean = measureForkSimilarityBetween(fixtureA, fixtureB);

  // The real-codebase sanity check, relocated here (see the note in the
  // first describe). It proves the scanner still finds substantial pasted
  // runs — the property that made a zero on the real repo meaningful in the
  // first place — against a fixture that cannot be improved away.
  it("still finds real, substantial blocks (sanity: the scanner has not silently stopped matching)", () => {
    expect(clean.blocks.length).toBeGreaterThan(0);
    expect(Math.max(...clean.blocks.map((block) => block.lineCount))).toBeGreaterThan(
      MIN_BLOCK_LINES,
    );
    for (const block of clean.blocks) {
      expect(block.preview.length).toBeGreaterThan(MIN_LINE_LENGTH);
    }
  });

  it("measures the fixture's pasted block in the first place", () => {
    // One run, covering the pasted block plus the identical wrapper lines
    // on either side of it that the scanner legitimately absorbs.
    expect(clean.blocks.length).toBe(1);
    expect(clean.duplicatedLineCount).toBeGreaterThanOrEqual(sharedBlock.length);
  });

  it.each([
    ["JSX comment", "        {/* cosmetic */}"],
    ["line comment", "        // cosmetic"],
    ["block comment", "        /* cosmetic */"],
    ["blank line", "        "],
  ])(
    "a %s injected every 7th line does not change the duplicated line count",
    (_label, noise) => {
      const attacked = measureForkSimilarityBetween(
        fixtureA,
        injectEverySeventhLine(fixtureB, noise),
      );

      expect(attacked.duplicatedLineCount).toBe(clean.duplicatedLineCount);
      expect(attacked.blocks.length).toBe(clean.blocks.length);
    },
  );

  it("a multi-line JSX comment injected into the block does not split it", () => {
    const noisy = fixtureB.replace(
      sharedBlock[10],
      [`        {/*`, `          cosmetic, spanning`, `          three lines`, `        */}`, sharedBlock[10]].join(
        "\n",
      ),
    );

    const attacked = measureForkSimilarityBetween(fixtureA, noisy);
    expect(attacked.duplicatedLineCount).toBe(clean.duplicatedLineCount);
    expect(attacked.blocks.length).toBe(1);
  });

  it("a trailing comment appended to a line does not stop that line matching", () => {
    const noisy = fixtureB.replace(sharedBlock[3], `${sharedBlock[3]} // cosmetic`);
    const attacked = measureForkSimilarityBetween(fixtureA, noisy);
    expect(attacked.duplicatedLineCount).toBe(clean.duplicatedLineCount);
  });

  it("still counts real pasted markup — noise removal did not blunt the scanner", () => {
    // Removing three lines from the pasted block must lower the number by
    // three. A metric that ignores noise but also ignores real edits would
    // be useless as a ratchet.
    const shortened = fixtureB.replace(
      sharedBlock.slice(0, 3).join("\n") + "\n",
      "",
    );
    const measured = measureForkSimilarityBetween(fixtureA, shortened);
    expect(measured.duplicatedLineCount).toBe(clean.duplicatedLineCount - 3);
  });

  it("normalizeSourceLines drops noise and keeps original line numbers", () => {
    const lines = normalizeSourceLines(
      ["const first = 1;", "", "// a comment", "  {/* jsx */}", "const second = 2;"].join("\n"),
    );

    expect(lines.map((line) => line.text)).toEqual(["const first = 1;", "const second = 2;"]);
    expect(lines.map((line) => line.lineNumber)).toEqual([1, 5]);
  });

  it("does not mistake a comment delimiter inside a string for a comment", () => {
    const lines = normalizeSourceLines(
      [`const url = "https://example.com/path";`, `const text = "not /* a */ comment";`].join("\n"),
    );

    expect(lines.map((line) => line.text)).toEqual([
      `const url = "https://example.com/path";`,
      `const text = "not /* a */ comment";`,
    ]);
  });
});
