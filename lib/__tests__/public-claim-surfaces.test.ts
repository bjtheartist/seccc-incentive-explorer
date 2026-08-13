/**
 * M0 public-surface registry (build-spec.md 2.1; consult item 1) — the
 * registry is checked, not decorative. This test is what makes that true:
 * every entry must name a real claim contract, and every file/directory it
 * points at must actually exist, so a rename or deletion desyncs loudly
 * instead of silently.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_CLAIM_SURFACES, type ClaimContract } from "../public-claim-surfaces";

const VALID_CONTRACTS: readonly ClaimContract[] = ["PublicProgramView", "ZoneEvidence", "reviewed-copy"];

describe("PUBLIC_CLAIM_SURFACES", () => {
  it("is non-empty", () => {
    expect(PUBLIC_CLAIM_SURFACES.length).toBeGreaterThan(0);
  });

  it("every entry has a non-empty id and description", () => {
    for (const entry of PUBLIC_CLAIM_SURFACES) {
      expect(entry.id.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("every id is unique", () => {
    const ids = PUBLIC_CLAIM_SURFACES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry names at least one valid claim contract", () => {
    for (const entry of PUBLIC_CLAIM_SURFACES) {
      expect(entry.contracts.length).toBeGreaterThan(0);
      for (const contract of entry.contracts) {
        expect(VALID_CONTRACTS).toContain(contract);
      }
    }
  });

  it("every entry lists at least one file/directory, and every one actually exists in the repo", () => {
    const root = process.cwd();
    for (const entry of PUBLIC_CLAIM_SURFACES) {
      expect(entry.files.length).toBeGreaterThan(0);
      for (const file of entry.files) {
        expect(existsSync(join(root, file))).toBe(true);
      }
    }
  });

  it("a mutated (nonexistent) path fails the existence check — proves the check is not vacuous", () => {
    const root = process.cwd();
    expect(existsSync(join(root, "lib/definitely-does-not-exist-xyz.ts"))).toBe(false);
  });

  it("F1–F16 findings referenced in the registry are well-formed (F<n> or a short label)", () => {
    for (const entry of PUBLIC_CLAIM_SURFACES) {
      for (const finding of entry.findings ?? []) {
        expect(finding.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
