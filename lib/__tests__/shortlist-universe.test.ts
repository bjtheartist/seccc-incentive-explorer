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
  shortlistUniverseChecksum,
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
      sourceRecordsByEvidenceType: { city_land: 1, "311_building": 0, "311_land": 0, assessor_vacant_land: 1 },
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
        overlays: {
          ssa: { present: true, name: "Greater Chatham", unknown: false },
          ccsa: { present: false, name: null, unknown: false },
          tif: { present: true, name: null, unknown: false },
          nof: { present: false, name: null, unknown: false },
        },
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

/** Writes a manifest + one universe file pair that pass EVERY loader check
 *  (schema, buildId binding, checksum, rowCount, envelope-count
 *  self-consistency, vacancyIndexBuildId) — mirrors what the export script
 *  itself produces. Individual tests corrupt exactly one piece afterward to
 *  exercise one failure mode at a time. */
function writeConsistentFixture(
  dir: string,
  zip: string,
  fileOverrides: Partial<ShortlistUniverseFile> = {},
): { file: ShortlistUniverseFile; manifest: ShortlistUniverseManifest } {
  const file = validFile({ zip, ...fileOverrides });
  const serialized = JSON.stringify(file);
  const checksum = shortlistUniverseChecksum(serialized);
  const manifest = validManifest({
    buildId: file.buildId,
    vacancyIndexBuildId: file.buildId,
    zips: [zip],
    files: { [zip]: { path: `${zip}.json`, checksum, rowCount: file.rows.length } },
  });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, `${zip}.json`), serialized);
  return { file, manifest };
}

describe("ShortlistUniverseFileSchema", () => {
  it("accepts a well-formed envelope", () => {
    const result = ShortlistUniverseFileSchema.safeParse(validFile());
    expect(result.success).toBe(true);
  });

  it("rejects an unsupported schemaVersion", () => {
    const bad = { ...validFile(), schemaVersion: 99 };
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

  it("rejects an overlay membership that is a bare boolean (pre-v2 shape) — Finding 12", () => {
    const file = validFile();
    const bad = {
      ...file,
      rows: [{ ...file.rows[0], overlays: { ssa: true, ccsa: false, tif: true, nof: false } }],
    };
    expect(ShortlistUniverseFileSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a file missing counts.sourceRecordsByEvidenceType (pre-v2 shape) — Finding 6", () => {
    const file = validFile();
    const { sourceRecordsByEvidenceType: _omit, ...countsWithoutEvidenceType } = file.counts;
    const bad = { ...file, counts: countsWithoutEvidenceType };
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

  it("flags sourceRecordsByEvidenceType summing to something other than sourceRecords — Finding 6", () => {
    const file = validFile({
      counts: {
        ...validFile().counts,
        sourceRecordsByEvidenceType: { city_land: 1, "311_building": 0, "311_land": 0, assessor_vacant_land: 0 },
      },
    });
    const issues = validateEnvelopeCounts(file);
    expect(issues.some((i) => i.includes("sourceRecordsByEvidenceType"))).toBe(true);
  });

  it("flags duplicate canonicalKeys across rows", () => {
    const base = validFile();
    const file = { ...base, rows: [...base.rows, { ...base.rows[0] }] };
    const issues = validateEnvelopeCounts(file);
    expect(issues.some((i) => i.includes("duplicate canonicalKeys"))).toBe(true);
  });
});

describe("shortlistUniverseChecksum", () => {
  it("is deterministic for identical input", () => {
    expect(shortlistUniverseChecksum("abc")).toBe(shortlistUniverseChecksum("abc"));
  });

  it("differs for different input, even a single-byte change", () => {
    expect(shortlistUniverseChecksum("abc")).not.toBe(shortlistUniverseChecksum("abd"));
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

  it("loads a valid, fully-consistent manifest + file pair successfully", () => {
    writeConsistentFixture(dir, "60621");
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.zip).toBe("60621");
      expect(result.data.rows).toHaveLength(1);
    }
  });

  it("fails closed when the manifest exists but the ZIP file is missing", () => {
    const { manifest } = writeConsistentFixture(dir, "60621");
    rmSync(join(dir, "60621.json"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    const result = loadShortlistUniverse("60621");
    expect(result).toEqual({ ok: false, reason: "file_missing", detail: expect.any(String) });
  });

  it("fails closed on a ZIP the manifest never listed", () => {
    writeConsistentFixture(dir, "60621");
    const result = loadShortlistUniverse("60619");
    expect(result).toEqual({ ok: false, reason: "manifest_zip_missing", detail: "60619" });
  });

  it("fails closed when the file's zip field does not match the requested zip", () => {
    // 60619.json on disk but its internal `zip` field says 60621 — a
    // copy/paste export bug. Written with a matching checksum so the
    // checksum check itself does not mask which failure fires.
    const file = validFile({ zip: "60621" });
    const serialized = JSON.stringify(file);
    const checksum = shortlistUniverseChecksum(serialized);
    const manifest = validManifest({
      buildId: file.buildId,
      vacancyIndexBuildId: file.buildId,
      zips: ["60619"],
      files: { "60619": { path: "60619.json", checksum, rowCount: file.rows.length } },
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "60619.json"), serialized);
    const result = loadShortlistUniverse("60619");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("zip_mismatch");
  });

  it("fails closed when the file's buildId does not match the manifest's buildId", () => {
    const file = validFile({ buildId: "build-B" });
    const serialized = JSON.stringify(file);
    const checksum = shortlistUniverseChecksum(serialized);
    const manifest = validManifest({
      buildId: "build-A",
      vacancyIndexBuildId: "build-A",
      files: { "60621": { path: "60621.json", checksum, rowCount: file.rows.length } },
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "60621.json"), serialized);
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("build_id_mismatch");
  });

  it("fails closed on invalid JSON in the universe file (checksum catches it first, since it no longer matches the manifest)", () => {
    writeConsistentFixture(dir, "60621");
    writeFileSync(join(dir, "60621.json"), "{ not valid json");
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("file_checksum_mismatch");
  });

  it("still reaches file_invalid_json for malformed content whose checksum happens to match (checksum is not a JSON-validity proxy)", () => {
    const raw = "{ not valid json";
    const checksum = shortlistUniverseChecksum(raw);
    const manifest = validManifest({
      files: { "60621": { path: "60621.json", checksum, rowCount: 1 } },
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "60621.json"), raw);
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("file_invalid_json");
  });

  it("fails closed on a schema violation (bad schemaVersion), consistent-checksum file", () => {
    const file = validFile({ schemaVersion: 99 as never });
    const serialized = JSON.stringify(file);
    const checksum = shortlistUniverseChecksum(serialized);
    const manifest = validManifest({
      files: { "60621": { path: "60621.json", checksum, rowCount: file.rows.length } },
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "60621.json"), serialized);
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("file_invalid_schema");
  });

  it("fails closed when the manifest itself is invalid JSON", () => {
    writeFileSync(join(dir, "manifest.json"), "not json");
    expect(loadShortlistUniverseManifest()).toBeNull();
  });

  // ── Finding 7: the additional checks a schema-valid-but-truncated/tampered
  //    file must not slip past ──────────────────────────────────────────────

  it("fails closed on a checksum mismatch — a truncated or tampered file, even if still valid JSON+schema", () => {
    const { file } = writeConsistentFixture(dir, "60621");
    // Still schema-valid JSON (a genuine row dropped), but the manifest's
    // checksum was computed over the ORIGINAL two-row... here one-row file,
    // so truncating further must be caught by checksum, not silently pass
    // schema validation.
    writeFileSync(join(dir, "60621.json"), JSON.stringify({ ...file, rows: [] }));
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("file_checksum_mismatch");
  });

  it("fails closed on a rowCount mismatch between the manifest and the file", () => {
    const file = validFile();
    const serialized = JSON.stringify(file);
    const checksum = shortlistUniverseChecksum(serialized);
    // Manifest claims 5 rows; the file (and its own checksum) actually has 1.
    const manifest = validManifest({
      files: { "60621": { path: "60621.json", checksum, rowCount: 5 } },
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "60621.json"), serialized);
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("file_row_count_mismatch");
  });

  it("fails closed when the loaded file's own counts are internally inconsistent", () => {
    const file = validFile({ counts: { ...validFile().counts, canonicalSites: 99 } });
    const serialized = JSON.stringify(file);
    const checksum = shortlistUniverseChecksum(serialized);
    const manifest = validManifest({
      files: { "60621": { path: "60621.json", checksum, rowCount: file.rows.length } },
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "60621.json"), serialized);
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("file_counts_inconsistent");
  });

  it("fails closed when the manifest's vacancyIndexBuildId does not match its own buildId", () => {
    const file = validFile();
    const serialized = JSON.stringify(file);
    const checksum = shortlistUniverseChecksum(serialized);
    const manifest = validManifest({
      buildId: file.buildId,
      vacancyIndexBuildId: "some-other-run", // decoupled from buildId — a real drift
      files: { "60621": { path: "60621.json", checksum, rowCount: file.rows.length } },
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "60621.json"), serialized);
    const result = loadShortlistUniverse("60621");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("manifest_vacancy_index_build_id_mismatch");
  });

  it("caches a successful load and does not re-read the file on a second call", () => {
    writeConsistentFixture(dir, "60621");
    const first = loadShortlistUniverse("60621");
    expect(first.ok).toBe(true);
    // Corrupt the file on disk after the first (cached) load.
    writeFileSync(join(dir, "60621.json"), "corrupted");
    const second = loadShortlistUniverse("60621");
    expect(second).toEqual(first);
  });
});
