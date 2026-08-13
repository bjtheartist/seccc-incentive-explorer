/**
 * Canonical site aggregation — the correctness fix behind PR1 of the Site
 * Shortlist overhaul (see the gpt5.6 matchmaker consult, Q1/F2). The prior
 * export took a capped, PIN-only "keep the richer row" dedupe that could
 * silently destroy conflicting land/building evidence and produced a
 * known false-zero (60621: 1,541 tracked buildings, zero building
 * sitePoints).
 *
 * This module aggregates raw tracked records (COLS City-inventory vacant
 * land, 311 vacant-building reports, and the complete assessor `parcels`
 * vacant-land series) into ONE canonical site per real-world parcel/site,
 * preserving every source's evidence rather than picking a "winner":
 *
 *   - PIN is parcel identity when present — every record sharing a PIN
 *     collapses into one canonical site.
 *   - PIN-less records (chiefly 311 building reports, which carry no PIN)
 *     collapse ONLY when their normalized address AND spatial proximity
 *     (haversine < MERGE_DISTANCE_METERS) both agree. Never merge on
 *     rounded coordinates alone — two unrelated PIN-less reports that
 *     happen to round to the same lat/lon are NOT the same site unless
 *     their addresses also match.
 *   - Records with neither a usable PIN nor a usable address never merge
 *     with anything (each stays its own singleton canonical site) — the
 *     safe default when identity cannot be established.
 *
 * Every canonical site retains: which evidence types it carries
 * (`evidenceTypes`), whether it has land and/or building evidence
 * separately (never collapsed into one boolean), per-source status/dates,
 * a measurement value chosen by documented source precedence (with the
 * winning source recorded, never silently overwritten), and explicit
 * conflict flags when sources disagree (property type, owner type) rather
 * than a silently "the richer row wins" pick.
 *
 * Pure — no DB, no fs, no network. Callers (scripts/export-shortlist-
 * universe.ts) fetch raw rows from Postgres/Socrata-derived tables, map them
 * to `RawTrackedRecord`, and call `aggregateCanonicalSites`.
 */

import { createHash } from "node:crypto";
import { haversineMeters } from "./vacancy-index";
import { toDigitsOnlyPin } from "./ingest/pin-batch";
import type { OwnerGeography, OwnerStructure } from "./owner-taxonomy";

/** Distance threshold (metres) within which two PIN-less records with a
 * matching normalized address are considered the same physical site. Chosen
 * to cover GPS/geocoding jitter for a single parcel while staying well
 * under the width of a typical Chicago lot (~7.5m x 38m), so two genuinely
 * adjacent parcels sharing a similar address are not accidentally merged. */
export const MERGE_DISTANCE_METERS = 15;

/**
 * `311_land` covers the City's "311 clean lot" citizen reports (source
 * `311_clean_lot`, DB property_type `reported_vacant_lot`) — a LAND
 * evidence type, not a building one. Getting this split right matters: an
 * earlier version of this export folded every non-COLS source into
 * "311_building", which would have silently mislabeled ~14.5k reported-
 * vacant-lot records as building evidence and corrupted the buildings/land
 * counts this whole overhaul exists to make honest.
 */
export type EvidenceType = "city_land" | "311_building" | "311_land" | "assessor_vacant_land";

/** Source authority order for picking a single measurement/owner-type value
 * when multiple sources disagree. Assessor `parcels` data is a measured,
 * PIN-matched record; COLS City-inventory is an official but coarser
 * series; 311 citizen reports (building or land) are the least reliable for
 * measurement. */
const SOURCE_PRECEDENCE: readonly EvidenceType[] = [
  "assessor_vacant_land",
  "city_land",
  "311_building",
  "311_land",
];

function precedenceRank(evidenceType: EvidenceType): number {
  const idx = SOURCE_PRECEDENCE.indexOf(evidenceType);
  return idx === -1 ? SOURCE_PRECEDENCE.length : idx;
}

/** One raw tracked record as read off a source table/query, before any
 * aggregation. `recordId` must be stable and unique within a single export
 * run (e.g. `"vacant_properties:" + id` or `"parcels:" + pin`) — it is never
 * emitted on the public universe row, only used for dedupe provenance and to
 * make the canonical key deterministic. */
export interface RawTrackedRecord {
  recordId: string;
  evidenceType: EvidenceType;
  /** Raw PIN as read from the source; normalized internally. */
  pin: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  propertyType: "vacant_land" | "vacant_building";
  status: string | null;
  /** ISO date/timestamp this record's status is as-of, when the source
   * publishes one; used to pick the most recent of repeated same-source
   * records within a group. */
  statusDate: string | null;
  lotSqft: number | null;
  buildingSqft: number | null;
  ownerType: string | null;
  /** v2 STRUCTURE/GEOGRAPHY axes, PRE-CLASSIFIED by the caller from the raw
   * taxpayer name / mailing address (lib/owner-taxonomy) BEFORE this record
   * is built — this module never sees the raw name/address itself, mirroring
   * the anonymization discipline in scripts/export-vacancy-index.ts (owner
   * name/mailing address are read only to classify, never emitted). */
  ownerStructureHint: OwnerStructure | null;
  ownerGeographyHint: OwnerGeography | null;
  incentiveCount: number | null;
  /** Source-carried zoning class, if any (e.g. vacant_properties.zoning_class).
   * Legacy/point-in-time — the universe row's authoritative `zoning` block
   * comes from the bulk zoning snapshot + local PIP (lib/zoning-snapshot.ts),
   * not from this field. Kept only for provenance/debugging. */
  legacyZoningClass: string | null;
}

/** One collapsed per-source status observation on a canonical site. */
export interface CanonicalSiteSourceStatus {
  evidenceType: EvidenceType;
  status: string | null;
  statusDate: string | null;
}

/** One canonical site: the aggregated result of one or more raw tracked
 * records that resolve to the same real-world parcel/site. */
export interface CanonicalSite {
  /** Deterministic identity, stable across export runs given the same input
   * records — `pin:<14-digit PIN>` when a PIN identity was resolved, else a
   * hash of the collapsed record ids. Used downstream as a ranking
   * tiebreaker (never as a UI-visible id). */
  canonicalKey: string;
  /** Resolved 14-digit PIN, or null when no source in this group carried one. */
  pin: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  /** Best-single resolved property type for display/screening. When both
   * land and building evidence exist (`conflictingPropertyTypes: true`),
   * building evidence wins — a report of a building on the parcel is the
   * more specific, more recent fact — but BOTH evidence booleans are still
   * carried, so no downstream consumer can lose the land evidence by only
   * reading `propertyType`. */
  propertyType: "vacant_land" | "vacant_building";
  evidenceTypes: EvidenceType[];
  hasVacantLandEvidence: boolean;
  hasVacantBuildingEvidence: boolean;
  /** True when this site has both land and building evidence — a real
   * conflict worth flagging, not silently resolved by "keep the richer
   * row". */
  conflictingPropertyTypes: boolean;
  /** One entry per distinct evidence type in this group (repeated
   * same-source records collapse to their most-recent-by-statusDate
   * observation). */
  perSourceStatus: CanonicalSiteSourceStatus[];
  lotSqft: number | null;
  lotSqftSource: EvidenceType | null;
  buildingSqft: number | null;
  buildingSqftSource: EvidenceType | null;
  ownerType: string | null;
  ownerTypeSource: EvidenceType | null;
  /** True when sources in this group carried more than one distinct
   * non-null owner type — flagged, never silently overwritten. */
  ownerTypeConflict: boolean;
  /** Pre-classified v2 axes (see RawTrackedRecord.ownerStructureHint), picked
   * by the same source precedence as ownerType. */
  ownerStructure: OwnerStructure | null;
  ownerGeography: OwnerGeography | null;
  incentiveCount: number | null;
  /** Raw record ids collapsed into this site, sorted for determinism —
   * dedupe provenance, never emitted onto the public universe row. */
  sourceRecordIds: string[];
}

export interface CanonicalSiteDedupeStats {
  sourceRecords: number;
  canonicalSites: number;
  /** sourceRecords - canonicalSites: records that collapsed into an
   * existing canonical site rather than starting a new one. */
  collapsedRecords: number;
  conflictingPropertyTypes: number;
  /** conflictingPropertyTypes OR ownerTypeConflict, deduped by site — the
   * "still needs a human/downstream decision" count. */
  unresolvedConflicts: number;
}

export interface CanonicalSiteAggregation {
  sites: CanonicalSite[];
  stats: CanonicalSiteDedupeStats;
}

function normalizePin(pin: string | null): string | null {
  if (!pin) return null;
  const digits = toDigitsOnlyPin(pin);
  return digits.length > 0 ? digits : null;
}

/** JS mirror of the repo's SQL address-normalization convention
 * (`regexp_replace(lower(coalesce(address,'')),'[^a-z0-9]','','g')`),
 * matching lib/corridor-owners.ts normalizeOwnerAddress exactly so the same
 * two addresses normalize identically whether compared in SQL or here. */
export function normalizeSiteAddress(address: string | null): string {
  return (address ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickByPrecedence<T>(
  entries: Array<{ evidenceType: EvidenceType; value: T | null }>,
): { value: T | null; source: EvidenceType | null } {
  const withValue = entries.filter((e) => e.value != null);
  if (withValue.length === 0) return { value: null, source: null };
  withValue.sort((a, b) => precedenceRank(a.evidenceType) - precedenceRank(b.evidenceType));
  return { value: withValue[0].value, source: withValue[0].evidenceType };
}

/** Deterministic canonical key for a PIN-less group: a stable hash of the
 * group's sorted record ids. Never depends on Set/Map iteration order. */
function hashRecordIds(recordIds: readonly string[]): string {
  const sorted = [...recordIds].sort();
  return createHash("sha1").update(sorted.join("|")).digest("hex").slice(0, 16);
}

/** Union-find over indices, used to cluster PIN-less records within an
 * address bucket by pairwise haversine distance. */
class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/**
 * Group PIN-less records that share a normalized address AND lie within
 * MERGE_DISTANCE_METERS of at least one other record already in the same
 * emerging group (chained clustering, not just pairwise-to-the-first
 * record — a chain of nearby points along one address all merge together).
 * Records lacking either a usable normalized address or a coordinate never
 * merge with anything (each returned as its own singleton group) — spatial
 * proximity cannot be verified without a coordinate, and "rounded
 * coordinates alone" is explicitly disallowed as a merge signal, so an
 * address match with no coordinate to confirm it is treated the same way:
 * not a confirmed merge.
 */
function groupPinlessRecords(records: RawTrackedRecord[]): RawTrackedRecord[][] {
  const buckets = new Map<string, { record: RawTrackedRecord; idx: number }[]>();
  const singletons: RawTrackedRecord[][] = [];

  records.forEach((record, idx) => {
    const normAddress = normalizeSiteAddress(record.address);
    if (!normAddress) {
      singletons.push([record]);
      return;
    }
    const bucket = buckets.get(normAddress);
    if (bucket) bucket.push({ record, idx });
    else buckets.set(normAddress, [{ record, idx }]);
  });

  const groups: RawTrackedRecord[][] = [...singletons];

  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      groups.push([bucket[0].record]);
      continue;
    }
    const uf = new UnionFind(bucket.length);
    for (let i = 0; i < bucket.length; i++) {
      const a = bucket[i].record;
      if (a.lat == null || a.lon == null) continue; // no coordinate -> cannot confirm proximity
      for (let j = i + 1; j < bucket.length; j++) {
        const b = bucket[j].record;
        if (b.lat == null || b.lon == null) continue;
        if (haversineMeters(a.lat, a.lon, b.lat, b.lon) < MERGE_DISTANCE_METERS) {
          uf.union(i, j);
        }
      }
    }
    const byRoot = new Map<number, RawTrackedRecord[]>();
    bucket.forEach((entry, i) => {
      const root = uf.find(i);
      const arr = byRoot.get(root);
      if (arr) arr.push(entry.record);
      else byRoot.set(root, [entry.record]);
    });
    groups.push(...byRoot.values());
  }

  return groups;
}

function buildCanonicalSite(recordsInGroup: RawTrackedRecord[], resolvedPin: string | null): CanonicalSite {
  const sourceRecordIds = [...recordsInGroup.map((r) => r.recordId)].sort();

  const evidenceTypes = [...new Set(recordsInGroup.map((r) => r.evidenceType))].sort();
  const hasVacantLandEvidence = recordsInGroup.some((r) => r.propertyType === "vacant_land");
  const hasVacantBuildingEvidence = recordsInGroup.some((r) => r.propertyType === "vacant_building");
  const conflictingPropertyTypes = hasVacantLandEvidence && hasVacantBuildingEvidence;
  const propertyType: "vacant_land" | "vacant_building" = hasVacantBuildingEvidence
    ? "vacant_building"
    : "vacant_land";

  // Collapse repeated same-source records to their most-recent-by-statusDate
  // observation (string ISO compare — later date sorts greater).
  const perSourceStatus: CanonicalSiteSourceStatus[] = [];
  for (const evidenceType of evidenceTypes) {
    const sameSource = recordsInGroup.filter((r) => r.evidenceType === evidenceType);
    const latest = sameSource.reduce((best, r) =>
      (r.statusDate ?? "") > (best.statusDate ?? "") ? r : best,
    sameSource[0]);
    perSourceStatus.push({ evidenceType, status: latest.status, statusDate: latest.statusDate });
  }

  const { value: lotSqft, source: lotSqftSource } = pickByPrecedence(
    recordsInGroup.map((r) => ({ evidenceType: r.evidenceType, value: r.lotSqft })),
  );
  const { value: buildingSqft, source: buildingSqftSource } = pickByPrecedence(
    recordsInGroup.map((r) => ({ evidenceType: r.evidenceType, value: r.buildingSqft })),
  );
  const { value: ownerType, source: ownerTypeSource } = pickByPrecedence(
    recordsInGroup.map((r) => ({ evidenceType: r.evidenceType, value: r.ownerType })),
  );
  const distinctOwnerTypes = new Set(
    recordsInGroup.map((r) => r.ownerType).filter((v): v is string => v != null),
  );
  const ownerTypeConflict = distinctOwnerTypes.size > 1;

  const { value: ownerStructure } = pickByPrecedence(
    recordsInGroup.map((r) => ({ evidenceType: r.evidenceType, value: r.ownerStructureHint })),
  );
  const { value: ownerGeography } = pickByPrecedence(
    recordsInGroup.map((r) => ({ evidenceType: r.evidenceType, value: r.ownerGeographyHint })),
  );

  const { value: address } = pickByPrecedence(
    recordsInGroup.map((r) => ({ evidenceType: r.evidenceType, value: r.address })),
  );
  const { value: lat } = pickByPrecedence(
    recordsInGroup.map((r) => ({ evidenceType: r.evidenceType, value: r.lat })),
  );
  const { value: lon } = pickByPrecedence(
    recordsInGroup.map((r) => ({ evidenceType: r.evidenceType, value: r.lon })),
  );
  const incentiveCount = recordsInGroup.reduce<number | null>((max, r) => {
    if (r.incentiveCount == null) return max;
    return max == null ? r.incentiveCount : Math.max(max, r.incentiveCount);
  }, null);

  const canonicalKey = resolvedPin ? `pin:${resolvedPin}` : `site:${hashRecordIds(sourceRecordIds)}`;

  return {
    canonicalKey,
    pin: resolvedPin,
    address,
    lat,
    lon,
    propertyType,
    evidenceTypes,
    hasVacantLandEvidence,
    hasVacantBuildingEvidence,
    conflictingPropertyTypes,
    perSourceStatus,
    lotSqft,
    lotSqftSource,
    buildingSqft,
    buildingSqftSource,
    ownerType,
    ownerTypeSource,
    ownerTypeConflict,
    ownerStructure,
    ownerGeography,
    incentiveCount,
    sourceRecordIds,
  };
}

/**
 * Aggregate raw tracked records into canonical sites. See the module header
 * for the full merge doctrine. Deterministic: the same input array (in any
 * order) always produces the same set of canonical sites with the same
 * canonicalKeys, because grouping keys off PIN/address/id rather than array
 * position, and every downstream array is explicitly sorted before use.
 */
export function aggregateCanonicalSites(records: readonly RawTrackedRecord[]): CanonicalSiteAggregation {
  const pinGroups = new Map<string, RawTrackedRecord[]>();
  const pinlessRecords: RawTrackedRecord[] = [];

  for (const record of records) {
    const pin = normalizePin(record.pin);
    if (pin) {
      const group = pinGroups.get(pin);
      if (group) group.push(record);
      else pinGroups.set(pin, [record]);
    } else {
      pinlessRecords.push(record);
    }
  }

  const sites: CanonicalSite[] = [];

  // Deterministic iteration order: sort PINs before building sites.
  for (const pin of [...pinGroups.keys()].sort()) {
    sites.push(buildCanonicalSite(pinGroups.get(pin)!, pin));
  }

  const pinlessGroups = groupPinlessRecords(pinlessRecords);
  for (const group of pinlessGroups) {
    sites.push(buildCanonicalSite(group, null));
  }

  // Final deterministic order: canonicalKey ascending. Downstream ranking
  // (PR2) re-sorts by score with canonicalKey as the tiebreaker; this
  // module's own output order must itself be stable across runs.
  sites.sort((a, b) => (a.canonicalKey < b.canonicalKey ? -1 : a.canonicalKey > b.canonicalKey ? 1 : 0));

  const conflictingPropertyTypes = sites.filter((s) => s.conflictingPropertyTypes).length;
  const unresolvedConflicts = sites.filter((s) => s.conflictingPropertyTypes || s.ownerTypeConflict).length;

  return {
    sites,
    stats: {
      sourceRecords: records.length,
      canonicalSites: sites.length,
      collapsedRecords: records.length - sites.length,
      conflictingPropertyTypes,
      unresolvedConflicts,
    },
  };
}

/** Duplicate-canonical-key check — the test-enforced invariant from the PR1
 * spec ("zero exact-duplicate canonical rows"). Returns the offending keys,
 * empty when clean. */
export function findDuplicateCanonicalKeys(sites: readonly CanonicalSite[]): string[] {
  const seen = new Map<string, number>();
  for (const site of sites) {
    seen.set(site.canonicalKey, (seen.get(site.canonicalKey) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}
