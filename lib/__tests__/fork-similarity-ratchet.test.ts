/**
 * Fork duplication ratchet: the two report renderers may only converge.
 *
 * lib/__tests__/fork-parity-guard.test.ts fences ONE already-unified slice
 * (drawn-area rendering, generic report actions). This test covers the
 * rest: the raw volume of byte-identical markup still pasted between
 * app/report/page.tsx's local `ReportDisplay` and
 * components/report/ReportDisplay.tsx. See
 * lib/source-guard/fork-similarity-ratchet.ts for the counting
 * methodology, which is fixed — changing it invalidates the baseline
 * below.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeRatchetStatus,
  measureForkSimilarity,
  MIN_BLOCK_LINES,
  MIN_LINE_LENGTH,
  RATCHET_FORK_FILE_PATHS,
} from "../source-guard/fork-similarity-ratchet";

const ROOT_DIR = path.resolve(__dirname, "../..");

/**
 * Duplicated lines shared by the two fork files, measured 2026-09-01 on this
 * branch (R3 fork stabilization): 1,383 lines across 30 contiguous blocks,
 * largest 244. The pre-R3 audit reported ~1,282 / 22 / 239 with the same
 * methodology on an older tree.
 *
 * Honest note on why R3 raised the number it introduced: R3 was asked to
 * bring the workspace fork's analytics up to the live fork's — mirroring
 * report_pdf_downloaded, share_link_copied and program_link_clicked, and
 * aligning trackSectionLinkClick — so the funnel stops depending on which
 * renderer the user is on. Making two forks BEHAVE the same by hand makes
 * them look more identical, which is precisely the debt this ratchet
 * measures. That is the ratchet working as intended: it records the cost of
 * fixing drift by mirroring instead of by sharing, and the only way the
 * number comes down is the real merge (a future dedicated round).
 *
 * THIS NUMBER MAY ONLY GO DOWN from here. Unify a block, watch the number
 * drop, and lower this constant in the same commit with a dated note of your
 * own. RAISING it means a paste-back landed and requires an explicit owner
 * ruling recorded here — it is not a way to get a red test green.
 */
const FORK_DUPLICATION_BASELINE = 1383;

describe("fork duplication ratchet: app/report/page.tsx vs components/report/ReportDisplay.tsx", () => {
  const report = measureForkSimilarity(ROOT_DIR);

  it("does not exceed the committed baseline, and says so when it drops", () => {
    const status = describeRatchetStatus(report, FORK_DUPLICATION_BASELINE);
    if (report.duplicatedLineCount !== FORK_DUPLICATION_BASELINE) {
      throw new Error(status);
    }
    expect(report.duplicatedLineCount).toBe(FORK_DUPLICATION_BASELINE);
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

  it("still finds real, substantial blocks (sanity: the scanner has not silently stopped matching)", () => {
    expect(report.blocks.length).toBeGreaterThan(5);
    expect(Math.max(...report.blocks.map((block) => block.lineCount))).toBeGreaterThan(
      MIN_BLOCK_LINES,
    );
    // Every counted block must contain at least one substantial line —
    // a run of bare closing braces is structure, not duplication.
    for (const block of report.blocks) {
      expect(block.preview.length).toBeGreaterThan(MIN_LINE_LENGTH);
    }
  });

  it("counts no source line twice (blocks claimed longest-first never overlap)", () => {
    const seenA = new Set<number>();
    const seenB = new Set<number>();
    for (const block of report.blocks) {
      for (let offset = 0; offset < block.lineCount; offset++) {
        expect(seenA.has(block.startLineA + offset)).toBe(false);
        expect(seenB.has(block.startLineB + offset)).toBe(false);
        seenA.add(block.startLineA + offset);
        seenB.add(block.startLineB + offset);
      }
    }
    expect(seenA.size).toBe(report.duplicatedLineCount);
  });

  it("reports both forks by their real paths", () => {
    expect([report.filePathA, report.filePathB]).toEqual([...RATCHET_FORK_FILE_PATHS]);
  });

  it("tells a contributor to LOWER the baseline when duplication drops", () => {
    const status = describeRatchetStatus(report, FORK_DUPLICATION_BASELINE + 50);
    expect(status).toContain("DECREASED");
    expect(status).toContain(`Set FORK_DUPLICATION_BASELINE to ${report.duplicatedLineCount}`);
  });

  it("tells a contributor to share the block — not raise the baseline — when duplication grows", () => {
    const status = describeRatchetStatus(report, FORK_DUPLICATION_BASELINE - 50);
    expect(status).toContain("INCREASED");
    expect(status).toContain("requires an owner ruling");
  });
});
