import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

interface OwnerClusterRow {
  cluster_key: string;
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

function serialize(row: OwnerClusterRow, businessNames: string[]) {
  const evidenceParts = [
    row.evidence,
    businessNames.length > 0 ? "linked to business licenses by site address/name" : "",
  ].filter(Boolean);

  return {
    clusterKey: row.cluster_key,
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
  };
}

function isMissingTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "42P01"
  );
}

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get("zip");
  const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? 25);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 25;

  if (!zip || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "zip must be a 5-digit ZIP code" }, { status: 400 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json(
      { clusters: [] },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=300" } }
    );
  }

  try {
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

    const businessNamesFor = (row: OwnerClusterRow) => {
      const names = new Set<string>();
      for (const key of row.norm_addresses ?? []) {
        for (const name of licensesByAddress.get(key) ?? []) names.add(name);
      }
      for (const key of row.norm_owners ?? []) {
        for (const name of licensesByLegal.get(key) ?? []) names.add(name);
      }
      return Array.from(names).slice(0, 5);
    };

    return NextResponse.json(
      { clusters: rows.map((row) => serialize(row, businessNamesFor(row))) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json(
        { clusters: [] },
        { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=300" } }
      );
    }
    console.error("corridor owners API error:", err);
    return NextResponse.json({ error: "Database query failed" }, { status: 500 });
  }
}
