import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "scripts/migrate-vacant.ts"),
  "utf8",
);
const sync = readFileSync(
  resolve(process.cwd(), "scripts/sync-vacant-properties.ts"),
  "utf8",
);

describe("vacancy provenance SQL guards", () => {
  it("migrates the row-level provenance contract and isolated CCLBA stage idempotently", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS source_dataset_id TEXT");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS source_row_id TEXT");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS source_retrieved_at TIMESTAMPTZ");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS managing_organization TEXT");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS property_status TEXT");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS vacant_cclba_sync_stage");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS vacant_source_snapshots");
    expect(migration).toContain("located_chicago_total + unlocated_chicago_total = chicago_total");
    expect(migration).toContain("idx_vacant_source_snapshots_latest");
    expect(migration).toContain("'cols', 'cclba', 'dpd_vacant'");
    expect(migration).toContain("owner_name ~* '^City of Chicago([[:space:]]*—.*)?$'");
  });

  it("publishes CCLBA only after sanity checks through one upsert-retire-clear CTE", () => {
    const sourceSection = sync.indexOf("// ── Source 2: Cook County Land Bank");
    const priorLiveCount = sync.indexOf("WHERE source = 'cclba'", sourceSection);
    const assertion = sync.lastIndexOf("assertCclbaSourceSnapshotSane(");
    const membershipAssertion = sync.lastIndexOf(
      "assertCclbaMembershipTransitionSane(",
    );
    const publish = sync.lastIndexOf("replaceCclbaMembershipAtomically(normalized, true, snapshot)");
    expect(priorLiveCount).toBeGreaterThan(sourceSection);
    expect(assertion).toBeGreaterThan(priorLiveCount);
    expect(assertion).toBeGreaterThan(-1);
    expect(membershipAssertion).toBeGreaterThan(assertion);
    expect(publish).toBeGreaterThan(membershipAssertion);

    const start = sync.indexOf("async function replaceCclbaMembershipAtomically");
    const end = sync.indexOf("async function crossReferenceZones", start);
    const block = sync.slice(start, end);
    expect(block).toContain("WITH incoming AS MATERIALIZED");
    expect(block).toContain("snapshot_published AS (");
    expect(block).toContain("INSERT INTO vacant_source_snapshots");
    expect(block).toContain("ON CONFLICT (source, source_dataset_id, source_retrieved_at)");
    expect(block).toContain("upserted AS (");
    expect(block).toContain("retired AS (");
    expect(block).toContain("cleared AS (");
    expect(block).toContain("WHERE vp.source = 'cclba'");
    expect(block).toContain("FROM snapshot_published");
    expect(block).toContain("CCLBA source coverage was not published atomically");
  });

  it("keeps every located CCLBA row in the static fallback and checks the export", () => {
    const start = sync.indexOf("async function generateStaticFile");
    const end = sync.indexOf("async function loadLatestCclbaSourceCoverage", start);
    const block = sync.slice(start, end);

    expect(block).toContain("WHERE source = 'cclba'");
    expect(block).toContain(
      "assertStaticFallbackCclbaPublication(rows, cclbaSourceCoverage)",
    );
  });
});
