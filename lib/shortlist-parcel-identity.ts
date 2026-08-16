import "server-only";

/**
 * Server-only loader for the PRECOMPUTED County parcel identity sidecars
 * (data/exports/shortlist-universe/parcel-identity/<zip>.json + manifest.json,
 * written offline by scripts/resolve-shortlist-universe-parcels.ts).
 *
 * WHY: most universe rows publish no PIN, so today the client resolves one on
 * demand — one /api/shortlist/resolve-parcel round trip per card a reader
 * opens, and no County facts on the card face until they do. The sidecar
 * carries the SAME exact-intersection answer, computed offline, so a
 * precomputed row can join the existing load-time enrichment batch instead.
 * This loader adds NO request-time County calls: it reads committed files,
 * exactly like lib/shortlist-display-context.ts's expressway snapshot.
 *
 * FAIL CLOSED, always to an EMPTY map (never a throw, never a partial claim).
 * A missing manifest, a manifest bound to a different universe buildId, a
 * checksum that does not match the manifest, a schema violation, an
 * entry-count mismatch, or a resolved PIN that fails `normalizePin14` all
 * degrade to "no precomputed identity for this ZIP" — the card simply falls
 * back to today's on-demand resolution. A stale or half-rewritten sidecar
 * must never be able to stamp the wrong PIN on a record.
 *
 * FORWARD COMPATIBLE by construction: every schema here is a plain
 * `z.object`, which STRIPS unknown keys rather than rejecting them, so
 * additive sidecar fields (e.g. a `factsByPin` block, extra `counts` keys)
 * load fine against this build.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { normalizePin14 } from "./cook-viewer";
import { validCheckedAt } from "./site-matchmaker-parcel-resolution";
import type { DecoratedShortlistCandidate } from "./shortlist-engine";

const DATA_DIR = path.join(process.cwd(), "data", "exports", "shortlist-universe", "parcel-identity");

// Test-only override, mirroring lib/shortlist-universe.ts's — never mutated
// outside __setShortlistParcelIdentityDataDirForTests.
let dataDirOverride: string | null = null;

function resolvedDataDir(): string {
  return dataDirOverride ?? DATA_DIR;
}

export const PARCEL_IDENTITY_SCHEMA_VERSION = 1 as const;
export const PARCEL_IDENTITY_SOURCE = "cook_county_current_parcels" as const;
export const PARCEL_IDENTITY_METHOD = "exact_intersection" as const;

/** Every timestamp in a sidecar must satisfy the EXACT rule
 *  lib/site-matchmaker-parcel-resolution.ts applies to a live resolution's
 *  `checkedAt` — including the round-trip check that rejects a
 *  well-shaped-but-impossible instant like "2026-13-45T99:99:99.999Z", which
 *  a shape regex alone happily accepts — so a precomputed entry can flow
 *  into the same resolved-resolution shape with no re-validation
 *  downstream. */
const IsoInstantSchema = z.string().refine(validCheckedAt);

const ParcelIdentityEntrySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("resolved"),
    pin: z.string(),
    countyAddress: z.string().nullish(),
    checkedAt: IsoInstantSchema,
  }),
  z.object({
    status: z.literal("no_match"),
    reason: z.enum(["no_intersection", "address_mismatch"]),
    checkedAt: IsoInstantSchema,
  }),
  z.object({
    status: z.literal("ambiguous"),
    candidateCount: z.number().int().nonnegative(),
    checkedAt: IsoInstantSchema,
  }),
]);

/**
 * The precomputed CookViewer parcel facts the offline run captured for the
 * PINs it touched — the SAME four fields /api/shortlist/enrich otherwise asks
 * the County ArcGIS server for, one PIN at a time, at request time.
 */
const PrecomputedCountyParcelFactsSchema = z.object({
  countyClass: z.string().nullish(),
  lotAreaSqft: z.number().nullish(),
  assessorBuildingSqft: z.number().nullish(),
  assessorBuildingYear: z.string().nullish(),
  checkedAt: IsoInstantSchema,
});

export const ShortlistParcelIdentityFileSchema = z.object({
  schemaVersion: z.literal(PARCEL_IDENTITY_SCHEMA_VERSION),
  zip: z.string(),
  universeBuildId: z.string(),
  generatedAt: z.string(),
  source: z.literal(PARCEL_IDENTITY_SOURCE),
  matchMethod: z.literal(PARCEL_IDENTITY_METHOD),
  entries: z.record(z.string(), ParcelIdentityEntrySchema),
  // Optional AND independently fault-tolerant: a malformed facts block
  // degrades to "no precomputed facts" (those PINs simply fall back to the
  // live County lookup) rather than taking this ZIP's parcel IDENTITIES —
  // the critical path — down with it.
  factsByPin: z
    .record(z.string(), PrecomputedCountyParcelFactsSchema)
    .optional()
    .catch(undefined),
});

export const ShortlistParcelIdentityManifestSchema = z.object({
  schemaVersion: z.literal(PARCEL_IDENTITY_SCHEMA_VERSION),
  universeBuildId: z.string(),
  generatedAt: z.string(),
  files: z.record(
    z.string(),
    z.object({
      path: z.string(),
      checksum: z.string(),
      entryCount: z.number().int().nonnegative(),
    }),
  ),
});

export type ShortlistParcelIdentityFile = z.infer<typeof ShortlistParcelIdentityFileSchema>;
export type ShortlistParcelIdentityManifest = z.infer<typeof ShortlistParcelIdentityManifestSchema>;

/** One row's precomputed answer, PIN already normalized to 14 digits. */
export type ShortlistParcelIdentityEntry =
  | { status: "resolved"; pin: string; countyAddress: string | null; checkedAt: string }
  | { status: "no_match"; reason: "no_intersection" | "address_mismatch"; checkedAt: string }
  | { status: "ambiguous"; candidateCount: number; checkedAt: string };

export type ResolvedShortlistParcelIdentity = Extract<
  ShortlistParcelIdentityEntry,
  { status: "resolved" }
>;

/** One PIN's precomputed County parcel facts, normalized. */
export interface PrecomputedCountyParcelFacts {
  countyClass: string | null;
  lotAreaSqft: number | null;
  assessorBuildingSqft: number | null;
  assessorBuildingYear: string | null;
  /** When the offline run read this PIN from the County service. */
  checkedAt: string;
}

const EMPTY_ENTRIES: ReadonlyMap<string, ShortlistParcelIdentityEntry> = new Map();
const EMPTY_RESOLVED: ReadonlyMap<string, ResolvedShortlistParcelIdentity> = new Map();
const EMPTY_FACTS: ReadonlyMap<string, PrecomputedCountyParcelFacts> = new Map();

const entriesCache = new Map<string, ReadonlyMap<string, ShortlistParcelIdentityEntry>>();
const resolvedCache = new Map<string, ReadonlyMap<string, ResolvedShortlistParcelIdentity>>();
const countyFactsCache = new Map<string, ReadonlyMap<string, PrecomputedCountyParcelFacts>>();
let manifestCache: ShortlistParcelIdentityManifest | null | undefined = undefined;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function loadManifest(): ShortlistParcelIdentityManifest | null {
  if (manifestCache !== undefined) return manifestCache;
  const manifestPath = path.join(resolvedDataDir(), "manifest.json");
  try {
    if (!existsSync(manifestPath)) {
      manifestCache = null;
      return manifestCache;
    }
    const parsed = ShortlistParcelIdentityManifestSchema.safeParse(
      JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
    );
    manifestCache = parsed.success ? parsed.data : null;
  } catch {
    manifestCache = null;
  }
  return manifestCache;
}

/** True only for the buildId THIS deployment's committed manifest was built
 *  against. Every cache insert is gated on it, so a caller-supplied buildId
 *  (the enrich route reads one from the request body) can never grow a
 *  module-level map. */
function isCurrentBuildId(universeBuildId: string): boolean {
  return loadManifest()?.universeBuildId === universeBuildId;
}

/**
 * Read, checksum, and validate ONE ZIP's sidecar. `null` on every failure
 * mode — the single gate both the identity and the County-facts loaders sit
 * behind, so neither can ever read a file the other would have refused.
 */
function readSidecarFile(zip: string, universeBuildId: string): ShortlistParcelIdentityFile | null {
  const manifest = loadManifest();
  // A sidecar set built against a DIFFERENT universe is not "slightly
  // stale" — its keys are canonicalKeys from another dedup run, so a merge
  // could bind a PIN to the wrong record. Refuse the whole ZIP.
  if (!manifest || manifest.universeBuildId !== universeBuildId) return null;
  const entry = manifest.files[zip];
  if (!entry) return null;

  const filePath = path.join(resolvedDataDir(), entry.path);
  let raw: string;
  try {
    if (!existsSync(filePath)) return null;
    raw = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  // Checksum FIRST, against the raw bytes just read — a file being rewritten
  // underneath us (the precompute script checkpoints per ZIP) fails here
  // rather than on some downstream symptom.
  if (sha256(raw) !== entry.checksum) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const validated = ShortlistParcelIdentityFileSchema.safeParse(parsed);
  if (!validated.success) return null;
  const file = validated.data;
  if (file.zip !== zip) return null;
  if (file.universeBuildId !== universeBuildId) return null;
  if (Object.keys(file.entries).length !== entry.entryCount) return null;
  return file;
}

function readEntriesUncached(
  zip: string,
  universeBuildId: string,
): ReadonlyMap<string, ShortlistParcelIdentityEntry> {
  const file = readSidecarFile(zip, universeBuildId);
  if (!file) return EMPTY_ENTRIES;

  const byKey = new Map<string, ShortlistParcelIdentityEntry>();
  for (const [key, value] of Object.entries(file.entries)) {
    if (value.status !== "resolved") {
      byKey.set(key, value);
      continue;
    }
    // A resolved entry whose PIN is not a real 14-digit PIN is DROPPED, not
    // downgraded to a miss: the record simply has no precomputed identity
    // and falls back to on-demand resolution.
    const pin = normalizePin14(value.pin);
    if (!pin) continue;
    byKey.set(key, {
      status: "resolved",
      pin,
      countyAddress: value.countyAddress ?? null,
      checkedAt: value.checkedAt,
    });
  }
  return byKey;
}

/**
 * Every precomputed entry for a ZIP — resolved AND misses (no_match /
 * ambiguous) — keyed by the universe row's canonicalKey. Callers that only
 * need PINs should use `loadShortlistParcelIdentity`; this exists for
 * surfaces that want to say WHY a row has no PIN without re-running the
 * County check.
 */
export function loadShortlistParcelIdentityEntries(
  zip: string,
  universeBuildId: string,
): ReadonlyMap<string, ShortlistParcelIdentityEntry> {
  const cacheKey = `${zip}|${universeBuildId}`;
  const cached = entriesCache.get(cacheKey);
  if (cached) return cached;
  const entries = readEntriesUncached(zip, universeBuildId);
  // Never memoize an answer for a buildId this deployment's manifest does
  // not recognize — see `loadPrecomputedCountyParcelFacts` for why the cache
  // keys stay bounded to the one real build.
  if (!isCurrentBuildId(universeBuildId)) return entries;
  entriesCache.set(cacheKey, entries);
  return entries;
}

/**
 * Only the RESOLVED precomputed identities for a ZIP, keyed by canonicalKey.
 * Empty map on every failure mode (see this file's header) — callers treat a
 * missing key as "no precomputed PIN", which is exactly today's behavior.
 */
export function loadShortlistParcelIdentity(
  zip: string,
  universeBuildId: string,
): ReadonlyMap<string, ResolvedShortlistParcelIdentity> {
  const cacheKey = `${zip}|${universeBuildId}`;
  const cached = resolvedCache.get(cacheKey);
  if (cached) return cached;

  const entries = loadShortlistParcelIdentityEntries(zip, universeBuildId);
  const resolved = new Map<string, ResolvedShortlistParcelIdentity>();
  for (const [key, entry] of entries) {
    if (entry.status === "resolved") resolved.set(key, entry);
  }
  const result = resolved.size === 0 ? EMPTY_RESOLVED : resolved;
  if (!isCurrentBuildId(universeBuildId)) return result;
  resolvedCache.set(cacheKey, result);
  return result;
}

/**
 * Every PIN's precomputed County parcel facts across ALL ZIPs in the
 * manifest, merged into one map and cached per universe buildId.
 *
 * This is what lets /api/shortlist/enrich answer a ranked batch without
 * touching the County ArcGIS server at all: the offline run already read
 * class, lot area, building area, and tax year for ~every PIN the shortlist
 * can surface, and bound the whole set to a universe buildId.
 *
 * Fail-closed PER FILE, exactly like the identity loader: a ZIP whose
 * sidecar is missing, stale, tampered, or malformed is SKIPPED (its PINs
 * simply fall back to the live lookup) while every other ZIP still loads. A
 * buildId that does not match the manifest yields an empty map — which is
 * also the whole verification story for the client-supplied `buildId` on an
 * enrich request: an unrecognized one cannot select facts, it can only miss.
 */
export function loadPrecomputedCountyParcelFacts(
  universeBuildId: string,
): ReadonlyMap<string, PrecomputedCountyParcelFacts> {
  const cached = countyFactsCache.get(universeBuildId);
  if (cached) return cached;

  // The buildId reaching this function comes from a REQUEST body
  // (/api/shortlist/enrich). Caching per arbitrary caller-supplied string
  // would let anyone grow this map without bound, so a buildId that is not
  // the manifest's own is answered EMPTY and never inserted — the map holds
  // at most one entry, the real one.
  const manifest = loadManifest();
  if (!manifest || manifest.universeBuildId !== universeBuildId) return EMPTY_FACTS;

  const byPin = new Map<string, PrecomputedCountyParcelFacts>();
  for (const zip of Object.keys(manifest.files)) {
    const file = readSidecarFile(zip, universeBuildId);
    if (!file?.factsByPin) continue;
    for (const [rawPin, facts] of Object.entries(file.factsByPin)) {
      // The KEY is the identity here — a key that is not a real 14-digit PIN
      // could otherwise attach one parcel's facts to another's lookup.
      const pin = normalizePin14(rawPin);
      if (!pin) continue;
      byPin.set(pin, {
        countyClass: facts.countyClass ?? null,
        lotAreaSqft: facts.lotAreaSqft ?? null,
        assessorBuildingSqft: facts.assessorBuildingSqft ?? null,
        assessorBuildingYear: facts.assessorBuildingYear ?? null,
        checkedAt: facts.checkedAt,
      });
    }
  }
  const result = byPin.size === 0 ? EMPTY_FACTS : byPin;
  countyFactsCache.set(universeBuildId, result);
  return result;
}

/**
 * PURE. Stamp PIN provenance on an already-ranked, already-decorated slice,
 * filling in the PIN for rows the sidecar resolved.
 *
 * CONTRACT — this runs AFTER ranking and slicing and must never disturb
 * either: same length, same order, same keys, same input objects (a new
 * object is returned only for rows that actually change). It touches exactly
 * two fields, `pin` and `pinProvenance`:
 *   • a row that already publishes a usable PIN keeps it, tagged
 *     `saved_snapshot` — a precomputed entry can never overwrite a published
 *     PIN;
 *   • a row with `pin: null` and a resolved sidecar entry gets that PIN,
 *     tagged `coordinate_exact_precomputed` with the offline `checkedAt`;
 *   • anything else is returned untouched.
 */
export function applyPrecomputedParcelIdentity(
  candidates: readonly DecoratedShortlistCandidate[],
  identityByKey: ReadonlyMap<string, ResolvedShortlistParcelIdentity>,
): DecoratedShortlistCandidate[] {
  return candidates.map((candidate) => {
    if (normalizePin14(candidate.pin)) {
      return { ...candidate, pinProvenance: { source: "saved_snapshot" } };
    }
    // A non-null but unusable PIN is a data problem in the row itself, not an
    // invitation to substitute a different parcel's identity.
    if (candidate.pin != null) return candidate;
    const entry = identityByKey.get(candidate.key);
    if (!entry) return candidate;
    return {
      ...candidate,
      pin: entry.pin,
      pinProvenance: {
        source: "coordinate_exact_precomputed",
        checkedAt: entry.checkedAt,
        countyAddress: entry.countyAddress,
      },
    };
  });
}

/** Test-only: drop every cached manifest/sidecar read. */
export function __resetShortlistParcelIdentityCacheForTests(): void {
  manifestCache = undefined;
  entriesCache.clear();
  resolvedCache.clear();
  countyFactsCache.clear();
}

/** Test-only: point the loader at an isolated directory instead of the real
 *  committed data/exports path. Pass `null` to restore. Always reset the
 *  cache after switching. */
export function __setShortlistParcelIdentityDataDirForTests(dir: string | null): void {
  dataDirOverride = dir;
}
