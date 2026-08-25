import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("set-based permit matching safety rails", () => {
  it("rebuilds proximity as fallback-only and chooses one closest parcel", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/sync-vacant-properties.ts"),
      "utf8",
    );

    expect(source).toContain("DELETE FROM vacant_property_permit_matches");
    expect(source).toContain("WHERE match_method = 'spatial_proximity'");
    expect(source).toContain("stronger.permit_id = bp.permit_id");
    expect(source).toContain(
      "stronger.match_method IN ('pin_exact', 'address_normalized')",
    );
    expect(source).toContain("ST_DWithin(bp.geom, closer.geom");
    expect(source).toContain(
      "ST_Distance(bp.geom, closer.geom) < ST_Distance(bp.geom, vp.geom)",
    );
    expect(source).toContain("closer.id < vp.id");
  });

  it("keeps the production coverage audit read-only and pins both risk checks", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/audit-permit-spatial-quality.ts"),
      "utf8",
    );

    expect(source).toContain("multi_parcel_permits");
    expect(source).toContain("shadowed_permits");
    expect(source).toContain("The script never writes to the database.");
    expect(source).not.toMatch(/\bsql(?:\.query)?\s*(?:`|\()\s*(?:DELETE|INSERT|UPDATE|TRUNCATE|ALTER|DROP)\b/i);
  });

  it("stages and atomically publishes the standalone proximity repair", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/repair-permit-match-table.ts"),
      "utf8",
    );
    const migration = readFileSync(
      resolve(process.cwd(), "scripts/migrate-condition.ts"),
      "utf8",
    );

    expect(source).toContain("Dry-run is the default");
    expect(source).toContain("permit_match_repair_stage");
    expect(source).toContain("COUNT(*) = COUNT(DISTINCT permit_id)");
    expect(source).toContain("no_shadowed_permits");
    expect(source).toContain("1 / CASE WHEN safe AND inserted = expected");
    expect(source).toContain("Post-publish multi-parcel proximity permits: 0");
    expect(migration).toContain("idx_permit_match_repair_stage_run_permit");
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*\(run_id, permit_id\)/);
  });

  it("keeps geocode enrichment auditable and prevents daily sync from erasing it", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "scripts/migrate-condition.ts"),
      "utf8",
    );
    const backfill = readFileSync(
      resolve(process.cwd(), "scripts/backfill-permit-geocodes.ts"),
      "utf8",
    );
    const ingest = readFileSync(resolve(process.cwd(), "lib/ingest/permits.ts"), "utf8");

    expect(migration).toContain("permit_geocode_runs");
    expect(migration).toContain("permit_geocode_results");
    expect(migration).toContain("geocode_run_id TEXT");
    expect(backfill).toContain("status = 'accepted'");
    expect(backfill).toContain("bp.geom IS NULL");
    expect(backfill).toContain("1 / CASE");
    expect(backfill).toContain("resolution_source");
    expect(ingest).toContain("WHEN building_permits.geocode_source IS NOT NULL");
    expect(ingest).toContain("WHEN EXCLUDED.geom IS NOT NULL THEN NULL");
    expect(ingest).toContain("coalesce(EXCLUDED.address, '')");
    expect(ingest).toContain("THEN building_permits.geocode_run_id");

    const audit = readFileSync(
      resolve(process.cwd(), "scripts/audit-permit-spatial-quality.ts"),
      "utf8",
    );
    expect(audit).toContain("Geometry provenance:");
    expect(audit).toContain("latestGeocodeOutcomes");
    expect(audit).toContain("interpolated from MAF/TIGER address ranges");
  });
});
