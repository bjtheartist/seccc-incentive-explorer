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
 * ── STATUS: THE FORK IS GONE (2026-09-03) ─────────────────────────────
 * The merge landed. app/report/page.tsx's private `ReportDisplay` was
 * deleted; /report renders components/report/ReportDisplay.tsx with
 * `surface="live"`. The measurement is 0 lines across 0 blocks and
 * `FORK_DUPLICATION_BASELINE` is 0.
 *
 * The ratchet is NOT retired, because at 0 it is no longer measuring debt —
 * it is guarding against the debt coming back. Any block of report markup
 * pasted from the renderer into app/report/page.tsx (the exact motion that
 * created the fork) makes the number rise above 0 and turns the paired test
 * red on the spot. It costs ~50ms and needs no maintenance. See
 * docs/report-renderer-unification.md, and the paired test's own note on
 * why "zero" is now verified against the REASON for zero rather than
 * refused outright.
 *
 * Deliberately a line-level measurement, not an AST one: the failure mode
 * being ratcheted is literal copy-paste between two `.tsx` files, and a
 * line count is the metric a reviewer can reproduce with `diff` by hand.
 *
 * ── Methodology (fixed; changing it invalidates the baseline) ──────────
 * 0. NOISE IS REMOVED BEFORE COMPARING (added 2026-09-02 — see the
 *    "hardening" note below). Comments — line, block, and the JSX
 *    brace-wrapped block-comment form — plus blank lines and lines that
 *    are nothing but a comment are deleted from the compared sequence
 *    entirely; the rest are whitespace-normalized. Deleting rather than
 *    blanking is the point: an interleaved comment no longer SPLITS a run,
 *    it disappears from it.
 * 1. Each surviving line is whitespace-normalized (trimmed, internal runs
 *    collapsed) so a re-indented paste still matches.
 * 2. Only SUBSTANTIAL lines — normalized length > `MIN_LINE_LENGTH` — can
 *    anchor a match. Short lines (`}`, `)}`, `<div>`, `import ...`) recur
 *    by the hundreds in any two React files and would manufacture matches
 *    out of ordinary structure. They still participate INSIDE a block (a
 *    pasted JSX block legitimately contains closing braces), but a block
 *    made only of them is not evidence of duplication and is discarded.
 * 3. A block is a maximal run of consecutive SIGNIFICANT lines appearing
 *    identically, and consecutively, in both files, at least
 *    `MIN_BLOCK_LINES` long. `lineCount` counts significant lines; the
 *    reported start/end line numbers are the ORIGINAL 1-based lines, so a
 *    block still opens in an editor where the message says it does.
 * 4. Blocks are claimed greedily longest-first, and no source line is
 *    counted twice, so the total is a straight "how many of this file's
 *    significant lines live in a duplicated block" figure.
 *
 * ── Why step 0 exists (hardening, 2026-09-02) ─────────────────────────
 * The first version of this metric compared raw lines. Review of PR #251
 * demonstrated that injecting a one-line JSX comment every 7th line into one
 * fork took the measurement from 1,383 lines / 30 blocks to 0 / 0 without
 * removing one line of duplication: every run was chopped below
 * `MIN_BLOCK_LINES`, and the ratchet then invited the contributor to
 * commit a baseline of 0, permanently retiring the guard. Any run-splitting
 * edit — a comment, a reflow, a stray blank line — had the same effect.
 * Normalizing the noise away makes the number insensitive to it, and the
 * paired test additionally refuses to accept a collapse to zero blocks
 * while both fork files still exist. Changing this normalization changes
 * the number: re-measure and move `FORK_DUPLICATION_BASELINE` in the same
 * commit, with a note saying the metric moved rather than the debt.
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
  /** 1-based first ORIGINAL line of the block in the first fork file. */
  startLineA: number;
  /** 1-based last ORIGINAL line of the block in the first fork file. */
  endLineA: number;
  /** 1-based first ORIGINAL line of the block in the second fork file. */
  startLineB: number;
  /** 1-based last ORIGINAL line of the block in the second fork file. */
  endLineB: number;
  /** Significant (non-comment, non-blank) lines inside the block. */
  lineCount: number;
  /** First substantial line of the block, for a readable failure message. */
  preview: string;
}

export interface ForkSimilarityReport {
  filePathA: string;
  filePathB: string;
  blocks: DuplicatedBlock[];
  /** Total significant lines living inside a counted block. THE ratcheted number. */
  duplicatedLineCount: number;
}

/** One line that survived normalization, with its place in the original file. */
export interface SignificantLine {
  /** Whitespace-normalized, comment-free text. Never empty. */
  text: string;
  /** 1-based line number in the ORIGINAL file. */
  lineNumber: number;
}

/**
 * Delete the JSX comment form — a block comment wrapped in braces — the
 * wrapping braces included.
 *
 * Handled before general comment stripping because the generic stripper
 * would leave the wrapper `{ }` behind, and a line reading `{ }` is not
 * blank: it would survive as a significant line and split the run exactly
 * the way the raw-line metric did. Newlines inside a multi-line JSX
 * comment are preserved so every later line keeps its original number.
 */
function stripJsxComments(source: string): string {
  return source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, (match) =>
    "\n".repeat((match.match(/\n/g) ?? []).length),
  );
}

/**
 * Delete `//` and block comments, preserving newlines so line numbers hold.
 *
 * A character scanner rather than a regex because `"https://example.com"`
 * and a string literal that merely CONTAINS block-comment delimiters must
 * survive: the scanner tracks string and template-literal state. It does
 * not model regex literals — a regex
 * containing a lone quote can desynchronize the string state — but the
 * consequence is bounded and symmetric: both fork files are stripped by
 * the identical function, so identical source still normalizes to
 * identical text, and the worst case is that some comments are left in
 * (less normalization), never that unrelated lines start matching.
 */
function stripComments(source: string): string {
  let out = "";
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block";
        i++;
        continue;
      }
      if (ch === "'") state = "single";
      else if (ch === '"') state = "double";
      else if (ch === "`") state = "template";
      out += ch;
      continue;
    }

    if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out += ch;
      }
      continue;
    }

    if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        i++;
        continue;
      }
      if (ch === "\n") out += ch;
      continue;
    }

    // Inside a string or template literal.
    if (ch === "\\") {
      out += ch;
      if (i + 1 < source.length) out += source[i + 1];
      i++;
      continue;
    }
    if (
      (state === "single" && ch === "'") ||
      (state === "double" && ch === '"') ||
      (state === "template" && ch === "`")
    ) {
      state = "code";
    }
    out += ch;
  }

  return out;
}

/**
 * Source text → the significant lines the ratchet actually compares.
 *
 * Exported so the paired test can prove the hardening claim directly:
 * injecting comments into a file must not change what this returns.
 */
export function normalizeSourceLines(source: string): SignificantLine[] {
  const stripped = stripComments(stripJsxComments(source)).split("\n");
  const significant: SignificantLine[] = [];

  for (let index = 0; index < stripped.length; index++) {
    const text = stripped[index].trim().replace(/\s+/g, " ");
    if (!text) continue;
    significant.push({ text, lineNumber: index + 1 });
  }

  return significant;
}

/**
 * Contiguous identical-line blocks between two significant-line sequences.
 *
 * Standard longest-common-substring dynamic programming over lines, with
 * the row kept as a rolling pair of typed arrays — the full matrix for
 * these two files would be ~10M cells, the two rows are ~2K.
 */
function findDuplicatedBlocks(
  linesA: SignificantLine[],
  linesB: SignificantLine[],
): DuplicatedBlock[] {
  // Interning the normalized lines to integers turns the inner comparison
  // into a number compare, which is what keeps this scan well under a
  // second on a 5,700-line file.
  const ids = new Map<string, number>();
  const idsA = new Int32Array(linesA.length);
  const idsB = new Int32Array(linesB.length);
  for (let i = 0; i < linesA.length; i++) {
    let id = ids.get(linesA[i].text);
    if (id === undefined) {
      id = ids.size;
      ids.set(linesA[i].text, id);
    }
    idsA[i] = id;
  }
  for (let j = 0; j < linesB.length; j++) {
    // A line absent from A can never match; -1 keeps it out of every run.
    idsB[j] = ids.get(linesB[j].text) ?? -1;
  }

  interface Candidate extends DuplicatedBlock {
    indexA: number;
    indexB: number;
  }

  const candidates: Candidate[] = [];
  let previous = new Int32Array(linesB.length + 1);
  let current = new Int32Array(linesB.length + 1);

  for (let i = 0; i < linesA.length; i++) {
    current.fill(0);
    for (let j = 0; j < linesB.length; j++) {
      if (idsA[i] !== idsB[j]) continue;
      const runLength = previous[j] + 1;
      current[j + 1] = runLength;
      // A run is recorded only where it ENDS — i.e. where the next pair of
      // lines no longer continues it. Recording every prefix instead would
      // emit one candidate per line of every block.
      const continues =
        i + 1 < linesA.length && j + 1 < linesB.length && idsA[i + 1] === idsB[j + 1];
      if (!continues && runLength >= MIN_BLOCK_LINES) {
        const startA = i - runLength + 1;
        const startB = j - runLength + 1;
        const substantial = linesA
          .slice(startA, i + 1)
          .find((line) => line.text.length > MIN_LINE_LENGTH);
        // Methodology step 2: a run of nothing but short structural lines
        // is not evidence of a pasted block.
        if (substantial) {
          candidates.push({
            indexA: startA,
            indexB: startB,
            startLineA: linesA[startA].lineNumber,
            endLineA: linesA[i].lineNumber,
            startLineB: linesB[startB].lineNumber,
            endLineB: linesB[j].lineNumber,
            lineCount: runLength,
            preview: substantial.text.slice(0, 80),
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
    (a, b) => b.lineCount - a.lineCount || a.indexA - b.indexA || a.indexB - b.indexB,
  );

  const claimedA = new Uint8Array(linesA.length);
  const claimedB = new Uint8Array(linesB.length);
  const blocks: DuplicatedBlock[] = [];
  for (const candidate of candidates) {
    let free = true;
    for (let k = 0; k < candidate.lineCount; k++) {
      if (claimedA[candidate.indexA + k] || claimedB[candidate.indexB + k]) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    for (let k = 0; k < candidate.lineCount; k++) {
      claimedA[candidate.indexA + k] = 1;
      claimedB[candidate.indexB + k] = 1;
    }
    const { indexA: _indexA, indexB: _indexB, ...block } = candidate;
    blocks.push(block);
  }

  blocks.sort((a, b) => a.startLineA - b.startLineA);
  return blocks;
}

/**
 * Measure fork duplication between two source TEXTS.
 *
 * The file-reading entry point below delegates here; tests use it directly
 * to measure fixtures (including the comment-injection attack) without
 * writing anything to disk.
 */
export function measureForkSimilarityBetween(
  sourceA: string,
  sourceB: string,
  filePathA: string = RATCHET_FORK_FILE_PATHS[0],
  filePathB: string = RATCHET_FORK_FILE_PATHS[1],
): ForkSimilarityReport {
  const blocks = findDuplicatedBlocks(
    normalizeSourceLines(sourceA),
    normalizeSourceLines(sourceB),
  );

  return {
    filePathA,
    filePathB,
    blocks,
    duplicatedLineCount: blocks.reduce((total, block) => total + block.lineCount, 0),
  };
}

/** Measure fork duplication for one repo checkout. */
export function measureForkSimilarity(rootDir: string): ForkSimilarityReport {
  const [relA, relB] = RATCHET_FORK_FILE_PATHS;

  return measureForkSimilarityBetween(
    readFileSync(`${rootDir}/${relA}`, "utf8"),
    readFileSync(`${rootDir}/${relB}`, "utf8"),
    relA,
    relB,
  );
}

/**
 * The failure text. Split out from the test so the ratchet's two
 * directions — "you added duplication" (a FAILURE) and "you removed some,
 * now lower the baseline" (a status message, not a failure) — are stated
 * in one place instead of inline in an assertion message.
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
      `dated note, in the same commit that removed the duplication. This is ` +
      `NOT a test failure; the suite stays green while the baseline is stale-high.`
    );
  }

  return `Fork duplication unchanged. ${summary}`;
}
