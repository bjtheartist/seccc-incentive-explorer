import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCommunityInvestment } from "../community-investment";
import { loadManifest, manifestContentHash } from "../../scripts/lib/investment-manifest";

/**
 * Sol gate finding 1 (BLOCKER) — "The committed export and fresh audit also
 * carry different manifest hashes... add audit/export/manifest hash-equality
 * and clean-regeneration tests."
 *
 * The manifest is read exactly once per artifact (export, fresh audit) and
 * each artifact stamps the SAME sha256 it read. If the manifest changes
 * without every artifact being regenerated afterward, this test catches the
 * drift immediately instead of shipping three documents that each silently
 * describe a different input universe.
 */
describe("manifest hash equality across export / audit / docs (Sol gate finding 1)", () => {
  // manifestContentHash (source list only), NOT a raw-file hash — the raw
  // file carries a `generatedAt` stamp that changes on every regeneration
  // regardless of content. See its doc comment in scripts/lib/investment-manifest.ts.
  const liveManifestHash = manifestContentHash(loadManifest());

  it("the committed export's meta.sourceManifestHash matches the committed manifest.json", () => {
    const data = loadCommunityInvestment()!;
    expect(data.meta.sourceManifestHash).toBe(liveManifestHash);
  });

  it("the fresh foundation audit's bound_manifest_hash matches the committed manifest.json", () => {
    const auditPath = join(process.cwd(), "data/curated/investment-inputs/foundation_audit_fresh.json");
    const audit = JSON.parse(readFileSync(auditPath, "utf8")) as { bound_manifest_hash: string | null };
    expect(audit.bound_manifest_hash).toBe(liveManifestHash);
  });

  it("the fresh foundation audit's bound_export_content_hash matches the committed export's exportContentHash", () => {
    const data = loadCommunityInvestment()!;
    const auditPath = join(process.cwd(), "data/curated/investment-inputs/foundation_audit_fresh.json");
    const audit = JSON.parse(readFileSync(auditPath, "utf8")) as { bound_export_content_hash: string };
    expect(audit.bound_export_content_hash).toBe(data.meta.exportContentHash);
  });

  it("the exclusion ledger's boundExportContentHash matches the committed export's exportContentHash", () => {
    const data = loadCommunityInvestment()!;
    const ledgerPath = join(process.cwd(), "data/private/investment-exclusion-ledger.json");
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as { boundExportContentHash: string };
    expect(ledger.boundExportContentHash).toBe(data.meta.exportContentHash);
  });
});
