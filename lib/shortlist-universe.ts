import "server-only";

/**
 * Server-only loader for the Site Shortlist canonical universe files
 * (data/exports/shortlist-universe/<zip>.json + manifest.json) — the
 * complete, deduped, zoning-resolved data foundation PR1 ships. PR2 wires
 * the engine that consumes this; this loader exists now so the bundling
 * contract (next.config.ts outputFileTracingIncludes) can be proven in a
 * production build before any consumer exists.
 *
 * Contract (per the gpt5.6 matchmaker consult, Q1):
 *   - Files live OUTSIDE public/ (data/exports/, server-only-imported) —
 *     public/ is publicly downloadable and would leak the address-level
 *     universe.
 *   - Every file carries a strict versioned envelope, validated at
 *     runtime (zod) — a malformed or stale file must never render as an
 *     empty/wrong result.
 *   - Every per-ZIP file's `buildId` must match the shared manifest's
 *     `buildId` — a mismatch (a half-regenerated universe, or a manifest
 *     from a different run) fails closed rather than mixing snapshots.
 *
 * Fail-closed: every failure mode returns a typed `{ ok: false, reason }`
 * result rather than throwing or silently returning an empty universe.
 * Callers render an explicit "temporarily unavailable" state on `!ok`,
 * never a false "zero sites match" — the exact false-zero this overhaul
 * exists to fix.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const SHORTLIST_UNIVERSE_SCHEMA_VERSION = 1 as const;
export const RANKING_INPUTS_VERSION = 1 as const;

const DATA_DIR = path.join(process.cwd(), "data", "exports", "shortlist-universe");

// Test-only override so unit tests can point the loader at an isolated
// temp directory instead of the real (production) data/exports path —
// never mutated outside __setShortlistUniverseDataDirForTests.
let dataDirOverride: string | null = null;

function resolvedDataDir(): string {
  return dataDirOverride ?? DATA_DIR;
}

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

// ── Fail-closed load result ─────────────────────────────────────────────────

export type ShortlistUniverseLoadFailureReason =
  | "manifest_missing"
  | "manifest_invalid_schema"
  | "manifest_zip_missing"
  | "file_missing"
  | "file_invalid_json"
  | "file_invalid_schema"
  | "zip_mismatch"
  | "build_id_mismatch";

export type ShortlistUniverseLoadResult =
  | { ok: true; data: ShortlistUniverseFile }
  | { ok: false; reason: ShortlistUniverseLoadFailureReason; detail?: string };

// Module-level caches, read once per process. `undefined` = not attempted;
// `null` = attempted and unavailable (a legitimate pre-export-run state).
let manifestCache: ShortlistUniverseManifest | null | undefined = undefined;
const fileCache = new Map<string, ShortlistUniverseLoadResult>();

/** Load and validate the shared manifest. Returns `null` on any failure
 * (missing file, bad JSON, schema violation) — never throws. */
export function loadShortlistUniverseManifest(): ShortlistUniverseManifest | null {
  if (manifestCache !== undefined) return manifestCache;

  const manifestPath = path.join(resolvedDataDir(), "manifest.json");
  try {
    if (!existsSync(manifestPath)) {
      manifestCache = null;
      return manifestCache;
    }
    const raw = readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const result = ShortlistUniverseManifestSchema.safeParse(parsed);
    manifestCache = result.success ? result.data : null;
  } catch {
    manifestCache = null;
  }
  return manifestCache;
}

/**
 * Load ONE ZIP's universe file, validated against the schema and asserted
 * to match the manifest's buildId. Fail-closed on every mismatch — a
 * caller that only checks `.ok` and renders "temporarily unavailable" on
 * `false` can never accidentally render a stale, half-regenerated, or
 * wrong-ZIP universe as if it were a genuine (possibly empty) result.
 */
export function loadShortlistUniverse(zip: string): ShortlistUniverseLoadResult {
  const cached = fileCache.get(zip);
  if (cached) return cached;

  const result = loadShortlistUniverseUncached(zip);
  fileCache.set(zip, result);
  return result;
}

function loadShortlistUniverseUncached(zip: string): ShortlistUniverseLoadResult {
  const manifest = loadShortlistUniverseManifest();
  if (!manifest) return { ok: false, reason: "manifest_missing" };
  if (!manifest.files[zip]) return { ok: false, reason: "manifest_zip_missing", detail: zip };

  const filePath = path.join(resolvedDataDir(), `${zip}.json`);
  if (!existsSync(filePath)) return { ok: false, reason: "file_missing", detail: filePath };

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    return { ok: false, reason: "file_missing", detail: err instanceof Error ? err.message : String(err) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: "file_invalid_json", detail: err instanceof Error ? err.message : String(err) };
  }

  const validated = ShortlistUniverseFileSchema.safeParse(parsed);
  if (!validated.success) {
    return { ok: false, reason: "file_invalid_schema", detail: validated.error.message };
  }

  const data = validated.data;
  if (data.zip !== zip) {
    return { ok: false, reason: "zip_mismatch", detail: `file zip "${data.zip}" !== requested "${zip}"` };
  }
  if (data.buildId !== manifest.buildId) {
    return {
      ok: false,
      reason: "build_id_mismatch",
      detail: `file buildId "${data.buildId}" !== manifest buildId "${manifest.buildId}"`,
    };
  }

  return { ok: true, data };
}

/** Test-only: reset both module caches so tests can re-read files after
 * mutating fixtures (mirrors lib/owner-cluster-geo.ts's reset convention). */
export function __resetShortlistUniverseCacheForTests(): void {
  manifestCache = undefined;
  fileCache.clear();
}

/** Test-only: point the loader at an isolated directory (e.g. an
 * mkdtempSync temp dir) instead of the real data/exports/shortlist-universe
 * path, so fail-closed tests can write malformed fixtures without ever
 * touching the real (committed, production) universe files. Pass `null` to
 * restore the real path. Always call `__resetShortlistUniverseCacheForTests`
 * after switching so stale cached reads from the previous directory don't
 * leak across tests. */
export function __setShortlistUniverseDataDirForTests(dir: string | null): void {
  dataDirOverride = dir;
}

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
