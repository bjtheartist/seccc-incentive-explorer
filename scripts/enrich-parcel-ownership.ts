#!/usr/bin/env npx tsx
/**
 * Enrich parcels with recorded owner/taxpayer mailing data from Cook County's
 * Assessor - Parcel Addresses dataset (`3723-97qp`).
 *
 * This is a proxy for ownership/control, not a beneficial ownership registry.
 *
 * Usage:
 *   ZIP=60619 DATABASE_URL="postgresql://..." npx tsx scripts/enrich-parcel-ownership.ts
 */

import { neon } from "@neondatabase/serverless";
import { classifyOwner } from "../lib/owner-classify";
import { socrataHeaders } from "../lib/socrata";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const PARCEL_ADDRESSES_URL =
  "https://datacatalog.cookcountyil.gov/resource/3723-97qp.json";

interface ParcelAddressRecord {
  pin?: string;
  year?: string;
  owner_address_name?: string;
  mail_address_name?: string;
  mail_address_full?: string;
  mail_address_city_name?: string;
  mail_address_state?: string;
  mail_address_zipcode_1?: string;
  owner_address_full?: string;
  owner_address_city_name?: string;
  owner_address_state?: string;
  owner_address_zipcode_1?: string;
}

interface OwnershipRow {
  pin: string;
  ownerName: string | null;
  ownerMailingAddress: string | null;
  ownerType: string;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function joinAddress(parts: Array<string | undefined>): string | null {
  const text = parts
    .map((part) => clean(part))
    .filter((part): part is string => Boolean(part))
    .join(", ");
  return text || null;
}

function normalize(record: ParcelAddressRecord): OwnershipRow | null {
  const pin = clean(record.pin);
  if (!pin) return null;

  const ownerName =
    clean(record.owner_address_name) ?? clean(record.mail_address_name);
  const ownerMailingAddress =
    joinAddress([
      record.mail_address_full,
      record.mail_address_city_name,
      record.mail_address_state,
      record.mail_address_zipcode_1,
    ]) ??
    joinAddress([
      record.owner_address_full,
      record.owner_address_city_name,
      record.owner_address_state,
      record.owner_address_zipcode_1,
    ]);

  return {
    pin,
    ownerName,
    ownerMailingAddress,
    ownerType: classifyOwner(ownerName, ownerMailingAddress),
  };
}

async function fetchLatestAddressYear(): Promise<string | null> {
  const url = `${PARCEL_ADDRESSES_URL}?$select=max(year)`;
  const res = await fetch(url, {
    headers: socrataHeaders(),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  const rows: Array<{ max_year?: string }> = await res.json();
  const year = rows[0]?.max_year;
  return year ? String(Math.trunc(Number(year))) : null;
}

async function fetchOwnershipForPins(
  pins: string[],
  year: string
): Promise<OwnershipRow[]> {
  const results = new Map<string, OwnershipRow>();
  const batchSize = 100;
  const select = [
    "pin",
    "year",
    "owner_address_name",
    "mail_address_name",
    "mail_address_full",
    "mail_address_city_name",
    "mail_address_state",
    "mail_address_zipcode_1",
    "owner_address_full",
    "owner_address_city_name",
    "owner_address_state",
    "owner_address_zipcode_1",
  ].join(",");

  for (let i = 0; i < pins.length; i += batchSize) {
    const batch = pins.slice(i, i + batchSize);
    const inClause = batch.map((pin) => `'${pin}'`).join(",");
    const where = encodeURIComponent(`pin in(${inClause}) AND year=${year}`);
    const url = `${PARCEL_ADDRESSES_URL}?$select=${select}&$where=${where}&$limit=${batchSize}&$order=pin`;

    const res = await fetch(url, {
      headers: socrataHeaders(),
      signal: AbortSignal.timeout(30000),
    });

    if (res.ok) {
      const page: ParcelAddressRecord[] = await res.json();
      for (const record of page) {
        const row = normalize(record);
        if (row) results.set(row.pin, row);
      }
    }

    if ((i + batchSize) % 1000 === 0 || i + batchSize >= pins.length) {
      console.log(
        `  Ownership: ${Math.min(i + batchSize, pins.length)}/${pins.length} PINs queried (${results.size} found)`
      );
    }
  }

  return Array.from(results.values());
}

async function updateParcels(rows: OwnershipRow[]): Promise<number> {
  let written = 0;
  const batchSize = 500;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const payload = JSON.stringify(
      batch.map((row) => ({
        pin: row.pin,
        owner_name: row.ownerName,
        owner_mailing_address: row.ownerMailingAddress,
        owner_type: row.ownerType,
      }))
    );

    await sql`
      WITH rows AS (
        SELECT *
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          pin TEXT,
          owner_name TEXT,
          owner_mailing_address TEXT,
          owner_type TEXT
        )
      )
      UPDATE parcels p
      SET
        owner_name = rows.owner_name,
        owner_mailing_address = rows.owner_mailing_address,
        owner_type = rows.owner_type
      FROM rows
      WHERE p.pin = rows.pin
    `;
    written += batch.length;
  }

  return written;
}

async function main() {
  const zips = (process.env.ZIPS ?? process.env.ZIP ?? "60619")
    .split(",")
    .map((zip) => zip.trim())
    .filter(Boolean);

  console.log("=== Parcel Ownership Enrichment ===\n");
  console.log(`ZIPs: ${zips.join(", ")}`);

  const latestYear = await fetchLatestAddressYear();
  if (!latestYear) throw new Error("Could not determine latest parcel address year");
  console.log(`Address year: ${latestYear}`);

  const pinRows = (await sql`
    SELECT pin
    FROM parcels
    WHERE zip = ANY(${zips})
    ORDER BY pin
  `) as Array<{ pin: string }>;
  const pins = pinRows.map((row) => row.pin).filter(Boolean);
  console.log(`PINs in scope: ${pins.length}`);

  const ownershipRows = await fetchOwnershipForPins(pins, latestYear);
  console.log(`Ownership rows found: ${ownershipRows.length}`);

  const written = await updateParcels(ownershipRows);
  console.log(`Parcels enriched: ${written}`);

  const summary = await sql`
    SELECT COALESCE(owner_type, 'unknown') AS owner_type, COUNT(*)::int AS count
    FROM parcels
    WHERE zip = ANY(${zips})
    GROUP BY owner_type
    ORDER BY count DESC
  `;
  console.log("\nOwner type summary:");
  for (const row of summary as Array<{ owner_type: string; count: number }>) {
    console.log(`  ${row.owner_type}: ${row.count}`);
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Ownership enrichment failed:", err);
  process.exit(1);
});
