#!/usr/bin/env npx tsx

/**
 * One-time committed-artifact repair for legacy source sentinel area zeroes.
 * It preserves row membership/order and all non-area facts, updates envelope
 * counts, and rebinds all nine files under one new manifest build/checksum set.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePublishedArea } from "../lib/published-area";
import {
  ShortlistUniverseFileSchema,
  ShortlistUniverseManifestSchema,
  shortlistUniverseChecksum,
  validateEnvelopeCounts,
} from "../lib/shortlist-universe-schema";

const dataDir = join(process.cwd(), "data", "exports", "shortlist-universe");
const manifestPath = join(dataDir, "manifest.json");
const currentManifest = ShortlistUniverseManifestSchema.parse(
  JSON.parse(readFileSync(manifestPath, "utf8")),
);
const generatedAt = new Date().toISOString();
const buildId = `shortlist-universe-area-normalized-v1-${generatedAt}`;
const sourceVacancySnapshotId =
  process.argv[2]?.trim() || currentManifest.vacancyIndexBuildId;
if (!sourceVacancySnapshotId) {
  throw new Error("A source vacancy snapshot id is required for an area-only repair.");
}
const files: typeof currentManifest.files = {};

for (const zip of currentManifest.zips) {
  const path = join(dataDir, `${zip}.json`);
  const current = ShortlistUniverseFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const rows = current.rows.map((row) => {
    const lotSqft = normalizePublishedArea(row.lotSqft);
    const buildingSqft = normalizePublishedArea(row.buildingSqft);
    return {
      ...row,
      lotSqft,
      lotSqftSource: lotSqft === null ? null : row.lotSqftSource,
      buildingSqft,
      buildingSqftSource: buildingSqft === null ? null : row.buildingSqftSource,
    };
  });
  const file = ShortlistUniverseFileSchema.parse({
    ...current,
    buildId,
    generatedAt,
    // This repair changes only the derived interpretation of legacy zeroes.
    // It must not claim that the underlying vacancy snapshot was refreshed.
    vacancySnapshotId: sourceVacancySnapshotId,
    counts: {
      ...current.counts,
      withMeasuredArea: rows.filter(
        (row) => row.lotSqft !== null || row.buildingSqft !== null,
      ).length,
    },
    rows,
  });
  const issues = validateEnvelopeCounts(file);
  if (issues.length > 0) {
    throw new Error(`${zip} envelope mismatch: ${issues.join("; ")}`);
  }
  const serialized = JSON.stringify(file);
  writeFileSync(path, serialized);
  files[zip] = {
    path: `${zip}.json`,
    checksum: shortlistUniverseChecksum(serialized),
    rowCount: rows.length,
  };
}

const manifest = ShortlistUniverseManifestSchema.parse({
  ...currentManifest,
  buildId,
  generatedAt,
  vacancyIndexBuildId: sourceVacancySnapshotId,
  files,
});
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ buildId, files: manifest.zips.length }, null, 2));
