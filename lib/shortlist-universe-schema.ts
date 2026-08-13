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

import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * v2 (PR2 adversarial-review fix round): adds `counts.sourceRecordsByEvidenceType`
 * (the RAW, pre-dedup record tally the zero-result funnel needs to show
 * actual deduplication — see Finding 6) and gives every overlay membership
 * an optional name (Finding 12) instead of a bare boolean. Both are additive
 * to the row/file shape but the schema version still bumps because the
 * envelope's `counts` and `overlays` shapes changed — an old v1 file must
 * fail closed (zod literal mismatch) rather than parse with `undefined`
 * holes the loader/engine would otherwise have to guess about.
 */
export const SHORTLIST_UNIVERSE_SCHEMA_VERSION = 2 as const;
/**
 * Bumped alongside the schema version because the ranking ALGORITHM itself
 * changed in this same round (Finding 1: baseline scoring removed; Finding
 * 3: footprint screening now resolves area from the REQUESTED property type;
 * Finding 9: PMD gets its own neutral badge). lib/shortlist-engine.ts's
 * `RANKING_MODEL_VERSION` is cross-checked against this at load time — see
 * that file and Finding 5's separate `sm_rv` request-level version, which is
 * a distinct concern (is this URL's ranking semantics current) from this one
 * (is this DATA FILE's ranking inputs the shape the engine expects).
 */
export const RANKING_INPUTS_VERSION = 2 as const;

// ── Envelope schema ─────────────────────────────────────────────────────────

const EvidenceTypeSchema = z.enum(["city_land", "311_building", "311_land", "assessor_vacant_land"]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

const SourceVintageSchema = z.object({
  vintage: z.string(),
  checksum: z.string(),
});

/** Raw, PRE-DEDUP source-record tally by evidence type — distinct from
 * `canonicalSites`/`buildings`/`land`, which count post-dedup canonical
 * rows. This is what lets the zero-result funnel show actual deduplication
 * (Finding 6): e.g. 60621 carrying far more raw `311_building` reports than
 * canonical building sites, because many reports collapse onto the same
 * physical site. Keys mirror EvidenceTypeSchema exactly (enforced by the
 * `.strict()` shape below via an explicit test, since zod's z.record does
 * not itself constrain string keys to an enum). */
const SourceRecordsByEvidenceTypeSchema = z.object({
  city_land: z.number().int().nonnegative(),
  "311_building": z.number().int().nonnegative(),
  "311_land": z.number().int().nonnegative(),
  assessor_vacant_land: z.number().int().nonnegative(),
});

const CountsSchema = z.object({
  sourceRecords: z.number().int().nonnegative(),
  sourceRecordsByEvidenceType: SourceRecordsByEvidenceTypeSchema,
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

/** One overlay layer's membership for a site: whether it's mapped at all,
 * and — when it is — the feature's own name (Finding 12). `name` is
 * `null` both when `present` is false AND when the source geometry
 * carries no name for a present match (an unnamed feature is a real,
 * honest state, never coerced to a placeholder string). */
const OverlayMembershipSchema = z.object({
  present: z.boolean(),
  name: z.string().nullable(),
});

const RowOverlaysSchema = z.object({
  ssa: OverlayMembershipSchema,
  ccsa: OverlayMembershipSchema,
  tif: OverlayMembershipSchema,
  nof: OverlayMembershipSchema,
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
  // sourceRecordsByEvidenceType must sum to sourceRecords — the raw tally
  // (Finding 6) is only trustworthy for the funnel if it is itself internally
  // consistent, not just present.
  const evidenceTypeSum =
    file.counts.sourceRecordsByEvidenceType.city_land +
    file.counts.sourceRecordsByEvidenceType["311_building"] +
    file.counts.sourceRecordsByEvidenceType["311_land"] +
    file.counts.sourceRecordsByEvidenceType.assessor_vacant_land;
  if (evidenceTypeSum !== file.counts.sourceRecords) {
    issues.push(
      `counts.sourceRecordsByEvidenceType sums to ${evidenceTypeSum} !== counts.sourceRecords (${file.counts.sourceRecords})`,
    );
  }
  const dupKeys = new Map<string, number>();
  for (const row of rows) dupKeys.set(row.canonicalKey, (dupKeys.get(row.canonicalKey) ?? 0) + 1);
  const duplicates = [...dupKeys.entries()].filter(([, n]) => n > 1);
  if (duplicates.length > 0) {
    issues.push(`duplicate canonicalKeys: ${duplicates.map(([k]) => k).join(", ")}`);
  }

  return issues;
}

/**
 * The checksum both the export script and the runtime loader compute, over
 * the EXACT raw bytes written to / read from disk — never a re-serialization
 * of the parsed object, which could silently diverge on key order or
 * whitespace. This is what makes the manifest's per-file checksum a real
 * tamper/truncation guard (Finding 7) rather than decoration: the loader
 * hashes the same string it just read and fails closed on any mismatch.
 */
export function shortlistUniverseChecksum(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
