import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sol gate finding 1 (round 4, 2nd pass) — "the geocode-cache tamper test
 * calls verifyManifestInputBytes with synthetic strings — it never proves
 * the EXPORTER's geocode-cache read goes through verification. If
 * loadGeocodeCache reverted to raw readFileSync, both current tests stay
 * green (the coverage test only checks the file was OPENED, not verified)."
 *
 * This closes that gap directly: it tampers ONE BYTE inside a REAL,
 * disk-staged copy of an investment-inputs file, runs the REAL exported
 * main() against that staged directory (via the same INPUT_DIR override the
 * coverage test and the finding-7 tests use), and asserts the export FAILS
 * with a hash-mismatch error naming that exact file. A revert of
 * loadGeocodeCache (or ANY other read) to a raw readFileSync would make the
 * corresponding case here go from "throws" to "silently succeeds on
 * tampered bytes" — a real regression this test would catch that the
 * existing coverage test structurally cannot (it only proves a file was
 * OPENED, never that its bytes were checked).
 *
 * Parameterized over EVERY manifest source id the exporter actually reads
 * (not just geocode-cache) — one loop, so a future read path that reverts to
 * a raw fs call for ANY input is caught the same way, not just this one.
 *
 * Staging strategy: symlink every real input file into a throwaway temp
 * dir (so 33 iterations don't each copy the real ~36MB investment-inputs/
 * directory), except (a) the ONE file under test this iteration, which gets
 * a REAL, independent copy so it can be tampered without touching the
 * committed file, and (b) geocode-cache.json, which ALWAYS gets a real copy
 * regardless of which source is under test — main() unconditionally
 * rewrites it at the end of every run (geocodeBatch's saveGeocodeCache), and
 * a symlink there would write straight through to the real committed file.
 * manifest.json itself is never staged: scripts/lib/investment-manifest.ts's
 * MANIFEST_PATH is not INPUT_DIR-overridable, so every run reads the REAL
 * committed manifest.json regardless of INPUT_DIR — exactly what makes this
 * a fair test (the expected hash always comes from the real, untampered
 * manifest; only the DATA bytes are staged/tampered).
 */

const REAL_INPUT_DIR = join(process.cwd(), "data", "curated", "investment-inputs");

// Independent of export-community-investment.ts's own
// DELIBERATELY_NOT_READ_MANIFEST_IDS (same rationale as the coverage test):
// these ids are the ones the exporter genuinely never reads, so tampering
// their files would produce no read at all, not a hash-mismatch throw.
const NEVER_READ_IDS = new Set<string>([
  "impact-grants-held",
  "foundation-id-map",
  "chicago-prize-census",
  "refresh-attempt",
]);

interface ManifestSourceFixture {
  id: string;
  file: string;
}

function realManifestSources(): ManifestSourceFixture[] {
  const manifest = JSON.parse(readFileSync(join(REAL_INPUT_DIR, "manifest.json"), "utf8")) as {
    sources: ManifestSourceFixture[];
  };
  return manifest.sources.filter((s) => !NEVER_READ_IDS.has(s.id));
}

/** Stage a throwaway copy of investment-inputs/, tampering ONE FILE's bytes
 * if `tamperFile` is given. Returns the staged directory's absolute path. */
function stageInputDir(tamperFile?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "export-tamper-e2e-"));
  const entries = readdirSync(REAL_INPUT_DIR, { withFileTypes: true }).filter((e) => e.isFile());
  for (const entry of entries) {
    const src = join(REAL_INPUT_DIR, entry.name);
    const dest = join(dir, entry.name);
    const mustCopy = entry.name === "geocode-cache.json" || entry.name === tamperFile;
    if (mustCopy) copyFileSync(src, dest);
    else symlinkSync(src, dest);
  }
  if (tamperFile) {
    const target = join(dir, tamperFile);
    const bytes = readFileSync(target); // independent Buffer — safe to mutate
    const mid = Math.floor(bytes.length / 2);
    bytes[mid] = bytes[mid] ^ 0xff; // flip every bit of one byte — guaranteed different
    writeFileSync(target, bytes);
  }
  return dir;
}

/** Run the REAL exported main() with INPUT_DIR pointed at `dir` and
 * OUTPUT_DIR pointed at a throwaway temp dir (the exporter's outputs default
 * to the COMMITTED data/private/ files — without the override, the control
 * case's successful end-to-end run would rewrite their generatedAt stamps in
 * place and leave the repo tree dirty after every full test run). Never
 * throws — resolves to a discriminated result so a caller can assert either
 * branch without a try/catch at the call site. */
async function runExportAgainst(dir: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const originalInputDirEnv = process.env.INPUT_DIR;
  const originalOutputDirEnv = process.env.OUTPUT_DIR;
  const outDir = mkdtempSync(join(tmpdir(), "export-tamper-e2e-out-"));
  process.env.INPUT_DIR = dir;
  process.env.OUTPUT_DIR = outDir;
  vi.resetModules();
  try {
    const { main } = await import("../export-community-investment");
    await main();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (originalInputDirEnv === undefined) delete process.env.INPUT_DIR;
    else process.env.INPUT_DIR = originalInputDirEnv;
    if (originalOutputDirEnv === undefined) delete process.env.OUTPUT_DIR;
    else process.env.OUTPUT_DIR = originalOutputDirEnv;
    rmSync(outDir, { recursive: true, force: true });
    vi.resetModules();
  }
}

describe("export-community-investment tamper detection through the REAL exporter path (Sol gate finding 1, round 4 pass 2)", () => {
  beforeEach(() => {
    // Same rationale as export-community-investment-manifest-coverage.test.ts:
    // deterministic, instant, offline stand-in for the live Census geocoder.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: { addressMatches: [] } }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    "control: an UNTAMPERED staged copy of every manifest input lets the real exporter succeed end-to-end",
    async () => {
      const dir = stageInputDir();
      try {
        const result = await runExportAgainst(dir);
        expect(result.ok, result.ok ? "" : (result as { error: string }).error).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it.each(realManifestSources())(
    "tampering ONE BYTE of $file (manifest id $id) makes the REAL exporter FAIL with a hash-mismatch error naming it",
    async ({ file }) => {
      const dir = stageInputDir(file);
      try {
        const result = await runExportAgainst(dir);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toMatch(/does not match the .* ACTUAL bytes at read time/);
          expect(result.error).toContain(file);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
