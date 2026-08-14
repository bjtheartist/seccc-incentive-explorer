import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliOptions, RefreshSource } from "../refresh/refresh-live-sources";

/**
 * Sol gate finding 7 (round 4) — "the test must execute the REAL refreshOne
 * path end-to-end against a fixture source whose new content violates the
 * decrease policy: assert (i) refreshOne rejects it, (ii) the on-disk file
 * is byte-identical after the attempt (rejected content never written),
 * (iii) the failure artifact is produced."
 *
 * scripts/__tests__/refresh-decrease-policy.test.ts already proves
 * checkDecreasePolicy() and buildRefreshAttemptArtifact() are individually
 * correct — this file is deliberately different: it calls the REAL,
 * unmodified refreshOne() (exported from refresh-live-sources.ts for exactly
 * this purpose), the SAME function main() calls for every real source, and
 * proves the FULL measure -> checkDecreasePolicy -> write wiring rejects a
 * bad write for real, not just that its pieces are individually correct in
 * isolation.
 *
 * No network: refreshOne's INPUT_DIR is now overridable via process.env
 * (round 4 addition, mirroring scripts/export-community-investment.ts's
 * existing pattern), so this points it at a throwaway mkdtemp directory that
 * exists ONLY for this test — the real committed
 * data/curated/investment-inputs/ directory is never touched. The fixture
 * source's build() is a pure in-memory string, so there is nothing for
 * `fetch` to do; it is stubbed to throw regardless, as a canary against a
 * future change accidentally adding a network call to this path.
 */
describe("refreshOne end-to-end decrease-policy rejection (Sol gate finding 7, round 4)", () => {
  let tempInputDir: string;
  let originalInputDirEnv: string | undefined;

  beforeEach(() => {
    tempInputDir = mkdtempSync(join(tmpdir(), "refresh-one-e2e-"));
    originalInputDirEnv = process.env.INPUT_DIR;
    process.env.INPUT_DIR = tempInputDir;
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error(
          "network fetch() attempted — this fixture source's build() is fully synthetic and should " +
            "never call fetch at all.",
        );
      }),
    );
  });

  afterEach(() => {
    if (originalInputDirEnv === undefined) delete process.env.INPUT_DIR;
    else process.env.INPUT_DIR = originalInputDirEnv;
    rmSync(tempInputDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("refreshOne REJECTS a fixture source whose new content violates the decrease policy: rejection, byte-identical file, and a produced failure artifact", async () => {
    const FIXTURE_FILE = "fixture-decrease-violation.json";
    // "Before": 100 rows totalling $1,000,000 — the file already committed on
    // disk before this refresh attempt runs.
    const beforeContent =
      JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i, amount: "10000" }))) + "\n";
    writeFileSync(join(tempInputDir, FIXTURE_FILE), beforeContent, "utf8");

    // "some-unknown-source-id"-shaped: NOT a real manifest id, so
    // checkDecreasePolicy's `entry?.decreasePolicy ?? "monotonic_floor"`
    // default applies (see refresh-decrease-policy.test.ts's equivalent
    // assertion on checkDecreasePolicy directly) — this test does not
    // depend on any real manifest source's policy staying what it is today.
    const fixtureSource: RefreshSource = {
      id: "fixture-decrease-violation",
      label: "Fixture decrease-violation source (test-only, not a real manifest id)",
      file: FIXTURE_FILE,
      dollarLabel: "amount",
      async build() {
        // "After": a drastic synthetic drop — 100 rows/$1,000,000 -> 1 row/$1.
        return JSON.stringify([{ id: 0, amount: "1" }]) + "\n";
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

    const options: CliOptions = { dryRun: false, skipExport: true, only: null, summaryOut: null };

    const { refreshOne, buildRefreshAttemptArtifact } = await import("../refresh/refresh-live-sources");

    const outcome = await refreshOne(fixtureSource, options);

    // (i) refreshOne rejects it.
    expect(outcome.ok).toBe(false);
    expect(outcome.changed).toBe(false);
    expect(outcome.error).toMatch(/monotonic_floor/);
    expect(outcome.before).toEqual({ rows: 100, dollars: 1_000_000 });
    expect(outcome.after).toEqual({ rows: 1, dollars: 1 });

    // (ii) the on-disk file is byte-identical after the attempt — rejected
    // content was never written. Read with a fresh, unmocked fs call.
    const onDiskAfterAttempt = readFileSync(join(tempInputDir, FIXTURE_FILE), "utf8");
    expect(onDiskAfterAttempt).toBe(beforeContent);

    // (iii) the failure artifact is produced — same production wiring
    // main() uses: feed refreshOne's real outcome into
    // buildRefreshAttemptArtifact, then write it exactly as main() does.
    const artifact = buildRefreshAttemptArtifact([outcome]);
    expect(artifact).not.toBeNull();
    expect(artifact!.failedSources).toHaveLength(1);
    expect(artifact!.failedSources[0]).toMatchObject({
      id: "fixture-decrease-violation",
      file: FIXTURE_FILE,
    });
    expect(artifact!.failedSources[0].error).toMatch(/monotonic_floor/);
    expect(artifact!.okSources).toEqual([]);

    const artifactPath = join(tempInputDir, "refresh-attempt.json");
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
    const artifactOnDisk = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      failedSources: Array<{ id: string; error?: string }>;
    };
    expect(artifactOnDisk.failedSources[0].id).toBe("fixture-decrease-violation");
    expect(artifactOnDisk.failedSources[0].error).toMatch(/monotonic_floor/);
  });

  it("control: the SAME fixture source with a healthy (non-decreasing) build() is ACCEPTED and written for real", async () => {
    const FIXTURE_FILE = "fixture-decrease-ok.json";
    const beforeContent = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: i, amount: "100" }))) + "\n";
    writeFileSync(join(tempInputDir, FIXTURE_FILE), beforeContent, "utf8");

    const afterContent =
      JSON.stringify(Array.from({ length: 11 }, (_, i) => ({ id: i, amount: "100" }))) + "\n"; // grew, not shrank

    const fixtureSource: RefreshSource = {
      id: "fixture-decrease-ok",
      label: "Fixture healthy-growth source (test-only, not a real manifest id)",
      file: FIXTURE_FILE,
      dollarLabel: "amount",
      async build() {
        return afterContent;
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
    const options: CliOptions = { dryRun: false, skipExport: true, only: null, summaryOut: null };

    const { refreshOne, buildRefreshAttemptArtifact } = await import("../refresh/refresh-live-sources");
    const outcome = await refreshOne(fixtureSource, options);

    expect(outcome.ok).toBe(true);
    expect(outcome.changed).toBe(true);
    expect(outcome.error).toBeUndefined();

    // The real write DID happen this time — proving the rejection path above
    // is a genuine decrease-policy refusal, not refreshOne simply never
    // writing in this test harness.
    const onDisk = readFileSync(join(tempInputDir, FIXTURE_FILE), "utf8");
    expect(onDisk).toBe(afterContent);
    expect(onDisk).not.toBe(beforeContent);

    expect(buildRefreshAttemptArtifact([outcome])).toBeNull();
  });
});
