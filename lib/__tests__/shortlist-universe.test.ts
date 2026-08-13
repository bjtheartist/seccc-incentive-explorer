import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RANKING_INPUTS_VERSION,
  SHORTLIST_UNIVERSE_SCHEMA_VERSION,
  ShortlistUniverseFileSchema,
  __resetShortlistUniverseCacheForTests,
  __setShortlistUniverseDataDirForTests,
  loadShortlistUniverse,
  loadShortlistUniverseManifest,
  validateEnvelopeCounts,
  type ShortlistUniverseFile,
  type ShortlistUniverseManifest,
} from "../shortlist-universe";

function validFile(overrides: Partial<ShortlistUniverseFile> = {}): ShortlistUniverseFile {
  return {
    schemaVersion: SHORTLIST_UNIVERSE_SCHEMA_VERSION,
    buildId: "build-2026-08-12",
    generatedAt: "2026-08-12T00:00:00.000Z",
    zip: "60621",
    vacancySnapshotId: "snap-1",
    rankingInputsVersion: RANKING_INPUTS_VERSION,
    sources: {
      vacancy: { vintage: "2026-08-12", checksum: "abc" },
      zoning: { vintage: "2026-08-12", checksum: "def" },
      overlays: { vintage: "2026-08-12", checksum: "ghi" },
    },
    counts: {
      sourceRecords: 2,
      canonicalSites: 1,
      buildings: 0,
      land: 1,
      withPin: 1,
      withMeasuredArea: 1,
      withZoning: 1,
    },
    dedupe: { collapsedRecords: 1, conflictingPropertyTypes: 0, unresolvedConflicts: 0 },
    rows: [
      {
        canonicalKey: "pin:12345678901234",
        pin: "12345678901234",
        address: "1 MAIN ST",
        lat: 41.77,
        lon: -87.64,
        evidenceTypes: ["city_land"],
        hasVacantLandEvidence: true,
        hasVacantBuildingEvidence: false,
        conflictingPropertyTypes: false,
        propertyType: "vacant_land",
        buildingSqft: null,
        buildingSqftSource: null,
        lotSqft: 5000,
        lotSqftSource: "assessor_vacant_land",
        ownerStructure: "government",
        ownerGeography: "in_state",
        ownerConfidence: "pin_matched",
        saleYear: null,
        violation: false,
        zoning: { status: "resolved", district: "B3-2", zoneType: 3, pdNum: null, pmdSubArea: null },
        overlays: { ssa: true, ccsa: false, tif: true, nof: false },
        incentiveCount: 2,
      },
    ],
    ...overrides,
  };
}

function validManifest(overrides: Partial<ShortlistUniverseManifest> = {}): ShortlistUniverseManifest {
  return {
    schemaVersion: SHORTLIST_UNIVERSE_SCHEMA_VERSION,
    buildId: "build-2026-08-12",
    generatedAt: "2026-08-12T00:00:00.000Z",
    zips: ["60621"],
    vacancyIndexBuildId: "build-2026-08-12",
    files: {
      "60621": { path: "60621.json", checksum: "xyz", rowCount: 1 },
    },
    ...overrides,
  };
}

describe("ShortlistUniverseFileSchema", () => {
  it("accepts a well-formed envelope", () => {
    const result = ShortlistUniverseFileSchema.safeParse(validFile());
    expect(result.success).toBe(true);
  });

  it("rejects an unsupported schemaVersion", () => {
    const bad = { ...validFile(), schemaVersion: 2 };
    expect(ShortlistUniverseFileSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a malformed zip", () => {
    const bad = { ...validFile(), zip: "606211" };
    expect(ShortlistUniverseFileSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a row with an invalid zoning status", () => {
    const file = validFile();
    const bad = {
      ...file,
      rows: [{ ...file.rows[0], zoning: { ...file.rows[0].zoning, status: "maybe" } }],
    };
    expect(ShortlistUniverseFileSchema.safeParse(bad).success).toBe(false);
  });
});

describe("validateEnvelopeCounts", () => {
  it("finds no issues on a self-consistent envelope", () => {
    expect(validateEnvelopeCounts(validFile())).toEqual([]);
  });

  it("flags counts.canonicalSites drifting from rows.length", () => {
    const file = validFile({ counts: { ...validFile().counts, canonicalSites: 99 } });
    const issues = validateEnvelopeCounts(file);
    expect(issues.some((i) => i.includes("canonicalSites"))).toBe(true);
  });

  it("flags counts.buildings drifting from rows with hasVacantBuildingEvidence", () => {
    const file = validFile({ counts: { ...validFile().counts, buildings: 5 } });
    const issues = validateEnvelopeCounts(file);
    expect(issues.some((i) => i.includes("counts.buildings"))).toBe(true);
  });

  it("flags counts.withZoning drifting from rows with zoning.status === resolved", () => {
    const file = validFile({ counts: { ...validFile().counts, withZoning: 0 } });
    const issues = validateEnvelopeCounts(file);
    expect(issues.some((i) => i.includes("withZoning"))).toBe(true);
  });

  it("flags duplicate canonicalKeys across rows", () => {
    const base = validFile();
    const file = { ...base, rows: [...base.rows, { ...base.rows[0] }] };
    const issues = validateEnvelopeCounts(file);
    expect(issues.some((i) => i.includes("duplicate canonicalKeys"))).toBe(true);
  });
});

describe("loadShortlistUniverse / loadShortlistUniverseManifest — fail-closed behavior", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "shortlist-universe-test-"));
    __setShortlistUniverseDataDirForTests(dir);
    __resetShortlistUniverseCacheForTests();
  });

  afterEach(() => {
    __setShortlistUniverseDataDirForTests(null);
    __resetShortlistUniverseCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null manifest and a manifest_missing failure when no files exist yet", () => {
    expect(loadShortlistUniverseManifest()).toBeNull();
    const result = loadShortlistUniverse("60621");
    expect(result).toEqual({ ok: false, reason: "manifest_missing" });
  });

  it("loads a valid manifest + file pair successfully", () => {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(validManifest()));
    writeFileSync(join(dir, "60621.json"), JSON.stringify(validFile()));
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.zip).toBe("60621");
      expect(result.data.rows).toHaveLength(1);
    }
  });

  it("fails closed when the manifest exists but the ZIP file is missing", () => {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(validManifest()));
    const result = loadShortlistUniverse("60621");
    expect(result).toEqual({ ok: false, reason: "file_missing", detail: expect.any(String) });
  });

  it("fails closed on a ZIP the manifest never listed", () => {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(validManifest()));
    writeFileSync(join(dir, "60621.json"), JSON.stringify(validFile()));
    const result = loadShortlistUniverse("60619");
    expect(result).toEqual({ ok: false, reason: "manifest_zip_missing", detail: "60619" });
  });

  it("fails closed when the file's zip field does not match the requested zip", () => {
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify(validManifest({ zips: ["60621", "60619"], files: { ...validManifest().files, "60619": { path: "60619.json", checksum: "x", rowCount: 1 } } })),
    );
    // 60619.json on disk but its internal `zip` field says 60621 — a copy/paste export bug.
    writeFileSync(join(dir, "60619.json"), JSON.stringify(validFile({ zip: "60621" })));
    const result = loadShortlistUniverse("60619");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("zip_mismatch");
  });

  it("fails closed when the file's buildId does not match the manifest's buildId", () => {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(validManifest({ buildId: "build-A" })));
    writeFileSync(join(dir, "60621.json"), JSON.stringify(validFile({ buildId: "build-B" })));
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("build_id_mismatch");
  });

  it("fails closed on invalid JSON in the universe file", () => {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(validManifest()));
    writeFileSync(join(dir, "60621.json"), "{ not valid json");
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("file_invalid_json");
  });

  it("fails closed on a schema violation (bad schemaVersion)", () => {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(validManifest()));
    writeFileSync(join(dir, "60621.json"), JSON.stringify(validFile({ schemaVersion: 99 as never })));
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("file_invalid_schema");
  });

  it("fails closed when the manifest itself is invalid JSON", () => {
    writeFileSync(join(dir, "manifest.json"), "not json");
    expect(loadShortlistUniverseManifest()).toBeNull();
  });

  it("caches a successful load and does not re-read the file on a second call", () => {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(validManifest()));
    writeFileSync(join(dir, "60621.json"), JSON.stringify(validFile()));
    const first = loadShortlistUniverse("60621");
    // Corrupt the file on disk after the first (cached) load.
    writeFileSync(join(dir, "60621.json"), "corrupted");
    const second = loadShortlistUniverse("60621");
    expect(second).toEqual(first);
  });
});
