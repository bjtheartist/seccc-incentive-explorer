import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliOptions, RefreshSource } from "../refresh/refresh-live-sources";

/**
 * Regression test for the 2026-09-02 "Monthly data refresh" failure (Actions
 * run 33628940119).
 *
 * The refresh script wrote a changed input and went straight to
 * `npm run data:export:investment`. The exporter calls
 * verifyManifestInputBytes() on every input read, which throws when the file's
 * live sha256 does not match the contentHash committed in manifest.json —
 * and refreshing an input is exactly the act of making those differ. Nothing
 * regenerated the manifest in between, so the export was guaranteed to fail
 * the first month a source actually moved. It did:
 *
 *   manifest.json's committed contentHash for "nof_large.json" (…) does not
 *   match the file's ACTUAL bytes at read time (…)
 *
 * What this proves, in the order that matters:
 *   1. a real refreshOne() write of a changed input, then
 *   2. the manifest's contentHash for THAT file equals the sha256 of the NEW
 *      bytes at the exact moment the export is spawned (captured inside the
 *      spawnSync mock, not read afterwards — "before" is the whole bug), and
 *   3. the export is spawned, and spawned after.
 *
 * Plus the two negative cases that keep the fix honest: --dry-run and
 * --skip-export must leave manifest.json byte-identical and spawn nothing.
 *
 * Harness mirrors refresh-one-decrease-policy-e2e.test.ts: INPUT_DIR points at
 * a throwaway mkdtemp directory so the real committed
 * data/curated/investment-inputs/ is never written. The fixture source's
 * build() is pure and in-memory; the export subprocess is mocked, so nothing
 * here touches the network or runs a real export.
 */

const hoisted = vi.hoisted(() => ({
  /** Set per-test so the spawnSync mock can snapshot the manifest AT CALL TIME. */
  inputDir: "",
  spawnCalls: [] as Array<{
    command: string;
    args: readonly string[];
    /** manifest.json's raw bytes at the instant the export was spawned. */
    manifestAtSpawn: string | null;
  }>,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const fs = await import("node:fs");
  const path = await import("node:path");
  return {
    ...actual,
    spawnSync: (command: string, args: readonly string[] = []) => {
      const manifestPath = path.join(hoisted.inputDir, "manifest.json");
      hoisted.spawnCalls.push({
        command,
        args,
        manifestAtSpawn: fs.existsSync(manifestPath)
          ? fs.readFileSync(manifestPath, "utf8")
          : null,
      });
      return { status: 0, signal: null, output: [], pid: 0, stdout: "", stderr: "" };
    },
  };
});

/** A REAL manifest source file, so the regenerated manifest has an entry to check. */
const FIXTURE_FILE = "nof_large.json";
const FIXTURE_SOURCE_ID = "nof-large";

const BEFORE_CONTENT =
  JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: i, amount: "1000" }))) + "\n";
/** Grows — a decrease would be refused by the monotonic_floor policy, and this
 * test is about the manifest, not the decrease guard. */
const AFTER_CONTENT =
  JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ id: i, amount: "1000" }))) + "\n";

/** A manifest.json whose contentHash for the fixture file is deliberately
 * wrong — the stale state every un-regenerated refresh leaves behind. */
const STALE_HASH = "0".repeat(64);
const STALE_MANIFEST_TEXT =
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: "1970-01-01T00:00:00.000Z",
      note: "stale fixture manifest",
      sources: [
        {
          id: FIXTURE_SOURCE_ID,
          file: FIXTURE_FILE,
          contentHash: STALE_HASH,
        },
      ],
    },
    null,
    2,
  ) + "\n";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function makeFixtureSource(): RefreshSource {
  return {
    id: FIXTURE_SOURCE_ID,
    label: "Fixture NOF Large (test-only synthetic bytes, no network)",
    file: FIXTURE_FILE,
    dollarLabel: "amount",
    async build() {
      return AFTER_CONTENT;
    },
    measure(content) {
      const rows = JSON.parse(content) as Array<{ amount?: string }>;
      let dollars = 0;
      for (const r of rows) {
        const n = Number(r.amount);
        if (Number.isFinite(n)) dollars += n;
      }
      return { rows: rows.length, dollars };
    },
  };
}

function contentHashFor(manifestText: string, file: string): string | undefined {
  const manifest = JSON.parse(manifestText) as {
    sources: Array<{ file: string; contentHash: string }>;
  };
  return manifest.sources.find((s) => s.file === file)?.contentHash;
}

describe("refresh pipeline order: refresh -> regenerate manifest -> export", () => {
  let tempInputDir: string;
  let originalInputDirEnv: string | undefined;

  beforeEach(() => {
    tempInputDir = mkdtempSync(join(tmpdir(), "refresh-manifest-order-"));
    hoisted.inputDir = tempInputDir;
    hoisted.spawnCalls.length = 0;
    originalInputDirEnv = process.env.INPUT_DIR;
    process.env.INPUT_DIR = tempInputDir;
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error(
          "network fetch() attempted — this fixture source's build() is fully synthetic.",
        );
      }),
    );
    writeFileSync(join(tempInputDir, FIXTURE_FILE), BEFORE_CONTENT, "utf8");
    writeFileSync(join(tempInputDir, "manifest.json"), STALE_MANIFEST_TEXT, "utf8");
  });

  afterEach(() => {
    if (originalInputDirEnv === undefined) delete process.env.INPUT_DIR;
    else process.env.INPUT_DIR = originalInputDirEnv;
    rmSync(tempInputDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("regenerates manifest.json to the NEW input bytes BEFORE the export is spawned", async () => {
    const { refreshOne, regenerateManifestThenExport } = await import(
      "../refresh/refresh-live-sources"
    );
    const options: CliOptions = { dryRun: false, skipExport: false, only: null, summaryOut: null };

    // 1. The refresh actually rewrites the input — the precondition that made
    //    the committed manifest stale in the first place.
    const outcome = await refreshOne(makeFixtureSource(), options);
    expect(outcome.ok).toBe(true);
    expect(outcome.changed).toBe(true);
    expect(readFileSync(join(tempInputDir, FIXTURE_FILE), "utf8")).toBe(AFTER_CONTENT);

    // The manifest is stale at this point — this is precisely the state the
    // export died in on 2026-09-02.
    expect(contentHashFor(readFileSync(join(tempInputDir, "manifest.json"), "utf8"), FIXTURE_FILE))
      .toBe(STALE_HASH);

    expect(regenerateManifestThenExport(options, true)).toBe(true);

    // 3. The export ran.
    expect(hoisted.spawnCalls).toHaveLength(1);
    expect(hoisted.spawnCalls[0].command).toBe("npm");
    expect(hoisted.spawnCalls[0].args).toEqual(["run", "data:export:investment"]);

    // 2. …and the manifest AS IT STOOD WHEN THE EXPORT WAS SPAWNED already
    //    carried the refreshed file's real hash. Snapshotted inside the mock,
    //    so this cannot pass on a manifest regenerated after the export.
    const manifestAtSpawn = hoisted.spawnCalls[0].manifestAtSpawn;
    expect(manifestAtSpawn).not.toBeNull();
    expect(contentHashFor(manifestAtSpawn!, FIXTURE_FILE)).toBe(sha256(AFTER_CONTENT));
    expect(contentHashFor(manifestAtSpawn!, FIXTURE_FILE)).not.toBe(STALE_HASH);
    expect(contentHashFor(manifestAtSpawn!, FIXTURE_FILE)).not.toBe(sha256(BEFORE_CONTENT));

    // The regeneration is a full manifest, not a patch of the stale fixture:
    // every AUTHORED_SOURCES entry is present and the authored fields came
    // back with it (nothing the refresh wrote or a human authored is lost).
    const regenerated = JSON.parse(manifestAtSpawn!) as {
      sources: Array<{ id: string; decreasePolicy?: string; valueField?: string | null }>;
    };
    expect(regenerated.sources.length).toBeGreaterThan(1);
    const entry = regenerated.sources.find((s) => s.id === FIXTURE_SOURCE_ID);
    expect(entry?.decreasePolicy).toBe("monotonic_floor");
    expect(entry?.valueField).toBe("amount");
  });

  it("--dry-run does NOT touch manifest.json and does not spawn the export", async () => {
    const { refreshOne, regenerateManifestThenExport } = await import(
      "../refresh/refresh-live-sources"
    );
    const options: CliOptions = { dryRun: true, skipExport: false, only: null, summaryOut: null };

    const outcome = await refreshOne(makeFixtureSource(), options);
    expect(outcome.changed).toBe(true); // it WOULD change…
    expect(readFileSync(join(tempInputDir, FIXTURE_FILE), "utf8")).toBe(BEFORE_CONTENT); // …but wrote nothing

    expect(regenerateManifestThenExport(options, true)).toBe(true);

    expect(readFileSync(join(tempInputDir, "manifest.json"), "utf8")).toBe(STALE_MANIFEST_TEXT);
    expect(hoisted.spawnCalls).toHaveLength(0);
  });

  it("--skip-export defers BOTH steps: manifest untouched, nothing spawned", async () => {
    const { regenerateManifestThenExport } = await import("../refresh/refresh-live-sources");
    const options: CliOptions = { dryRun: false, skipExport: true, only: null, summaryOut: null };

    expect(regenerateManifestThenExport(options, true)).toBe(true);

    expect(readFileSync(join(tempInputDir, "manifest.json"), "utf8")).toBe(STALE_MANIFEST_TEXT);
    expect(hoisted.spawnCalls).toHaveLength(0);
  });

  it("an unchanged refresh regenerates nothing and spawns nothing", async () => {
    const { regenerateManifestThenExport } = await import("../refresh/refresh-live-sources");
    const options: CliOptions = { dryRun: false, skipExport: false, only: null, summaryOut: null };

    expect(regenerateManifestThenExport(options, false)).toBe(true);

    expect(readFileSync(join(tempInputDir, "manifest.json"), "utf8")).toBe(STALE_MANIFEST_TEXT);
    expect(hoisted.spawnCalls).toHaveLength(0);
  });

  it("never writes outside the INPUT_DIR override", async () => {
    // Guard against a future change reaching for the lib's cwd-pinned
    // MANIFEST_PATH: the real committed manifest must be untouched, and the
    // temp dir is the only thing that moved.
    const realManifest = join(process.cwd(), "data", "curated", "investment-inputs", "manifest.json");
    expect(existsSync(realManifest)).toBe(true);
    const realBefore = readFileSync(realManifest, "utf8");

    const { refreshOne, regenerateManifestThenExport } = await import(
      "../refresh/refresh-live-sources"
    );
    const options: CliOptions = { dryRun: false, skipExport: false, only: null, summaryOut: null };
    await refreshOne(makeFixtureSource(), options);
    regenerateManifestThenExport(options, true);

    expect(readFileSync(realManifest, "utf8")).toBe(realBefore);
  });
});
