import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../migrate-permit-exhibit-snapshots.ts", import.meta.url),
  "utf8",
);

describe("Permit Exhibit snapshot migration contract", () => {
  it("stores the full document with duplicated integrity fields and no user identity", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS permit_exhibit_snapshots/);
    expect(migration).toMatch(/public_id TEXT PRIMARY KEY/);
    expect(migration).toContain("public_id ~ '^ps_[A-Za-z0-9_-]{24}$'");
    expect(migration).toMatch(/display_id TEXT NOT NULL UNIQUE/);
    expect(migration).toContain(
      "display_id ~ '^PX-[0-9]{14}-[0-9]{8}-[A-Z0-9]{4,8}$'",
    );
    expect(migration).toMatch(/request_id UUID NOT NULL UNIQUE/);
    expect(migration).toMatch(/snapshot_json JSONB NOT NULL/);
    expect(migration).toMatch(/content_hash TEXT NOT NULL/);
    expect(migration).toContain("content_hash ~ '^[0-9a-f]{64}$'");

    expect(migration).toContain("permit_exhibit_snapshots_public_id_matches_json");
    expect(migration).toContain("permit_exhibit_snapshots_display_id_matches_json");
    expect(migration).toContain("permit_exhibit_snapshots_schema_version_matches_json");
    expect(migration).toContain("permit_exhibit_snapshots_saved_at_matches_json");
    expect(migration).toContain("permit_exhibit_snapshots_app_revision_matches_json");
    expect(migration).toContain("permit_exhibit_snapshots_pin_matches_json");
    expect(migration).toContain("permit_exhibit_snapshots_radius_matches_json");

    expect(migration).not.toMatch(/\buser_id\b/i);
    expect(migration).not.toMatch(/\bemail\b/i);
  });

  it("rejects every snapshot update and delete", () => {
    expect(migration).toContain("reject_permit_exhibit_snapshot_mutation");
    expect(migration).toMatch(
      /CREATE TRIGGER trg_permit_exhibit_snapshots_reject_mutation\s+BEFORE UPDATE OR DELETE ON permit_exhibit_snapshots/,
    );
    expect(migration).toContain("snapshots are immutable and cannot be updated or deleted");
  });

  it("creates the client-hash attempt ledger and lookup indexes", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS permit_exhibit_snapshot_attempts/);
    expect(migration).toMatch(/client_hash TEXT NOT NULL/);
    expect(migration).toContain("idx_permit_exhibit_snapshot_attempts_client_created_at");
    expect(migration).toContain("idx_permit_exhibit_snapshot_attempts_created_at");
    expect(migration).toContain("reserve_permit_exhibit_snapshot_attempt");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("is available directly and from the aggregate migration chain", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["db:migrate:permit-exhibit-snapshots"]).toBe(
      "npx tsx scripts/migrate-permit-exhibit-snapshots.ts",
    );
    expect(packageJson.scripts["db:migrate"]).toContain(
      "npm run db:migrate:permit-exhibit-snapshots",
    );
  });
});
