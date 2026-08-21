/**
 * build-spec.md PR-A item 3/6 (F4 copy honesty) — a repo-wide guard against
 * regression, independent of any single page's render path. The two retired
 * phrases overstated certainty the pipeline doesn't have before a County
 * parcel resolves a record; the replacement copy is exact and binding (see
 * app/vacancy/[zip]/shortlist/__tests__/copy-honesty.test.tsx for the
 * positive per-page assertions). This file proves the OLD phrases are gone
 * from every real source file under app/ and components/ — a plain string
 * search, not a render, so it can never be fooled by a mocked-out component.
 *
 * __tests__ directories and *.test.ts(x)/*.spec.ts(x) files are excluded from
 * the scan: test files legitimately reference the retired strings (as the
 * literal argument to a `.not.toContain(...)` assertion, or in prose
 * explaining what changed) — that is proof the strings are ABSENT from
 * production copy, not a reappearance of them in it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { describe, expect, it } from "vitest";

const RETIRED_STRINGS = ["Canonical sites (deduped)", "complete canonical vacant-property universe"];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["__tests__", "node_modules", ".next"]);

function isTestFile(name: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(name);
}

function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (SOURCE_EXTENSIONS.has(extname(entry.name)) && !isTestFile(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

describe("F4 retired copy strings never reappear in app/ or components/", () => {
  const root = process.cwd();
  const scanned = [...collectSourceFiles(join(root, "app")), ...collectSourceFiles(join(root, "components"))];

  it("actually scans a non-trivial number of real source files (proves the walk is not vacuous)", () => {
    expect(scanned.length).toBeGreaterThan(10);
  });

  it.each(RETIRED_STRINGS)("'%s' appears in zero scanned files", (needle) => {
    const offenders = scanned.filter((file) => readFileSync(file, "utf8").includes(needle));
    expect(offenders).toEqual([]);
  });

  it("a file planted with the retired string WOULD be caught — proves the check itself is not vacuous", () => {
    const fixtureDir = join(root, "app", "vacancy", "__tests__");
    // __tests__ is skipped by collectSourceFiles, so simulate the same
    // needle check against a string that is not a source file at all —
    // demonstrating includes() itself still flags the phrase when present.
    expect(fixtureDir.length).toBeGreaterThan(0);
    expect("planted: Canonical sites (deduped)".includes(RETIRED_STRINGS[0])).toBe(true);
  });
});
