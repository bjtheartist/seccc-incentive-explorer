#!/usr/bin/env npx tsx
/**
 * Read-only production/data-branch audit for permit spatial coverage and
 * vacant-parcel match quality.
 *
 * The useful question is not only "what percent has no geometry?". This audit
 * segments missing geometry by source, issue year, identifier availability,
 * and source-recorded street-number shape; then measures whether the match
 * table lets proximity evidence fan out or compete with stronger identity
 * joins. Community-area coverage is reported only where a real vacant-property
 * match supplies it — an ungeocoded permit is never assigned to a geography by
 * guesswork.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npm run data:audit:permit-spatial
 *   DATABASE_URL="postgresql://..." npm run data:audit:permit-spatial -- --json
 *   DATABASE_URL="postgresql://..." npm run data:audit:permit-spatial -- --strict
 *
 * `--strict` exits non-zero when proximity rows fan out across parcels or when
 * a proximity row exists for a permit that already has a PIN/address match.
 * The script never writes to the database.
 */

import { neon } from "@neondatabase/serverless";

type Row = Record<string, unknown>;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const jsonOutput = process.argv.includes("--json");
const strict = process.argv.includes("--strict");
const sql = neon(databaseUrl);

function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function count(value: unknown): string {
  return n(value).toLocaleString("en-US");
}

function pct(numerator: unknown, denominator: unknown): string {
  const den = n(denominator);
  return den > 0 ? `${((n(numerator) / den) * 100).toFixed(2)}%` : "n/a";
}

async function query(text: string): Promise<Row[]> {
  return (await sql.query(text)) as Row[];
}

async function main() {
  const [overview, sourceCoverage, geocodeProvenance, latestGeocodeOutcomes, missingIdentity, missingByYear, missingByPermitType, matchesByMethod, proximityRisk, missingResolution, missingTopCommunityAreas] =
    await Promise.all([
      query(`
        SELECT
          COUNT(*)::int AS permits,
          COUNT(*) FILTER (WHERE geom IS NULL)::int AS ungeocoded,
          MIN(issue_date)::text AS earliest_issue_date,
          MAX(issue_date)::text AS latest_issue_date,
          MAX(fetched_at)::text AS latest_fetch,
          (SELECT COUNT(*)::int FROM vacant_properties) AS vacant_properties,
          (SELECT COUNT(*)::int FROM parcels) AS parcels
        FROM building_permits
      `),
      query(`
        SELECT
          COALESCE(source, 'not recorded') AS source,
          COUNT(*)::int AS permits,
          COUNT(*) FILTER (WHERE geom IS NULL)::int AS ungeocoded
        FROM building_permits
        GROUP BY 1
        ORDER BY permits DESC, source
      `),
      query(`
        SELECT
          CASE
            WHEN geom IS NULL THEN 'unresolved'
            WHEN geocode_source IS NULL THEN 'city_source'
            ELSE geocode_source
          END AS geometry_source,
          COUNT(*)::int AS permits
        FROM building_permits
        GROUP BY 1
        ORDER BY permits DESC, geometry_source
      `),
      query(`
        WITH latest AS (
          SELECT run_id, started_at
          FROM permit_geocode_runs
          WHERE status = 'completed'
          ORDER BY started_at DESC
          LIMIT 1
        )
        SELECT
          latest.run_id,
          latest.started_at::text,
          result.status,
          COUNT(*)::int AS permits
        FROM latest
        JOIN permit_geocode_results result ON result.run_id = latest.run_id
        JOIN building_permits permit ON permit.permit_id = result.permit_id
        WHERE permit.geom IS NULL
        GROUP BY latest.run_id, latest.started_at, result.status
        ORDER BY result.status
      `),
      query(`
        SELECT
          COUNT(*)::int AS ungeocoded,
          COUNT(*) FILTER (
            WHERE cardinality(COALESCE(pins, ARRAY[]::text[])) > 0
          )::int AS has_pin,
          COUNT(*) FILTER (
            WHERE NULLIF(trim(address), '') IS NOT NULL
          )::int AS has_address,
          COUNT(*) FILTER (
            WHERE cardinality(COALESCE(pins, ARRAY[]::text[])) > 0
              AND NULLIF(trim(address), '') IS NOT NULL
          )::int AS has_both,
          COUNT(*) FILTER (
            WHERE cardinality(COALESCE(pins, ARRAY[]::text[])) = 0
              AND NULLIF(trim(address), '') IS NULL
          )::int AS has_neither,
          COUNT(*) FILTER (
            WHERE COALESCE(raw_json->>'street_number', '') ~ '^[0-9]+$'
          )::int AS standard_street_number,
          COUNT(*) FILTER (
            WHERE COALESCE(raw_json->>'street_number', '') ~ '^[0-9]+-[0-9]+$'
          )::int AS ranged_street_number,
          COUNT(*) FILTER (
            WHERE COALESCE(raw_json->>'street_number', '') <> ''
              AND COALESCE(raw_json->>'street_number', '') !~ '^[0-9]+(-[0-9]+)?$'
          )::int AS other_street_number,
          COUNT(*) FILTER (
            WHERE COALESCE(raw_json->>'street_number', '') = ''
          )::int AS missing_street_number
        FROM building_permits
        WHERE geom IS NULL
      `),
      query(`
        SELECT
          EXTRACT(YEAR FROM issue_date)::int AS issue_year,
          COUNT(*)::int AS permits,
          COUNT(*) FILTER (WHERE geom IS NULL)::int AS ungeocoded
        FROM building_permits
        GROUP BY 1
        HAVING COUNT(*) FILTER (WHERE geom IS NULL) > 0
        ORDER BY issue_year DESC NULLS LAST
      `),
      query(`
        SELECT
          COALESCE(permit_type, 'not recorded') AS permit_type,
          COUNT(*)::int AS permits,
          COUNT(*) FILTER (WHERE geom IS NULL)::int AS ungeocoded
        FROM building_permits
        GROUP BY 1
        HAVING COUNT(*) FILTER (WHERE geom IS NULL) > 0
        ORDER BY ungeocoded DESC, permit_type
        LIMIT 15
      `),
      query(`
        SELECT
          match_method,
          match_confidence,
          COUNT(*)::int AS match_rows,
          COUNT(DISTINCT permit_id)::int AS permits,
          COUNT(DISTINCT vacant_property_id)::int AS parcels
        FROM vacant_property_permit_matches
        GROUP BY 1, 2
        ORDER BY
          array_position(
            ARRAY['pin_exact','address_normalized','spatial_proximity'],
            match_method
          ),
          match_confidence
      `),
      query(`
        WITH proximity_per_permit AS (
          SELECT permit_id, COUNT(DISTINCT vacant_property_id)::int AS parcel_count
          FROM vacant_property_permit_matches
          WHERE match_method = 'spatial_proximity'
          GROUP BY permit_id
        ), shadowed AS (
          SELECT
            COUNT(*)::int AS rows,
            COUNT(DISTINCT m.permit_id)::int AS permits
          FROM vacant_property_permit_matches m
          WHERE m.match_method = 'spatial_proximity'
            AND EXISTS (
              SELECT 1
              FROM vacant_property_permit_matches stronger
              WHERE stronger.permit_id = m.permit_id
                AND stronger.match_method IN ('pin_exact', 'address_normalized')
            )
        )
        SELECT
          COUNT(*)::int AS proximity_permits,
          COUNT(*) FILTER (WHERE parcel_count > 1)::int AS multi_parcel_permits,
          COALESCE(MAX(parcel_count), 0)::int AS max_parcels,
          (SELECT rows FROM shadowed) AS shadowed_rows,
          (SELECT permits FROM shadowed) AS shadowed_permits
        FROM proximity_per_permit
      `),
      query(`
        WITH resolved AS (
          SELECT
            bp.permit_id,
            COUNT(DISTINCT upper(trim(vp.community_area))) FILTER (
              WHERE NULLIF(trim(vp.community_area), '') IS NOT NULL
            )::int AS community_area_count
          FROM building_permits bp
          JOIN vacant_property_permit_matches m ON m.permit_id = bp.permit_id
          JOIN vacant_properties vp ON vp.id = m.vacant_property_id
          WHERE bp.geom IS NULL
          GROUP BY bp.permit_id
        )
        SELECT
          (SELECT COUNT(*)::int FROM building_permits WHERE geom IS NULL) AS ungeocoded,
          COUNT(*)::int AS matched_to_vacant_universe,
          COUNT(*) FILTER (WHERE community_area_count = 1)::int AS one_community_area,
          COUNT(*) FILTER (WHERE community_area_count > 1)::int AS multiple_community_areas,
          COUNT(*) FILTER (WHERE community_area_count = 0)::int AS no_community_area
        FROM resolved
      `),
      query(`
        SELECT
          upper(trim(vp.community_area)) AS community_area,
          COUNT(DISTINCT bp.permit_id)::int AS permits
        FROM building_permits bp
        JOIN vacant_property_permit_matches m ON m.permit_id = bp.permit_id
        JOIN vacant_properties vp ON vp.id = m.vacant_property_id
        WHERE bp.geom IS NULL
          AND NULLIF(trim(vp.community_area), '') IS NOT NULL
        GROUP BY 1
        ORDER BY permits DESC, community_area
        LIMIT 15
      `),
    ]);

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: "City of Chicago Building Permits (ydr8-5enu)",
    grain: "one row per permit_id; matches are one row per vacant-property/permit pair",
    overview: overview[0] ?? {},
    sourceCoverage,
    geocodeProvenance,
    latestGeocodeOutcomes,
    missingIdentity: missingIdentity[0] ?? {},
    missingByYear,
    missingByPermitType,
    matchesByMethod,
    proximityRisk: proximityRisk[0] ?? {},
    missingResolution: missingResolution[0] ?? {},
    missingTopCommunityAreas,
    limitations: [
      "Community area is reported only when an existing vacant-property match supplies it.",
      "An ungeocoded permit without such a match remains geographically unknown; the audit does not infer a neighborhood from address text.",
      "Census matches are interpolated from MAF/TIGER address ranges, not rooftop or parcel-boundary coordinates; their source and match type remain attached to each permit.",
      "Permit reported_cost is intentionally excluded because it is an applicant estimate, not verified investment.",
    ],
  };

  const risk = report.proximityRisk;
  const unsafe = n(risk.multi_parcel_permits) > 0 || n(risk.shadowed_permits) > 0;

  if (jsonOutput) {
    console.log(JSON.stringify({ ...report, assessment: unsafe ? "high" : "pass" }, null, 2));
  } else {
    const o = report.overview;
    const identity = report.missingIdentity;
    const resolution = report.missingResolution;
    console.log("Permit spatial quality audit");
    console.log(`Generated: ${report.generatedAt}`);
    console.log(`Dataset grain: ${report.grain}`);
    console.log("");
    console.log("Coverage");
    console.log(`  Permits: ${count(o.permits)}`);
    console.log(
      `  Missing geometry: ${count(o.ungeocoded)} (${pct(o.ungeocoded, o.permits)})`,
    );
    console.log(`  Issue dates: ${o.earliest_issue_date ?? "n/a"} through ${o.latest_issue_date ?? "n/a"}`);
    console.log(`  Latest database fetch: ${o.latest_fetch ?? "n/a"}`);
    for (const row of report.sourceCoverage) {
      console.log(
        `  Source ${String(row.source)}: ${count(row.ungeocoded)} of ${count(row.permits)} missing geometry (${pct(row.ungeocoded, row.permits)})`,
      );
    }
    console.log("  Geometry provenance:");
    for (const row of report.geocodeProvenance) {
      console.log(`    ${String(row.geometry_source)}: ${count(row.permits)}`);
    }
    console.log("");
    console.log("Ungeocoded identity and address shape");
    console.log(`  Has PIN: ${count(identity.has_pin)}`);
    console.log(`  Has address: ${count(identity.has_address)}`);
    console.log(`  Has neither: ${count(identity.has_neither)}`);
    console.log(`  Standard street number: ${count(identity.standard_street_number)}`);
    console.log(`  Ranged street number: ${count(identity.ranged_street_number)}`);
    console.log(`  Other/missing street number: ${count(identity.other_street_number)} / ${count(identity.missing_street_number)}`);
    if (report.latestGeocodeOutcomes.length > 0) {
      const latest = report.latestGeocodeOutcomes[0];
      console.log(
        `  Latest completed backfill: ${String(latest.run_id)} at ${String(latest.started_at)}`,
      );
      console.log("  Remaining outcomes from that frozen backlog:");
      for (const row of report.latestGeocodeOutcomes) {
        console.log(`    ${String(row.status)}: ${count(row.permits)}`);
      }
    }
    console.log("  By issue year:");
    for (const row of report.missingByYear) {
      console.log(
        `    ${row.issue_year ?? "not recorded"}: ${count(row.ungeocoded)} of ${count(row.permits)} (${pct(row.ungeocoded, row.permits)})`,
      );
    }
    console.log("  Largest permit-type groups:");
    for (const row of report.missingByPermitType) {
      console.log(
        `    ${String(row.permit_type)}: ${count(row.ungeocoded)} of ${count(row.permits)} (${pct(row.ungeocoded, row.permits)})`,
      );
    }
    console.log("");
    console.log("Vacant-parcel match methods");
    for (const row of report.matchesByMethod) {
      console.log(
        `  ${String(row.match_method)} / ${String(row.match_confidence)}: ${count(row.match_rows)} rows, ${count(row.permits)} permits, ${count(row.parcels)} parcels`,
      );
    }
    console.log("");
    console.log("Proximity safety");
    console.log(
      `  Proximity permits attached to multiple parcels: ${count(risk.multi_parcel_permits)} of ${count(risk.proximity_permits)} (${pct(risk.multi_parcel_permits, risk.proximity_permits)})`,
    );
    console.log(`  Maximum parcels for one proximity permit: ${count(risk.max_parcels)}`);
    console.log(
      `  Proximity permits that also have a PIN/address match: ${count(risk.shadowed_permits)} (${count(risk.shadowed_rows)} rows)`,
    );
    console.log("");
    console.log("Geography recovery for ungeocoded permits");
    console.log(
      `  Matched to the vacant-property universe: ${count(resolution.matched_to_vacant_universe)} of ${count(resolution.ungeocoded)} (${pct(resolution.matched_to_vacant_universe, resolution.ungeocoded)})`,
    );
    console.log(`  Resolved to exactly one recorded community area: ${count(resolution.one_community_area)}`);
    if (report.missingTopCommunityAreas.length > 0) {
      console.log("  Largest recorded clusters (resolved subset only):");
      for (const row of report.missingTopCommunityAreas) {
        console.log(`    ${String(row.community_area)}: ${count(row.permits)}`);
      }
    }
    console.log("");
    console.log(
      unsafe
        ? "Assessment: HIGH — proximity fan-out or stronger-match shadowing can misattribute permits."
        : "Assessment: PASS — no proximity fan-out or stronger-match shadowing detected.",
    );
    console.log("This audit performed no database writes.");
  }

  if (strict && unsafe) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Permit spatial quality audit failed:", error);
  process.exit(1);
});
