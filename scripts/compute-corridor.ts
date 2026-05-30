#!/usr/bin/env npx tsx
/**
 * Computes Corridor Health metrics per ZIP and upserts them into
 * `corridor_metrics`. Pulls minimal rows from the domain tables, runs the pure
 * functions in `lib/corridor-health.ts`, then writes one snapshot row per ZIP.
 *
 * Idempotent: re-running for the same as_of date updates the existing row.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/compute-corridor.ts
 */

import { neon } from "@neondatabase/serverless";
import {
  computeVacancy,
  computeTurnover,
  computeOwnershipConcentration,
  computeOwnershipOrigin,
  computePermitActivity,
  computeIncentiveCoverage,
  computeHealthScore,
  type ParcelRow,
  type BusinessLicenseRow,
  type PermitRow,
} from "../lib/corridor-health";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

/** ZIP corridors the app is scoped to. */
const ZIPS = ["60617", "60619", "60649"];

/** Trailing window (months) for turnover + permit-activity metrics. */
const WINDOW_MONTHS = 24;

async function compute() {
  console.log("Computing corridor metrics...\n");

  const asOf = new Date();
  const asOfIso = asOf.toISOString().slice(0, 10);
  const windowStart = new Date(asOf);
  windowStart.setMonth(windowStart.getMonth() - WINDOW_MONTHS);

  for (const zip of ZIPS) {
    console.log(`Corridor ${zip}...`);

    /* ── SQL aggregations ──────────────────────────────────────────────
     * parcels: vacancy flag + owner identity/type drive vacancy, ownership
     *   concentration and local-vs-outside ownership. Parcels carry no `zip`
     *   column, so we join via business_licenses ZIP centroid is not reliable;
     *   instead we match on the ZIP embedded in the raw_json address payload.
     * NOTE: parcels has no first-class `zip` column. We extract it from
     *   raw_json so the join stays ZIP-keyed. Parcels without a parseable ZIP
     *   are excluded from that corridor. */
    const parcels = (await sql`
      SELECT pin, is_vacant, owner_name, owner_type
      FROM parcels
      WHERE raw_json->>'zip' = ${zip}
         OR address ILIKE ${"%" + zip + "%"}
    `) as ParcelRow[];

    const licenses = (await sql`
      SELECT license_status, license_start_date, expiration_date
      FROM business_licenses
      WHERE zip = ${zip}
    `) as BusinessLicenseRow[];

    const permits = (await sql`
      SELECT issue_date, reported_cost, is_demolition
      FROM building_permits
      WHERE zip = ${zip}
        AND issue_date >= ${windowStart.toISOString().slice(0, 10)}
    `) as PermitRow[];

    /* ── Pure-function metric computation ── */
    const vacancy = computeVacancy(parcels);
    const turnover = computeTurnover(licenses, windowStart, asOf);
    const ownershipConcentration = computeOwnershipConcentration(parcels);
    const ownershipOrigin = computeOwnershipOrigin(parcels);
    const permitActivity = computePermitActivity(permits, windowStart, asOf);
    // Incentive coverage requires a parcel→zone join table that does not yet
    // exist (zones are GeoJSON polygons, not ZIP-keyed). Reported as unknown.
    const incentiveCoverage = computeIncentiveCoverage(parcels.length, null);

    const healthScore = computeHealthScore({
      vacancy,
      turnover,
      ownershipConcentration,
      ownershipOrigin,
      permits: permitActivity,
      incentiveCoverage,
    });

    const details = {
      vacancy,
      turnover,
      ownershipConcentration,
      ownershipOrigin,
      permits: permitActivity,
      incentiveCoverage,
      windowMonths: WINDOW_MONTHS,
    };

    /* ── Upsert snapshot ── */
    await sql`
      INSERT INTO corridor_metrics (
        corridor_type, corridor_id, as_of,
        vacancy_rate, turnover_rate, ownership_hhi,
        local_ownership_share, permit_count, incentive_coverage,
        health_score, details
      ) VALUES (
        'zip', ${zip}, ${asOfIso},
        ${vacancy.vacancyRate}, ${turnover.turnoverRate}, ${ownershipConcentration.hhi},
        ${ownershipOrigin.localShare}, ${permitActivity.permitCount}, ${incentiveCoverage.coverageShare},
        ${healthScore}, ${JSON.stringify(details)}
      )
      ON CONFLICT (corridor_type, corridor_id, as_of) DO UPDATE SET
        vacancy_rate = EXCLUDED.vacancy_rate,
        turnover_rate = EXCLUDED.turnover_rate,
        ownership_hhi = EXCLUDED.ownership_hhi,
        local_ownership_share = EXCLUDED.local_ownership_share,
        permit_count = EXCLUDED.permit_count,
        incentive_coverage = EXCLUDED.incentive_coverage,
        health_score = EXCLUDED.health_score,
        computed_at = NOW(),
        details = EXCLUDED.details
    `;

    console.log(
      `  parcels=${parcels.length} vacancy=${vacancy.vacancyRate.toFixed(2)} ` +
        `hhi=${ownershipConcentration.hhi.toFixed(3)} permits=${permitActivity.permitCount} ` +
        `health=${healthScore}`
    );
  }

  console.log("\nCorridor metrics computed.");
}

compute().catch((err) => {
  console.error("Compute failed:", err);
  process.exit(1);
});
