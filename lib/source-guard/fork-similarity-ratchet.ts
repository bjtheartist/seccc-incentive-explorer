/**
 * lib/source-guard/fork-similarity-ratchet.ts — the fork-duplication
 * ratchet.
 *
 * Companion to lib/source-guard/fork-parity.ts. That guard is a
 * RECURRENCE guard on one already-unified slice (drawn-area rendering,
 * generic report actions): it asserts a specific concern stays shared.
 * It says nothing about the bulk of the two report renderers, which are
 * still two hand-maintained forks — app/report/page.tsx's local
 * `ReportDisplay` and components/report/ReportDisplay.tsx — carrying over
 * a thousand lines of byte-identical JSX between them.
 *
 * This module measures that bulk, so the debt can only shrink. It counts
 * the lines the two fork files share as contiguous identical blocks, and
 * the paired test fails when the count EXCEEDS a committed baseline. Unify
 * a block and the number drops; the test then tells you to lower the
 * baseline in the same commit. Paste a block back and the number rises and
 * the test fails immediately.
 *
 * Deliberately a line-level measurement, not an AST one: the failure mode
 * being ratcheted is literal copy-paste between two `.tsx` files, and a
 * line count is the metric a reviewer can reproduce with `diff` by hand.
 *
 * ── Methodology (fixed; changing it invalidates the baseline) ──────────
 * 1. Each line is whitespace-normalized (trimmed, internal runs collapsed)
 *    so a re-indented paste still matches.
 * 2. Only SUBSTANTIAL lines — normalized length > `MIN_LINE_LENGTH` — can
 *    anchor a match. Short lines (`}`, `)}`, `<div>`, `import ...`) recur
 *    by the hundreds in any two React files and would manufacture matches
 *    out of ordinary structure. They still participate INSIDE a block (a
 *    pasted JSX block legitimately contains closing braces), but a block
 *    made only of them is not evidence of duplication and is discarded.
 * 3. A block is a maximal run of consecutive lines appearing identically,
 *    and consecutively, in both files, at least `MIN_BLOCK_LINES` long.
 * 4. Blocks are claimed greedily longest-first, and no source line is
 *    counted twice, so the total is a straight "how many of this file's
 *    lines live in a duplicated block" figure.
 */
import { readFileSync } from "node:fs";

/** The two report-renderer forks whose duplication this ratchet measures. */
export const RATCHET_FORK_FILE_PATHS = [
  "app/report/page.tsx",
  "components/report/ReportDisplay.tsx",
] as const;

/**
 * Shortest run of identical lines that counts as a duplicated block.
 * Below this, matches are structural coincidence rather than paste.
 */
export const MIN_BLOCK_LINES = 8;

/**
 * A normalized line must exceed this to anchor a block. Matches the
 * ≥30-char instinct behind fork-parity.ts's `MIN_SIGNATURE_LENGTH`, set
 * higher here because this scanner reads WHOLE LINES (a line carries its
 * JSX tag and attributes, not just the string literal inside it).
 */
export const MIN_LINE_LENGTH = 40;

export interface DuplicatedBlock {
  /** 1-based first line of the block in the first fork file. */
  startLineA: number;
  /** 1-based first line of the block in the second fork file. */
  startLineB: number;
  lineCount: number;
  /** First substantial line of the block, for a readable failure message. */
  preview: string;
}

export interface ForkSimilarityReport {
  filePathA: string;
  filePathB: string;
  blocks: DuplicatedBlock[];
  /** Total lines living inside a counted block. THE ratcheted number. */
  duplicatedLineCount: number;
}

/** Trim and collapse internal whitespace so re-indentation still matches. */
function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

/**
 * Contiguous identical-line blocks between two line arrays.
 *
 * Standard longest-common-substring dynamic programming over lines, with
 * the row kept as a rolling pair of typed arrays — the full matrix for
 * these two files would be ~10M cells, the two rows are ~2K.
 */
function findDuplicatedBlocks(linesA: string[], linesB: string[]): DuplicatedBlock[] {
  const normA = linesA.map(normalizeLine);
  const normB = linesB.map(normalizeLine);

  // Interning the normalized lines to integers turns the inner comparison
  // into a number compare, which is what keeps this scan well under a
  // second on a 5,700-line file.
  const ids = new Map<string, number>();
  const idsA = new Int32Array(normA.length);
  const idsB = new Int32Array(normB.length);
  for (let i = 0; i < normA.length; i++) {
    let id = ids.get(normA[i]);
    if (id === undefined) {
      id = ids.size;
      ids.set(normA[i], id);
    }
    idsA[i] = id;
  }
  for (let j = 0; j < normB.length; j++) {
    // A line absent from A can never match; -1 keeps it out of every run.
    idsB[j] = ids.get(normB[j]) ?? -1;
  }

  const candidates: DuplicatedBlock[] = [];
  let previous = new Int32Array(normB.length + 1);
  let current = new Int32Array(normB.length + 1);

  for (let i = 0; i < normA.length; i++) {
    current.fill(0);
    for (let j = 0; j < normB.length; j++) {
      if (idsA[i] !== idsB[j]) continue;
      const runLength = previous[j] + 1;
      current[j + 1] = runLength;
      // A run is recorded only where it ENDS — i.e. where the next pair of
      // lines no longer continues it. Recording every prefix instead would
      // emit one candidate per line of every block.
      const continues =
        i + 1 < normA.length && j + 1 < normB.length && idsA[i + 1] === idsB[j + 1];
      if (!continues && runLength >= MIN_BLOCK_LINES) {
        const startA = i - runLength + 1;
        const startB = j - runLength + 1;
        const substantial = normA
          .slice(startA, i + 1)
          .find((line) => line.length > MIN_LINE_LENGTH);
        // Methodology step 2: a run of nothing but short structural lines
        // is not evidence of a pasted block.
        if (substantial) {
          candidates.push({
            startLineA: startA + 1,
            startLineB: startB + 1,
            lineCount: runLength,
            preview: substantial.slice(0, 80),
          });
        }
      }
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  // Claim longest-first so an overlapping shorter match never double-counts
  // a line that a longer block already owns. Ties break on position, which
  // is what makes the total deterministic rather than sort-order dependent.
  candidates.sort(
    (a, b) =>
      b.lineCount - a.lineCount || a.startLineA - b.startLineA || a.startLineB - b.startLineB,
  );

  const claimedA = new Uint8Array(normA.length);
  const claimedB = new Uint8Array(normB.length);
  const blocks: DuplicatedBlock[] = [];
  for (const candidate of candidates) {
    const startA = candidate.startLineA - 1;
    const startB = candidate.startLineB - 1;
    let free = true;
    for (let k = 0; k < candidate.lineCount; k++) {
      if (claimedA[startA + k] || claimedB[startB + k]) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    for (let k = 0; k < candidate.lineCount; k++) {
      claimedA[startA + k] = 1;
      claimedB[startB + k] = 1;
    }
    blocks.push(candidate);
  }

  blocks.sort((a, b) => a.startLineA - b.startLineA);
  return blocks;
}

/** Measure fork duplication for one repo checkout. */
export function measureForkSimilarity(rootDir: string): ForkSimilarityReport {
  const [relA, relB] = RATCHET_FORK_FILE_PATHS;
  const filePathA = `${rootDir}/${relA}`;
  const filePathB = `${rootDir}/${relB}`;
  const linesA = readFileSync(filePathA, "utf8").split("\n");
  const linesB = readFileSync(filePathB, "utf8").split("\n");
  const blocks = findDuplicatedBlocks(linesA, linesB);

  return {
    filePathA: relA,
    filePathB: relB,
    blocks,
    duplicatedLineCount: blocks.reduce((total, block) => total + block.lineCount, 0),
  };
}

/**
 * The failure text. Split out from the test so the ratchet's two
 * directions — "you added duplication" and "you removed some, now lower
 * the baseline" — are stated in one place instead of inline in an
 * assertion message.
 */
export function describeRatchetStatus(
  report: ForkSimilarityReport,
  baseline: number,
): string {
  const { duplicatedLineCount: actual, blocks } = report;
  const largest = blocks.reduce((max, block) => Math.max(max, block.lineCount), 0);
  const summary =
    `${actual} duplicated lines across ${blocks.length} contiguous block(s) ` +
    `(largest ${largest}) between ${report.filePathA} and ${report.filePathB}; ` +
    `committed baseline is ${baseline}.`;

  if (actual > baseline) {
    const worst = [...blocks]
      .sort((a, b) => b.lineCount - a.lineCount)
      .slice(0, 3)
      .map(
        (block) =>
          `  ${block.lineCount} lines — ${report.filePathA}:${block.startLineA} / ` +
          `${report.filePathB}:${block.startLineB}\n    ${block.preview}`,
      )
      .join("\n");
    return (
      `Fork duplication INCREASED. ${summary}\n` +
      `Largest blocks:\n${worst}\n` +
      `Move the shared markup into a component both forks import instead of ` +
      `pasting it into each. Raising FORK_DUPLICATION_BASELINE requires an ` +
      `owner ruling — it is not a way to land a paste.`
    );
  }

  if (actual < baseline) {
    return (
      `Fork duplication DECREASED — lower the ratchet. ${summary}\n` +
      `Set FORK_DUPLICATION_BASELINE to ${actual} in this test file, with a ` +
      `dated note, in the same commit that removed the duplication.`
    );
  }

  return `Fork duplication unchanged. ${summary}`;
}
