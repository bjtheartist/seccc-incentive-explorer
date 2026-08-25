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
});
