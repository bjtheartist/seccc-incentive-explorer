import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ShortlistUniverseFileSchema,
  ShortlistUniverseManifestSchema,
  shortlistUniverseChecksum,
  validateEnvelopeCounts,
} from "../shortlist-universe-schema";

describe("committed shortlist universe area audit", () => {
  it("binds all nine files and contains no non-positive/nonfinite measured areas", () => {
    const dir = join(process.cwd(), "data", "exports", "shortlist-universe");
    const manifest = ShortlistUniverseManifestSchema.parse(
      JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")),
    );
    expect(manifest.zips).toHaveLength(9);
    // This was a derivation-only repair, not a vacancy refresh. The source
    // snapshot identity must remain the one stamped by the August 13 paired
    // export; only the derived universe build id may advance.
    expect(manifest.vacancyIndexBuildId).toBe(
      "shortlist-universe-2026-08-13T01:56:59.840Z",
    );
    expect(manifest.buildId).not.toBe(manifest.vacancyIndexBuildId);

    let totalRows = 0;
    let totalMeasured = 0;
    for (const zip of manifest.zips) {
      const raw = readFileSync(join(dir, `${zip}.json`), "utf8");
      const file = ShortlistUniverseFileSchema.parse(JSON.parse(raw));
      expect(file.buildId).toBe(manifest.buildId);
      expect(file.vacancySnapshotId).toBe(manifest.vacancyIndexBuildId);
      expect(file.sources.vacancy.vintage).toBe("2026-08-13T01:56:59.841Z");
      expect(manifest.files[zip].checksum).toBe(shortlistUniverseChecksum(raw));
      expect(manifest.files[zip].rowCount).toBe(file.rows.length);
      expect(validateEnvelopeCounts(file)).toEqual([]);
      for (const row of file.rows) {
        for (const value of [row.lotSqft, row.buildingSqft]) {
          expect(value === null || (Number.isFinite(value) && value > 0)).toBe(true);
        }
        if (row.lotSqft === null) expect(row.lotSqftSource).toBeNull();
        if (row.buildingSqft === null) expect(row.buildingSqftSource).toBeNull();
      }
      totalRows += file.rows.length;
      totalMeasured += file.counts.withMeasuredArea;
    }

    expect(totalRows).toBe(31_296);
    expect(totalMeasured).toBe(1_667);
  });
});
