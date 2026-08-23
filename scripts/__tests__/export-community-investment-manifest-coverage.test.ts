import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sol gate finding 1 (round 4) — "every fs read path in the exporter
 * resolves through the manifest layer — add an assertion that the
 * exporter's actual opened-file set equals the manifest's declared set
 * (spy on the read layer or collect opened paths), plus the geocode-cache
 * tamper test."
 *
 * This is DELIBERATELY independent of the exporter's own internal
 * touchedManifestFiles/assertNoOrphanedManifestSources bookkeeping (round 2/3
 * work, still in place and still enforced on every run) — that mechanism
 * proves the exporter's OWN accounting is internally consistent, but it
 * cannot catch a bug where the accounting itself silently fails to record a
 * real disk read (e.g. a future edit that reads a file via a raw fs call
 * instead of verifiedRead/readCsv/readTsv, exactly like the geocode-cache
 * bypass this round fixed). This test instead spies on node:fs.readFileSync
 * ITSELF — the one function every read in the exporter (and every read in
 * every lib module it imports) ultimately funnels through — and asserts
 * that the set of investment-inputs files the exporter's real process
 * physically opened is EXACTLY the manifest's declared source set (minus
 * the handful of ids explicitly, individually documented below as never
 * read by the exporter). No file may be open on disk without being either
 * declared-and-read or declared-and-explicitly-exempted; no manifest id may
 * be silently dropped from the accounting by adding it to the exempt list
 * without a reviewer seeing it change here.
 *
 * Runs the REAL main() end-to-end against the real committed
 * data/curated/investment-inputs/ directory — no fixtures, no mocks of the
 * exporter's own logic. The only stub is `fetch`: main() legitimately has a
 * handful of addresses with no Census geocoder match at all (a permanent,
 * expected condition — those rows are HELD CITYWIDE, not a bug; see
 * geocodeBatch's own doc comment), so a cache-miss is a real, non-flaky
 * possibility on every run, not a fixture problem to "fix away." The stub
 * exists so this test NEVER touches the live network regardless: it returns
 * an immediate, deterministic "no address match" response synchronously
 * instead of proxying to the real Census API, so a miss resolves exactly as
 * fast and exactly as deterministically as a hit. This test asserts nothing
 * about fetch's call count — that count is a function of real cache state,
 * not of the read-layer coverage this test exists to prove.
 */

const INPUT_DIR = join(process.cwd(), "data", "curated", "investment-inputs");

const openedInputFiles = new Set<string>();

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      const p = String(args[0]);
      if (p.startsWith(INPUT_DIR + "/")) {
        openedInputFiles.add(p.slice(INPUT_DIR.length + 1));
      }
      return actual.readFileSync(...args);
    },
  };
});

// Manifest source ids the exporter is documented to NEVER read as an input —
// each with its own reason, kept here as an INDEPENDENT list (not imported
// from export-community-investment.ts's DELIBERATELY_NOT_READ_MANIFEST_IDS)
// so a change to that production Set is caught by a mismatch here rather
// than trivially agreeing with itself. "geocode-cache" is INTENTIONALLY
// absent from this list (round 4 fix) — it is now expected to be READ.
const EXPECTED_NEVER_READ_IDS = new Set<string>([
  "impact-grants-held", // held pending intermediary-linkage design; never read by design
  "foundation-id-map", // generated FROM the export AFTER it is written; never read back in
  "chicago-prize-census", // a report ABOUT the export, generated after the export exists
  "refresh-attempt", // written only by refresh-live-sources.ts on a failed refresh attempt
]);

describe("export-community-investment manifest read-layer coverage (Sol gate finding 1, round 4)", () => {
  // The exporter's three outputs default to the COMMITTED data/private/ files;
  // running the real main() without an override rewrites their generatedAt
  // stamps in place and leaves the repo tree dirty after every full test run.
  // Inputs deliberately stay the REAL committed investment-inputs/ (that is
  // the point of this test); only the OUTPUTS are redirected to a throwaway
  // temp dir via the exporter's OUTPUT_DIR override.
  let tempOutputDir: string;
  let originalOutputDirEnv: string | undefined;

  beforeEach(() => {
    openedInputFiles.clear();
    tempOutputDir = mkdtempSync(join(tmpdir(), "export-manifest-coverage-out-"));
    originalOutputDirEnv = process.env.OUTPUT_DIR;
    process.env.OUTPUT_DIR = tempOutputDir;
    // Deterministic, synchronous, offline stand-in for the live Census
    // geocoder — always "no match," so any real cache miss resolves via the
    // exporter's own normal held-citywide path without ever reaching a
    // network socket. Real geocode-cache HITS never call fetch at all (see
    // geocodeBatch), so this only fires for genuinely new/unmatched addresses.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: { addressMatches: [] } }),
      })),
    );
  });

  afterEach(() => {
    if (originalOutputDirEnv === undefined) delete process.env.OUTPUT_DIR;
    else process.env.OUTPUT_DIR = originalOutputDirEnv;
    rmSync(tempOutputDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it(
    "the exporter's real fs.readFileSync calls under investment-inputs/ are EXACTLY the manifest's declared, non-exempt file set",
    async () => {
      const fs = await import("node:fs");
      const manifest = JSON.parse(fs.readFileSync(join(INPUT_DIR, "manifest.json"), "utf8")) as {
        sources: Array<{ id: string; file: string }>;
      };

      const expectedTouchedFiles = new Set(
        manifest.sources.filter((s) => !EXPECTED_NEVER_READ_IDS.has(s.id)).map((s) => s.file),
      );
      // manifest.json describes the OTHER sources; it is not itself one of
      // them, but loadManifest() does open it — expected, and separate from
      // the declared-source accounting.
      const MANIFEST_SELF_FILE = "manifest.json";

      const { main } = await import("../export-community-investment");
      await expect(main()).resolves.toBeUndefined();

      const touchedExcludingSelf = new Set(openedInputFiles);
      expect(touchedExcludingSelf.has(MANIFEST_SELF_FILE)).toBe(true);
      touchedExcludingSelf.delete(MANIFEST_SELF_FILE);

      const missingFromRun = [...expectedTouchedFiles].filter((f) => !touchedExcludingSelf.has(f)).sort();
      const unexpectedInRun = [...touchedExcludingSelf].filter((f) => !expectedTouchedFiles.has(f)).sort();

      expect(missingFromRun, "manifest source(s) declared but never opened on disk by the real run").toEqual([]);
      expect(
        unexpectedInRun,
        "file(s) opened on disk by the real run that are NOT in the manifest's declared, non-exempt set " +
          "(an undeclared read, OR a read that bypassed EXPECTED_NEVER_READ_IDS reconciliation above)",
      ).toEqual([]);

      // geocode-cache.json specifically must no longer be exempt (round 4's
      // fix) — assert it by name, not just via set-equality above, so a
      // future accidental re-add of "geocode-cache" to either exempt list
      // fails here with an unambiguous message.
      expect(touchedExcludingSelf.has("geocode-cache.json")).toBe(true);
      expect(EXPECTED_NEVER_READ_IDS.has("geocode-cache")).toBe(false);
    },
    120_000,
  );
});
