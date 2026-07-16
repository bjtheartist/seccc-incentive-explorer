import type { NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Owner & Operator cluster computation for corridor reports.
 *
 * Shared by app/api/corridor/owners/route.ts (live query, refresh branches)
 * and scripts/export-corridor-owners.ts (static export, corridor-metrics
 * doctrine: refreshes run on disposable Neon branches → export → drop
 * branch; prod DB holds no parcel/ownership data by design).
 */

/**
 * MVP distress overlay (Phase 2 populates the rest — see 22u3-xenr, ydgz-vkrp,
 * 55ju-2fs9, CCLBA in the plan). Only `buildingViolationCount` is computed
 * today, by joining the already-ingested `building_violations` table
 * (lib/ingest/violations.ts) by normalized address, the same technique this
 * file already uses to link business licenses. Every other field is a
 * literal `null` — never a silent zero — until its adapter ships. `null`
 * always means "not yet available," while `buildingViolationCount: 0` is a
 * real, confirmed zero once the join could run.
 */
export interface OwnerClusterDistressSignals {
  buildingViolationCount: number | null;
  vacantBuildingViolationCount: number | null;
  delinquentTaxCount: number | null;
  scavengerOrAnnualSaleFlag: boolean | null;
  cclbaInventoryFlag: boolean | null;
}

export const EMPTY_DISTRESS_SIGNALS: OwnerClusterDistressSignals = {
  buildingViolationCount: null,
  vacantBuildingViolationCount: null,
  delinquentTaxCount: null,
  scavengerOrAnnualSaleFlag: null,
  cclbaInventoryFlag: null,
};

export interface OwnerCluster {
  clusterKey: string;
  /**
   * Durable per-parcel PIN list for this cluster (array_agg(DISTINCT pin)).
   * clusterKey is a hash of normalized owner-mailing/name text and can drift
   * across refreshes (an assessor spelling change silently orphans human
   * verification work); pins[] is the stable join key the human layer
   * (lib/owner-file.ts) snapshots onto every verification row.
   */
  pins: string[];
  ownerName: string | null;
  ownerMailingAddress: string | null;
  ownerType: string | null;
  parcelCount: number;
  vacantParcelCount: number;
  businessCount: number;
  businessNames: string[];
  sampleAddresses: string[];
  latestTransferDate: string | null;
  latestBuyerName: string | null;
  latestSellerName: string | null;
  confidence: string;
  evidence: string;
  distressSignals: OwnerClusterDistressSignals;
}

interface OwnerClusterRow {
  cluster_key: string;
  pins: string[] | null;
  owner_name: string | null;
  owner_mailing_address: string | null;
  owner_type: string | null;
  parcel_count: number | string;
  vacant_parcel_count: number | string;
  sample_addresses: string[] | null;
  norm_addresses: string[] | null;
  norm_owners: string[] | null;
  latest_transfer_date: string | null;
  latest_buyer_name: string | null;
  latest_seller_name: string | null;
  confidence: string;
  evidence: string;
}

interface LicenseRow {
  license_id: string;
  legal_name: string | null;
  dba_name: string | null;
  norm_address: string | null;
  norm_legal: string | null;
}

function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function serialize(
  row: OwnerClusterRow,
  businessNames: string[],
  distressSignals: OwnerClusterDistressSignals
): OwnerCluster {
  const evidenceParts = [
    row.evidence,
    businessNames.length > 0 ? "linked to business licenses by site address/name" : "",
  ].filter(Boolean);

  return {
    clusterKey: row.cluster_key,
    pins: row.pins ?? [],
    ownerName: row.owner_name,
    ownerMailingAddress: row.owner_mailing_address,
    ownerType: row.owner_type,
    parcelCount: toNumber(row.parcel_count),
    vacantParcelCount: toNumber(row.vacant_parcel_count),
    businessCount: businessNames.length,
    businessNames,
    sampleAddresses: row.sample_addresses ?? [],
    latestTransferDate: row.latest_transfer_date,
    latestBuyerName: row.latest_buyer_name,
    latestSellerName: row.latest_seller_name,
    confidence: row.confidence,
    evidence: evidenceParts.join("; "),
    distressSignals,
  };
}

/**
 * Building-violation count for a cluster: sum of counts across the cluster's
 * normalized site addresses. `violationCountsByAddress === null` means the
 * join could not run at all (e.g. `building_violations` not migrated on this
 * branch yet) — that degrades to `null` ("not yet available"), never a
 * silent 0. An empty/no-match result once the join DID run is a real 0.
 */
export function buildingViolationCountForCluster(
  normAddresses: string[] | null | undefined,
  violationCountsByAddress: Map<string, number> | null
): number | null {
  if (violationCountsByAddress === null) return null;
  if (!normAddresses || normAddresses.length === 0) return 0;
  let total = 0;
  for (const addr of normAddresses) {
    total += violationCountsByAddress.get(addr) ?? 0;
  }
  return total;
}

/** Normalize a static-export or DB-fallback distress-signals value, defaulting every field to null. */
export function normalizeDistressSignals(value: unknown): OwnerClusterDistressSignals {
  if (!value || typeof value !== "object") return { ...EMPTY_DISTRESS_SIGNALS };
  const raw = value as Partial<Record<keyof OwnerClusterDistressSignals, unknown>>;
  return {
    buildingViolationCount:
      typeof raw.buildingViolationCount === "number" ? raw.buildingViolationCount : null,
    vacantBuildingViolationCount:
      typeof raw.vacantBuildingViolationCount === "number" ? raw.vacantBuildingViolationCount : null,
    delinquentTaxCount: typeof raw.delinquentTaxCount === "number" ? raw.delinquentTaxCount : null,
    scavengerOrAnnualSaleFlag:
      typeof raw.scavengerOrAnnualSaleFlag === "boolean" ? raw.scavengerOrAnnualSaleFlag : null,
    cclbaInventoryFlag: typeof raw.cclbaInventoryFlag === "boolean" ? raw.cclbaInventoryFlag : null,
  };
}

/**
 * Cluster parcels for a ZIP by recorded owner mailing address (fallback:
 * owner name), attach the latest transfer per cluster, and link business
 * licenses by normalized site address / legal name.
 *
 * Requires the parcels/transfers/business migrations (parcels.zip exists
 * only after migrate-parcels.ts step 3b).
 */
export async function fetchOwnerClusters(
  sql: NeonQueryFunction<false, false>,
  zip: string,
  limit: number
): Promise<OwnerCluster[]> {
  const rows = (await sql`
    WITH parcel_base AS (
      SELECT
        pin,
        address,
        owner_name,
        owner_mailing_address,
        owner_type,
        is_vacant,
        geom,
        regexp_replace(lower(coalesce(owner_mailing_address, '')), '[^a-z0-9]', '', 'g') AS norm_mailing,
        regexp_replace(lower(coalesce(owner_name, '')), '[^a-z0-9]', '', 'g') AS norm_owner,
        regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') AS norm_address
      FROM parcels
      WHERE zip = ${zip}
         OR raw_json->>'zip_code' = ${zip}
         OR address ILIKE ${"%" + zip + "%"}
    ),
    clustered_parcels AS (
      SELECT
        *,
        CASE
          WHEN norm_mailing <> '' THEN 'mail:' || norm_mailing
          WHEN norm_owner <> '' THEN 'owner:' || norm_owner
          ELSE 'pin:' || pin
        END AS cluster_key
      FROM parcel_base
      WHERE coalesce(owner_name, owner_mailing_address, pin) IS NOT NULL
    ),
    parcel_clusters AS (
      SELECT
        cluster_key,
        MIN(NULLIF(owner_name, '')) AS owner_name,
        MIN(NULLIF(owner_mailing_address, '')) AS owner_mailing_address,
        MIN(NULLIF(owner_type, '')) AS owner_type,
        COUNT(*) AS parcel_count,
        COUNT(*) FILTER (WHERE is_vacant IS TRUE) AS vacant_parcel_count,
        array_remove(array_agg(DISTINCT NULLIF(pin, '')), NULL) AS pins,
        (array_remove(array_agg(DISTINCT NULLIF(address, '')), NULL))[1:5] AS sample_addresses,
        array_remove(array_agg(DISTINCT NULLIF(norm_address, '')), NULL) AS norm_addresses,
        array_remove(array_agg(DISTINCT NULLIF(norm_owner, '')), NULL) AS norm_owners,
        BOOL_OR(norm_mailing <> '') AS has_mailing_match,
        BOOL_OR(norm_owner <> '') AS has_owner_name_match
      FROM clustered_parcels
      GROUP BY cluster_key
    ),
    top_clusters AS (
      SELECT *
      FROM parcel_clusters
      ORDER BY vacant_parcel_count DESC, parcel_count DESC
      LIMIT ${limit}
    ),
    cluster_transfers AS (
      SELECT DISTINCT ON (cp.cluster_key)
        cp.cluster_key,
        pt.recorded_date AS latest_transfer_date,
        pt.buyer_name AS latest_buyer_name,
        pt.seller_name AS latest_seller_name
      FROM top_clusters tc
      JOIN clustered_parcels cp ON cp.cluster_key = tc.cluster_key
      JOIN property_transfers pt ON pt.pin = cp.pin
      WHERE pt.recorded_date IS NOT NULL
      ORDER BY cp.cluster_key, pt.recorded_date DESC
    )
    SELECT
      pc.cluster_key,
      coalesce(pc.pins, ARRAY[]::TEXT[]) AS pins,
      pc.owner_name,
      pc.owner_mailing_address,
      pc.owner_type,
      pc.parcel_count,
      pc.vacant_parcel_count,
      coalesce(pc.sample_addresses, ARRAY[]::TEXT[]) AS sample_addresses,
      coalesce(pc.norm_addresses, ARRAY[]::TEXT[]) AS norm_addresses,
      coalesce(pc.norm_owners, ARRAY[]::TEXT[]) AS norm_owners,
      ct.latest_transfer_date,
      ct.latest_buyer_name,
      ct.latest_seller_name,
      CASE
        WHEN pc.has_mailing_match AND pc.parcel_count > 1 THEN 'High'
        WHEN pc.has_mailing_match THEN 'Medium'
        WHEN pc.has_owner_name_match AND pc.parcel_count > 1 THEN 'Medium'
        ELSE 'Low'
      END AS confidence,
      trim(both '; ' from concat_ws('; ',
        CASE WHEN pc.has_mailing_match THEN 'grouped by recorded owner mailing address' END,
        CASE WHEN NOT pc.has_mailing_match AND pc.has_owner_name_match THEN 'grouped by recorded owner name' END,
        CASE WHEN ct.latest_transfer_date IS NOT NULL THEN 'recent transfer record attached by PIN' END
      )) AS evidence
    FROM top_clusters pc
    LEFT JOIN cluster_transfers ct ON ct.cluster_key = pc.cluster_key
    ORDER BY pc.vacant_parcel_count DESC, pc.parcel_count DESC
  `) as OwnerClusterRow[];

  const licenses = (await sql`
    SELECT
      license_id,
      legal_name,
      dba_name,
      regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') AS norm_address,
      regexp_replace(lower(coalesce(legal_name, '')), '[^a-z0-9]', '', 'g') AS norm_legal
    FROM business_licenses
    WHERE zip = ${zip}
  `) as LicenseRow[];

  const licensesByAddress = new Map<string, Set<string>>();
  const licensesByLegal = new Map<string, Set<string>>();
  for (const license of licenses) {
    const label = license.dba_name || license.legal_name || license.license_id;
    if (license.norm_address) {
      if (!licensesByAddress.has(license.norm_address)) licensesByAddress.set(license.norm_address, new Set());
      licensesByAddress.get(license.norm_address)!.add(label);
    }
    if (license.norm_legal) {
      if (!licensesByLegal.has(license.norm_legal)) licensesByLegal.set(license.norm_legal, new Set());
      licensesByLegal.get(license.norm_legal)!.add(label);
    }
  }

  // MVP distress overlay: building-violation counts joined by the same
  // normalized-address technique as the license linking above. Degrades to
  // `null` (never a silent 0) when building_violations isn't migrated yet on
  // this branch — see buildingViolationCountForCluster.
  let violationCountsByAddress: Map<string, number> | null = null;
  try {
    const violationRows = (await sql`
      SELECT regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') AS norm_address
      FROM building_violations
      WHERE address IS NOT NULL AND address <> ''
    `) as { norm_address: string }[];
    violationCountsByAddress = new Map();
    for (const violation of violationRows) {
      if (!violation.norm_address) continue;
      violationCountsByAddress.set(
        violation.norm_address,
        (violationCountsByAddress.get(violation.norm_address) ?? 0) + 1
      );
    }
  } catch (err) {
    console.warn(
      "fetchOwnerClusters: building_violations join unavailable (table likely not migrated on this branch):",
      err instanceof Error ? err.message : err
    );
    violationCountsByAddress = null;
  }

  return rows.map((row) => {
    const names = new Set<string>();
    for (const key of row.norm_addresses ?? []) {
      for (const name of licensesByAddress.get(key) ?? []) names.add(name);
    }
    for (const key of row.norm_owners ?? []) {
      for (const name of licensesByLegal.get(key) ?? []) names.add(name);
    }
    const distressSignals: OwnerClusterDistressSignals = {
      ...EMPTY_DISTRESS_SIGNALS,
      buildingViolationCount: buildingViolationCountForCluster(row.norm_addresses, violationCountsByAddress),
    };
    return serialize(row, Array.from(names).slice(0, 5), distressSignals);
  });
}

export interface OwnerClustersExport {
  generatedAt: string;
  zips: Record<string, OwnerCluster[]>;
}

/**
 * Backward compatibility: normalizes a cluster loaded from the committed
 * static export (or any older snapshot) that predates `pins[]`/
 * `distressSignals` — defaults `pins` to `[]` and every distress-signal
 * field to `null` rather than leaving them `undefined`.
 */
function normalizeLoadedCluster(raw: unknown): OwnerCluster {
  const cluster = (raw ?? {}) as Partial<OwnerCluster> & Record<string, unknown>;
  return {
    ...(cluster as OwnerCluster),
    pins: Array.isArray(cluster.pins) ? (cluster.pins as string[]) : [],
    distressSignals: normalizeDistressSignals(cluster.distressSignals),
  };
}

/**
 * Load the committed static export if present (optional file — returns null
 * for a ZIP outside the export or when the file has not been generated).
 * Same lazy-require pattern as loadStaticCorridorMetrics in report-engine.ts.
 */
export function loadStaticOwnerClusters(zip: string, limit: number): OwnerCluster[] | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("../public/data/corridor-owners.json") as OwnerClustersExport;
    const clusters = raw?.zips?.[zip];
    if (!Array.isArray(clusters)) return null;
    return clusters.slice(0, limit).map(normalizeLoadedCluster);
  } catch {
    return null;
  }
}

/**
 * The static export's `generatedAt` stamp (when the refresh branch that
 * produced public/data/corridor-owners.json ran). Used by the Owner File
 * verification write path to snapshot `export_generated_at` — the basis for
 * a "verified against an older snapshot" banner (plan risk #1).
 */
export function loadStaticOwnerClustersGeneratedAt(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("../public/data/corridor-owners.json") as OwnerClustersExport;
    return typeof raw?.generatedAt === "string" ? raw.generatedAt : null;
  } catch {
    return null;
  }
}
