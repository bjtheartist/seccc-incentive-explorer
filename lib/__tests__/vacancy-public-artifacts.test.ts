/**
 * Public-artifact guards for the committed vacancy export — reads the raw
 * files with node:fs (not the app's static loaders) so a leaked internal
 * priority-rubric field or "top priority" ranking claim trips a test even if
 * a loader's type were to silently widen. Mirrors the committed-export
 * guards in lib/__tests__/vacancy-index.test.ts, but scoped to the specific
 * public-contract rails this task landed:
 *   • no internal priority score/tier/mix field ever reaches a committed file
 *   • no derived bucket/rank field (portfolio included) survives on any public row
 *   • every directory row's `clusterId` is null or a positive integer
 *   • every directory file covers one of the nine pilot ZIPs
 *   • no string value anywhere reads like a "top priority" ranking claim
 *
 * Skips gracefully (a passing, informative test) when
 * public/data/vacancy-index.json has not been committed yet — mirrors the
 * EXPORT_EXISTS gate the other committed-export guards use.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PILOT_ZIPS } from "../pilot-zips";
import type { VacancyDirectoryFile, VacancyIndexExport } from "../vacancy-index";

// This suite re-parses the large committed data artifacts with thousands of
// synchronous assertions. Wall time swings 2-3x under vitest worker CPU
// contention, so the 5s default timeout flakes the heaviest tests in
// full-suite runs even though every assertion passes. Sync tests cannot be
// interrupted mid-run — the timeout only retro-fails completed work — so a
// generous ceiling weakens nothing.
vi.setConfig({ testTimeout: 60_000 });

const INDEX_PATH = path.join(process.cwd(), "public/data/vacancy-index.json");
const DIRECTORY_DIR = path.join(process.cwd(), "public/data/vacancy-directory");
const INDEX_EXISTS = existsSync(INDEX_PATH);

/** The internal priority-rubric fields that must NEVER reach a public
 * artifact — the score/tier ordered sites at export time and the mix
 * summarized them, but neither may be serialized (see lib/vacancy-index.ts's
 * "Priority rubric (pure, EXPORT-SIDE INTERNAL)" section). */
const FORBIDDEN_SUBSTRINGS = [
  "priorityScore",
  "priorityTier",
  "priorityMix",
  "portfolio",
  "portfolioCounts",
];

const PILOT_ZIP_CODES = new Set(PILOT_ZIPS.map((entry) => entry.zip));

/** Every directory file present (empty array when the directory itself is
 * absent — same "not yet exported" state the index gate covers). */
function directoryFiles(): string[] {
  if (!existsSync(DIRECTORY_DIR)) return [];
  return readdirSync(DIRECTORY_DIR).filter((f) => f.endsWith(".json"));
}

/** Recursively collect every string VALUE (never a key) in a parsed JSON
 * structure — used to scan for banned ranking language anywhere in the tree. */
function collectStringValues(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectStringValues(item, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) collectStringValues(value, out);
    return;
  }
  if (typeof node === "string") out.push(node);
}

describe("public vacancy artifacts (committed export)", () => {
  it.skipIf(INDEX_EXISTS)(
    "skips gracefully — public/data/vacancy-index.json has not been committed yet",
    () => {
      expect(INDEX_EXISTS).toBe(false);
    },
  );

  describe.skipIf(!INDEX_EXISTS)("vacancy-index.json + vacancy-directory/*.json", () => {
    const rawIndexText = readFileSync(INDEX_PATH, "utf8");
    const data = JSON.parse(rawIndexText) as VacancyIndexExport;
    const files = directoryFiles();

    it("(a) the index file text carries none of the internal priority-rubric substrings", () => {
      for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        expect(
          rawIndexText.includes(forbidden),
          `vacancy-index.json contains forbidden substring: ${forbidden}`,
        ).toBe(false);
      }
    });

    it("(a) every directory file's text carries none of the internal priority-rubric substrings", () => {
      expect(files.length, "at least one directory file is committed").toBeGreaterThan(0);
      for (const file of files) {
        const text = readFileSync(path.join(DIRECTORY_DIR, file), "utf8");
        for (const forbidden of FORBIDDEN_SUBSTRINGS) {
          expect(text.includes(forbidden), `${file} contains forbidden substring: ${forbidden}`).toBe(false);
        }
      }
    });

    it("(b) no sitePoint, siteIndex entry, or cluster carries a portfolio/rank field", () => {
      for (const [zip, edition] of Object.entries(data.editions)) {
        for (const p of edition.sitePoints) {
          expect("portfolio" in p, `${zip} sitePoint carries a portfolio field`).toBe(false);
        }
        for (const r of edition.siteIndex) {
          expect("portfolio" in r, `${zip} siteIndex row carries a portfolio field`).toBe(false);
        }
        for (const c of edition.clusters ?? []) {
          expect("portfolioCounts" in c, `${zip} cluster carries portfolioCounts`).toBe(false);
        }
      }
    });

    it("(b) directory rows carry cluster context but no scoring or rank fields", () => {
      for (const file of files) {
        const dir = JSON.parse(
          readFileSync(path.join(DIRECTORY_DIR, file), "utf8"),
        ) as VacancyDirectoryFile;
        for (const row of dir.rows) {
          expect(
            row.clusterId === null || (Number.isInteger(row.clusterId) && row.clusterId > 0),
            `${file} has an invalid clusterId`,
          ).toBe(true);
          for (const forbidden of FORBIDDEN_SUBSTRINGS) {
            expect(forbidden in row, `${file} row carries ${forbidden}`).toBe(false);
          }
        }
      }
    });

    it("(c) every directory file covers one of the nine pilot ZIPs, and all nine are present", () => {
      const zipsCovered = new Set<string>();
      for (const file of files) {
        const dir = JSON.parse(readFileSync(path.join(DIRECTORY_DIR, file), "utf8")) as VacancyDirectoryFile;
        expect(PILOT_ZIP_CODES.has(dir.zip), `${file}'s zip "${dir.zip}" is not one of the nine pilot ZIPs`).toBe(
          true,
        );
        // The filename itself should be that same ZIP (the loader keys off it).
        expect(file, `${file} filename should match its own zip field ${dir.zip}`).toBe(`${dir.zip}.json`);
        zipsCovered.add(dir.zip);
      }
      for (const entry of PILOT_ZIPS) {
        expect(zipsCovered.has(entry.zip), `missing a directory file for pilot ZIP ${entry.zip}`).toBe(true);
      }
    });

    it("(d) no JSON string value anywhere in the index reads like a top-priority ranking claim", () => {
      const strings: string[] = [];
      collectStringValues(data, strings);
      const offenders = strings.filter((s) => /top\s+priority/i.test(s));
      expect(offenders, `found "top priority" language: ${JSON.stringify(offenders)}`).toEqual([]);
    });
  });
});
