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
 * Distress overlay. Phase 1 shipped `buildingViolationCount`. Phase 2 adds
 * `vacantBuildingViolationCount` (joined from `vacant_building_violations`,
 * u7si-yh3t, by normalized address — same technique as buildingViolationCount)
 * and `scavengerOrAnnualSaleFlag` (joined from `scavenger_sale_entries` /
 * `annual_tax_sale_entries`, ydgz-vkrp / 55ju-2fs9, by PIN). `delinquentTaxCount`
 * and `cclbaInventoryFlag` stay a literal `null` — never a silent zero —
 * until their manual-import sources ship (Cook County Clerk delinquency
 * file; CCLBA inventory snapshot; neither publishes a public API). `null`
 * always means "not yet available," while `0`/`false` is a real, confirmed
 * value once the join could run.
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
  /**
   * Richer copy alongside `distressSignals.scavengerOrAnnualSaleFlag`: the
   * most recent `tax_sale_year` across any cluster-pin match in either
   * scavenger or annual tax-sale table, and how many of those matched
   * entries were actually `sold_at_sale`. Optional (like `pins[]` was) so
   * older committed exports and existing fixtures/tests that predate this
   * field keep type-checking — normalizeLoadedCluster defaults both to
   * `null` when loading an export that doesn't carry them.
   */
  latestTaxSaleYear?: number | null;
  taxSaleSoldCount?: number | null;
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

/**
 * JS-side mirror of the SQL address-normalization convention this file uses
 * for cluster/business-license matching
 * (`regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g')`) —
 * lowercase, strip everything but letters/digits. Used where the match has
 * to happen in TypeScript instead of a query (e.g.
 * lib/owner-file-report-context.ts matching a report address against the
 * admin-only per-parcel geo export).
 */
export function normalizeOwnerAddress(address: string | null | undefined): string {
  return (address ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function serialize(
  row: OwnerClusterRow,
  businessNames: string[],
  distressSignals: OwnerClusterDistressSignals,
  taxSaleSignals: { latestTaxSaleYear: number | null; taxSaleSoldCount: number | null }
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
    latestTaxSaleYear: taxSaleSignals.latestTaxSaleYear,
    taxSaleSoldCount: taxSaleSignals.taxSaleSoldCount,
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

export interface TaxSaleEntrySummary {
  years: number[];
  soldCount: number;
}

/**
 * Tax-sale exposure for a cluster: true when ANY of the cluster's PINs
 * appears in `saleEntriesByPin` (built from `scavenger_sale_entries` +
 * `annual_tax_sale_entries` combined), plus the richer-copy fields —
 * `latestTaxSaleYear` (max `tax_sale_year` across matched entries) and
 * `taxSaleSoldCount` (how many of the matched entries were actually
 * `sold_at_sale`, a stronger signal than merely being listed).
 *
 * `saleEntriesByPin === null` means the join could not run at all (tables
 * not migrated on this branch yet) — degrades every field to `null`, never
 * a silent `false`/`0`. Once the join DID run, a real no-match cluster gets
 * `flag: false`, `latestTaxSaleYear: null`, `taxSaleSoldCount: 0` — a
 * confirmed "no exposure found," not "pending."
 */
export function taxSaleSignalsForCluster(
  pins: string[] | null | undefined,
  saleEntriesByPin: Map<string, TaxSaleEntrySummary> | null
): { flag: boolean | null; latestTaxSaleYear: number | null; taxSaleSoldCount: number | null } {
  if (saleEntriesByPin === null) return { flag: null, latestTaxSaleYear: null, taxSaleSoldCount: null };
  if (!pins || pins.length === 0) return { flag: false, latestTaxSaleYear: null, taxSaleSoldCount: 0 };

  let matched = false;
  let latestTaxSaleYear: number | null = null;
  let taxSaleSoldCount = 0;
  for (const pin of pins) {
    const entry = saleEntriesByPin.get(pin);
    if (!entry) continue;
    matched = true;
    taxSaleSoldCount += entry.soldCount;
    for (const year of entry.years) {
      if (latestTaxSaleYear === null || year > latestTaxSaleYear) latestTaxSaleYear = year;
    }
  }
  return { flag: matched, latestTaxSaleYear, taxSaleSoldCount };
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

  // Phase 2: vacant-building-violation counts, same normalized-address
  // technique/degradation as building_violations above (see
  // buildingViolationCountForCluster — reused directly, the logic doesn't
  // care which violation table the counts came from).
  let vacantViolationCountsByAddress: Map<string, number> | null = null;
  try {
    const vacantViolationRows = (await sql`
      SELECT regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') AS norm_address
      FROM vacant_building_violations
      WHERE address IS NOT NULL AND address <> ''
    `) as { norm_address: string }[];
    vacantViolationCountsByAddress = new Map();
    for (const violation of vacantViolationRows) {
      if (!violation.norm_address) continue;
      vacantViolationCountsByAddress.set(
        violation.norm_address,
        (vacantViolationCountsByAddress.get(violation.norm_address) ?? 0) + 1
      );
    }
  } catch (err) {
    console.warn(
      "fetchOwnerClusters: vacant_building_violations join unavailable (table likely not migrated on this branch):",
      err instanceof Error ? err.message : err
    );
    vacantViolationCountsByAddress = null;
  }

  // Phase 2: scavenger/annual tax-sale exposure, joined by PIN (both tables
  // are PIN-keyed with no ZIP/address column upstream — see
  // lib/ingest/scavenger-sale.ts and lib/ingest/annual-tax-sale.ts). Combined
  // into one pin -> {years, soldCount} map so a PIN's exposure counts
  // regardless of which sale table it came from. Degrades to `null` (never a
  // silent false/0) when either table isn't migrated yet on this branch.
  let saleEntriesByPin: Map<string, TaxSaleEntrySummary> | null = null;
  try {
    type SaleEntryRow = { pin: string; tax_sale_year: number | string | null; sold_at_sale: boolean | null };
    const scavengerRows = (await sql`
      SELECT pin, tax_sale_year, sold_at_sale
      FROM scavenger_sale_entries
      WHERE pin IS NOT NULL AND pin <> ''
    `) as SaleEntryRow[];
    const annualRows = (await sql`
      SELECT pin, tax_sale_year, sold_at_sale
      FROM annual_tax_sale_entries
      WHERE pin IS NOT NULL AND pin <> ''
    `) as SaleEntryRow[];
    saleEntriesByPin = new Map();
    for (const entry of [...scavengerRows, ...annualRows]) {
      const summary = saleEntriesByPin.get(entry.pin) ?? { years: [], soldCount: 0 };
      if (entry.tax_sale_year != null) {
        const year = Number(entry.tax_sale_year);
        if (Number.isFinite(year)) summary.years.push(year);
      }
      if (entry.sold_at_sale === true) summary.soldCount += 1;
      saleEntriesByPin.set(entry.pin, summary);
    }
  } catch (err) {
    console.warn(
      "fetchOwnerClusters: scavenger/annual tax-sale join unavailable (tables likely not migrated on this branch):",
      err instanceof Error ? err.message : err
    );
    saleEntriesByPin = null;
  }

  return rows.map((row) => {
    const names = new Set<string>();
    for (const key of row.norm_addresses ?? []) {
      for (const name of licensesByAddress.get(key) ?? []) names.add(name);
    }
    for (const key of row.norm_owners ?? []) {
      for (const name of licensesByLegal.get(key) ?? []) names.add(name);
    }
    const taxSale = taxSaleSignalsForCluster(row.pins, saleEntriesByPin);
    const distressSignals: OwnerClusterDistressSignals = {
      ...EMPTY_DISTRESS_SIGNALS,
      buildingViolationCount: buildingViolationCountForCluster(row.norm_addresses, violationCountsByAddress),
      vacantBuildingViolationCount: buildingViolationCountForCluster(row.norm_addresses, vacantViolationCountsByAddress),
      scavengerOrAnnualSaleFlag: taxSale.flag,
    };
    return serialize(row, Array.from(names).slice(0, 5), distressSignals, {
      latestTaxSaleYear: taxSale.latestTaxSaleYear,
      taxSaleSoldCount: taxSale.taxSaleSoldCount,
    });
  });
}

export interface OwnerClusterGeoRow {
  pin: string;
  address: string | null;
  vacant: boolean;
  lat: number | null;
  lon: number | null;
  clusterKey: string;
  ownerName: string | null;
  ownerType: string | null;
  clusterParcelCount: number;
  clusterVacantCount: number;
  confidence: string;
}

interface OwnerClusterGeoDbRow {
  pin: string;
  address: string | null;
  vacant: boolean | null;
  lat: number | string | null;
  lon: number | string | null;
  cluster_key: string;
  owner_name: string | null;
  owner_type: string | null;
  cluster_parcel_count: number | string;
  cluster_vacant_count: number | string;
  confidence: string;
}

/**
 * Per-parcel rows (with lat/lon) for the top `limit` owner clusters in a
 * ZIP — the same clustering CTE as fetchOwnerClusters above, exploded back
 * out to one row per parcel instead of aggregated. Backs the admin-only
 * ownership-cluster map layer and report panel
 * (scripts/export-owner-clusters-geo.ts -> data/private/owner-clusters-geo.json,
 * served only through the gated /api/owner-file/geo route). Never touches
 * public/ — an Owner File is a named-entity dossier, more sensitive than the
 * public vacant-properties layer.
 */
export async function fetchOwnerClusterGeoRows(
  sql: NeonQueryFunction<false, false>,
  zip: string,
  limit: number
): Promise<OwnerClusterGeoRow[]> {
  const rows = (await sql`
    WITH parcel_base AS (
      SELECT
        pin,
        address,
        owner_name,
        owner_mailing_address,
        owner_type,
        is_vacant,
        lat,
        lon,
        regexp_replace(lower(coalesce(owner_mailing_address, '')), '[^a-z0-9]', '', 'g') AS norm_mailing,
        regexp_replace(lower(coalesce(owner_name, '')), '[^a-z0-9]', '', 'g') AS norm_owner
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
        MIN(NULLIF(owner_type, '')) AS owner_type,
        COUNT(*) AS parcel_count,
        COUNT(*) FILTER (WHERE is_vacant IS TRUE) AS vacant_parcel_count,
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
    )
    SELECT
      cp.pin,
      cp.address,
      coalesce(cp.is_vacant, false) AS vacant,
      cp.lat,
      cp.lon,
      tc.cluster_key,
      tc.owner_name,
      tc.owner_type,
      tc.parcel_count AS cluster_parcel_count,
      tc.vacant_parcel_count AS cluster_vacant_count,
      CASE
        WHEN tc.has_mailing_match AND tc.parcel_count > 1 THEN 'High'
        WHEN tc.has_mailing_match THEN 'Medium'
        WHEN tc.has_owner_name_match AND tc.parcel_count > 1 THEN 'Medium'
        ELSE 'Low'
      END AS confidence
    FROM clustered_parcels cp
    JOIN top_clusters tc ON tc.cluster_key = cp.cluster_key
  `) as OwnerClusterGeoDbRow[];

  return rows.map((row) => ({
    pin: row.pin,
    address: row.address,
    vacant: Boolean(row.vacant),
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    clusterKey: row.cluster_key,
    ownerName: row.owner_name,
    ownerType: row.owner_type,
    clusterParcelCount: toNumber(row.cluster_parcel_count),
    clusterVacantCount: toNumber(row.cluster_vacant_count),
    confidence: row.confidence,
  }));
}

export interface OwnerClustersExport {
  generatedAt: string;
  zips: Record<string, OwnerCluster[]>;
}

/**
 * Backward compatibility: normalizes a cluster loaded from the committed
 * static export (or any older snapshot) that predates `pins[]`/
 * `distressSignals`/`latestTaxSaleYear`/`taxSaleSoldCount` — defaults `pins`
 * to `[]`, every distress-signal field to `null`, and the two Phase-2
 * tax-sale copy fields to `null` rather than leaving them `undefined`.
 */
function normalizeLoadedCluster(raw: unknown): OwnerCluster {
  const cluster = (raw ?? {}) as Partial<OwnerCluster> & Record<string, unknown>;
  return {
    ...(cluster as OwnerCluster),
    pins: Array.isArray(cluster.pins) ? (cluster.pins as string[]) : [],
    distressSignals: normalizeDistressSignals(cluster.distressSignals),
    latestTaxSaleYear: typeof cluster.latestTaxSaleYear === "number" ? cluster.latestTaxSaleYear : null,
    taxSaleSoldCount: typeof cluster.taxSaleSoldCount === "number" ? cluster.taxSaleSoldCount : null,
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
