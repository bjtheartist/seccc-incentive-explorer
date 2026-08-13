/**
 * The Site Shortlist canonical universe envelope contract — schema, types,
 * and pure consistency checks, with NO "server-only" import and NO fs
 * access. Split out of lib/shortlist-universe.ts (the server-only loader,
 * which re-exports everything here) so this module can also be imported by
 * scripts/export-shortlist-universe.ts, which runs as a plain Node/tsx
 * script rather than through Next's bundler.
 *
 * "server-only" is a marker package that throws unconditionally from its
 * default (Node) export and only resolves to a no-op via the "react-server"
 * package-export condition, which Next's webpack/turbopack build sets but a
 * plain `tsx script.ts` invocation does not — so a single file importing
 * both "server-only" and being run directly by a script is a real
 * contradiction, not just a style question. Keeping the schema/validation
 * logic here (framework-agnostic) and the actual file-reading loader in
 * lib/shortlist-universe.ts (server-only, Next-context only) resolves it
 * cleanly: the export script and the loader both validate against the
 * exact same schema, with each importing what its own runtime can support.
 */

import { z } from "zod";

export const SHORTLIST_UNIVERSE_SCHEMA_VERSION = 1 as const;
export const RANKING_INPUTS_VERSION = 1 as const;

// ── Envelope schema ─────────────────────────────────────────────────────────

const EvidenceTypeSchema = z.enum(["city_land", "311_building", "311_land", "assessor_vacant_land"]);

const SourceVintageSchema = z.object({
  vintage: z.string(),
  checksum: z.string(),
});

const CountsSchema = z.object({
  sourceRecords: z.number().int().nonnegative(),
  canonicalSites: z.number().int().nonnegative(),
  buildings: z.number().int().nonnegative(),
  land: z.number().int().nonnegative(),
  withPin: z.number().int().nonnegative(),
  withMeasuredArea: z.number().int().nonnegative(),
  withZoning: z.number().int().nonnegative(),
});

const DedupeSchema = z.object({
  collapsedRecords: z.number().int().nonnegative(),
  conflictingPropertyTypes: z.number().int().nonnegative(),
  unresolvedConflicts: z.number().int().nonnegative(),
});

const ZoningStatusSchema = z.enum(["resolved", "unresolved", "ambiguous"]);

const RowZoningSchema = z.object({
  status: ZoningStatusSchema,
  district: z.string().nullable(),
  zoneType: z.number().nullable(),
  pdNum: z.number().nullable(),
  pmdSubArea: z.string().nullable(),
});

const RowOverlaysSchema = z.object({
  ssa: z.boolean(),
  ccsa: z.boolean(),
  tif: z.boolean(),
  nof: z.boolean(),
});

const OwnerConfidenceSchema = z.enum(["pin_matched", "inferred", "needs_verification"]);

export const ShortlistUniverseRowSchema = z.object({
  canonicalKey: z.string().min(1),
  pin: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  evidenceTypes: z.array(EvidenceTypeSchema),
  hasVacantLandEvidence: z.boolean(),
  hasVacantBuildingEvidence: z.boolean(),
  conflictingPropertyTypes: z.boolean(),
  propertyType: z.enum(["vacant_land", "vacant_building"]),
  buildingSqft: z.number().nullable(),
  buildingSqftSource: EvidenceTypeSchema.nullable(),
  lotSqft: z.number().nullable(),
  lotSqftSource: EvidenceTypeSchema.nullable(),
  ownerStructure: z.string().nullable(),
  ownerGeography: z.string().nullable(),
  ownerConfidence: OwnerConfidenceSchema,
  saleYear: z.number().nullable(),
  violation: z.boolean(),
  zoning: RowZoningSchema,
  overlays: RowOverlaysSchema,
  /** Kept SEPARATE from `overlays` on purpose (consult Q6.6): both are
   * honestly labeled facts, but scoring must not sum them as if they were
   * independent signals — the ranking engine (PR2) decides how/whether to
   * weight each; this envelope only ships both. */
  incentiveCount: z.number().int().nonnegative().nullable(),
});

export const ShortlistUniverseFileSchema = z.object({
  schemaVersion: z.literal(SHORTLIST_UNIVERSE_SCHEMA_VERSION),
  buildId: z.string().min(1),
  generatedAt: z.string(),
  zip: z.string().regex(/^\d{5}$/),
  vacancySnapshotId: z.string().min(1),
  rankingInputsVersion: z.literal(RANKING_INPUTS_VERSION),
  sources: z.object({
    vacancy: SourceVintageSchema,
    zoning: SourceVintageSchema,
    overlays: SourceVintageSchema,
  }),
  counts: CountsSchema,
  dedupe: DedupeSchema,
  rows: z.array(ShortlistUniverseRowSchema),
});

export type ShortlistUniverseRow = z.infer<typeof ShortlistUniverseRowSchema>;
export type ShortlistUniverseFile = z.infer<typeof ShortlistUniverseFileSchema>;

export const ShortlistUniverseManifestSchema = z.object({
  schemaVersion: z.literal(SHORTLIST_UNIVERSE_SCHEMA_VERSION),
  buildId: z.string().min(1),
  generatedAt: z.string(),
  zips: z.array(z.string().regex(/^\d{5}$/)),
  /** The vacancy-index.json regenerated in the SAME refresh run (consult
   * Q6.3) — must equal `buildId`. Kept as a separate explicit field (rather
   * than assuming equality) so a future run that intentionally decouples
   * the two artifacts fails a loud, specific assertion instead of a vague
   * mismatch. */
  vacancyIndexBuildId: z.string().min(1),
  files: z.record(
    z.string(),
    z.object({
      path: z.string(),
      checksum: z.string(),
      rowCount: z.number().int().nonnegative(),
    }),
  ),
});

export type ShortlistUniverseManifest = z.infer<typeof ShortlistUniverseManifestSchema>;

/**
 * Completeness/consistency check: every summary count in the envelope must
 * agree with what `rows` actually contains — a schema-valid-but-inconsistent
 * file (e.g. `counts.canonicalSites` drifting from `rows.length` after a
 * refactor) is exactly the kind of "None mapped" false-zero this overhaul
 * exists to prevent, and zod's shape validation alone cannot catch it.
 * Returns a list of human-readable issues; empty means consistent. The
 * export script calls this before writing each file (fail-closed on any
 * issue); it is also exercised directly by unit tests without a DB.
 */
export function validateEnvelopeCounts(file: ShortlistUniverseFile): string[] {
  const issues: string[] = [];
  const rows = file.rows;

  if (file.counts.canonicalSites !== rows.length) {
    issues.push(`counts.canonicalSites (${file.counts.canonicalSites}) !== rows.length (${rows.length})`);
  }
  const buildings = rows.filter((r) => r.hasVacantBuildingEvidence).length;
  if (file.counts.buildings !== buildings) {
    issues.push(`counts.buildings (${file.counts.buildings}) !== rows with hasVacantBuildingEvidence (${buildings})`);
  }
  const land = rows.filter((r) => r.hasVacantLandEvidence).length;
  if (file.counts.land !== land) {
    issues.push(`counts.land (${file.counts.land}) !== rows with hasVacantLandEvidence (${land})`);
  }
  const withPin = rows.filter((r) => r.pin != null).length;
  if (file.counts.withPin !== withPin) {
    issues.push(`counts.withPin (${file.counts.withPin}) !== rows with a non-null pin (${withPin})`);
  }
  const withMeasuredArea = rows.filter((r) => r.lotSqft != null || r.buildingSqft != null).length;
  if (file.counts.withMeasuredArea !== withMeasuredArea) {
    issues.push(`counts.withMeasuredArea (${file.counts.withMeasuredArea}) !== rows with a non-null lot/building sqft (${withMeasuredArea})`);
  }
  const withZoning = rows.filter((r) => r.zoning.status === "resolved").length;
  if (file.counts.withZoning !== withZoning) {
    issues.push(`counts.withZoning (${file.counts.withZoning}) !== rows with zoning.status === "resolved" (${withZoning})`);
  }
  const conflictingPropertyTypes = rows.filter((r) => r.conflictingPropertyTypes).length;
  if (file.dedupe.conflictingPropertyTypes !== conflictingPropertyTypes) {
    issues.push(`dedupe.conflictingPropertyTypes (${file.dedupe.conflictingPropertyTypes}) !== rows with conflictingPropertyTypes (${conflictingPropertyTypes})`);
  }
  const dupKeys = new Map<string, number>();
  for (const row of rows) dupKeys.set(row.canonicalKey, (dupKeys.get(row.canonicalKey) ?? 0) + 1);
  const duplicates = [...dupKeys.entries()].filter(([, n]) => n > 1);
  if (duplicates.length > 0) {
    issues.push(`duplicate canonicalKeys: ${duplicates.map(([k]) => k).join(", ")}`);
  }

  return issues;
}
