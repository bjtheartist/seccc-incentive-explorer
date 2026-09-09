#!/usr/bin/env npx tsx
/** Reviewed, additive release over the existing ranked snapshot. No database
 * writes or refresh of unrelated sources. Input is the committed evidence
 * bundle; output binds every ZIP and unchanged parcel sidecar to a new build. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { incorporateVacancyCitations, type LocatedVacancyCitation } from "../lib/shortlist-violation-evidence";
import {
  SHORTLIST_UNIVERSE_SCHEMA_VERSION, ShortlistUniverseFileSchema,
  ShortlistUniverseManifestSchema, shortlistUniverseChecksum, validateEnvelopeCounts,
} from "../lib/shortlist-universe-schema";

const dir = join(process.cwd(), "data/exports/shortlist-universe");
const bundleRaw = readFileSync(join(dir, "building-violations.json"), "utf8");
const bundle = JSON.parse(bundleRaw) as { reviewedAt: string; signals: LocatedVacancyCitation[] };
const checksum = shortlistUniverseChecksum(bundleRaw);
const manifestPath = join(dir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const reference = new Date(bundle.reviewedAt);
if (!Number.isFinite(reference.getTime())) throw new Error("Invalid review date");
const generatedAt = new Date().toISOString();
const buildId = `shortlist-universe-building-violations-${generatedAt}`;
const pending = new Map<string, string>();
const files: Record<string, { path: string; checksum: string; rowCount: number }> = {};
const report: Array<{ zip: string; citations: number; newCandidates: number }> = [];
const identityPath = join(dir, "parcel-identity/manifest.json");
const identityManifest = JSON.parse(readFileSync(identityPath, "utf8"));
if (identityManifest.universeBuildId !== manifest.buildId) throw new Error("Parcel identity baseline mismatch");

for (const zip of manifest.zips as string[]) {
  const filePath = join(dir, `${zip}.json`);
  const raw = readFileSync(filePath, "utf8");
  if (shortlistUniverseChecksum(raw) !== manifest.files[zip].checksum) throw new Error(`${zip}: baseline checksum mismatch`);
  const original = JSON.parse(raw);
  if (original.buildId !== manifest.buildId || original.vacancySnapshotId !== manifest.vacancyIndexBuildId) {
    throw new Error(`${zip}: baseline identity mismatch`);
  }
  if (![2, SHORTLIST_UNIVERSE_SCHEMA_VERSION].includes(original.schemaVersion)) throw new Error("Unsupported baseline schema");
  const current = ShortlistUniverseFileSchema.parse({
    ...original, schemaVersion: SHORTLIST_UNIVERSE_SCHEMA_VERSION,
    counts: { ...original.counts, sourceRecordsByEvidenceType: { building_violation: 0, ...original.counts.sourceRecordsByEvidenceType } },
  });
  const signals = bundle.signals.filter((signal) => signal.zip === zip);
  const merged = incorporateVacancyCitations(current, signals, reference);
  const next = ShortlistUniverseFileSchema.parse({
    ...merged, buildId, generatedAt,
    sources: { ...merged.sources, buildingViolations: { vintage: bundle.reviewedAt, checksum } },
  });
  const issues = validateEnvelopeCounts(next);
  if (issues.length) throw new Error(`${zip}: ${issues.join("; ")}`);
  const serialized = JSON.stringify(next);
  pending.set(filePath, serialized);
  files[zip] = { path: `${zip}.json`, checksum: shortlistUniverseChecksum(serialized), rowCount: next.rows.length };
  report.push({ zip, citations: signals.length, newCandidates: next.rows.length - current.rows.length });

  // The base rows retain their keys AND identity inputs. Rebind only after
  // verifying every sidecar entry still references exactly that same site.
  const sidecarPath = join(dir, "parcel-identity", `${zip}.json`);
  const sidecarRaw = readFileSync(sidecarPath, "utf8");
  if (shortlistUniverseChecksum(sidecarRaw) !== identityManifest.files[zip].checksum) throw new Error(`${zip}: sidecar checksum mismatch`);
  const sidecar = JSON.parse(sidecarRaw);
  if (sidecar.universeBuildId !== manifest.buildId) throw new Error(`${zip}: sidecar build mismatch`);
  const before = new Map(current.rows.map((row) => [row.canonicalKey, row]));
  const after = new Map(next.rows.map((row) => [row.canonicalKey, row]));
  for (const key of Object.keys(sidecar.entries)) {
    const a = before.get(key), b = after.get(key);
    if (!a || !b || ["address", "pin", "lat", "lon"].some((field) => a[field as keyof typeof a] !== b[field as keyof typeof b])) {
      throw new Error(`${zip}: changed parcel identity ${key}`);
    }
  }
  const rebound = sidecarRaw.replace(JSON.stringify(sidecar.universeBuildId), JSON.stringify(buildId));
  pending.set(sidecarPath, rebound);
  identityManifest.files[zip].checksum = shortlistUniverseChecksum(rebound);
}
const nextManifest = ShortlistUniverseManifestSchema.parse({
  ...manifest, schemaVersion: SHORTLIST_UNIVERSE_SCHEMA_VERSION, buildId, generatedAt, files,
});
pending.set(manifestPath, JSON.stringify(nextManifest, null, 2));
pending.set(identityPath, JSON.stringify({ ...identityManifest, universeBuildId: buildId }, null, 2));
// All validation completes before any artifact is replaced.
for (const [path, contents] of pending) writeFileSync(path, contents);
const outsideCoverage = bundle.signals.filter((signal) => !manifest.zips.includes(signal.zip));
console.log(JSON.stringify({ buildId, report, outsideCoverage: outsideCoverage.map(({ id, zip }) => ({ id, zip })) }, null, 2));
