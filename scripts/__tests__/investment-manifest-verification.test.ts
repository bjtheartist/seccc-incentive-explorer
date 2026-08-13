import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertNoOrphanedManifestSources,
  verifyManifestInputBytes,
  type InvestmentManifest,
} from "../lib/investment-manifest";

/**
 * Sol gate finding 1 (BLOCKER, round 2) — "an entry present in the manifest
 * but unknown to the exporter must fail loudly (and vice versa — exporter
 * consuming a file absent from the manifest fails); export-time verification
 * compares each manifest content-hash against the ACTUAL input file bytes at
 * read time, not a generation-time echo."
 *
 * Both directions, and the byte-tamper case, tested directly against a
 * SYNTHETIC fixture manifest — never the real committed manifest.json, so
 * these tests exercise the failure paths the real (currently-clean) manifest
 * can't exhibit on its own.
 */
describe("investment manifest export-time verification (Sol gate finding 1)", () => {
  function fixtureManifest(): InvestmentManifest {
    return {
      schemaVersion: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      note: "fixture",
      sources: [
        {
          id: "fixture-source",
          file: "fixture_source.csv",
          label: "Fixture source",
          cadence: "manual",
          refreshMethod: "n/a",
          valueField: null,
          decreasePolicy: "not_refreshed",
          vintage: "2026-01-01",
          contentHash: createHash("sha256").update("a,b\n1,2\n").digest("hex"),
        },
      ],
    };
  }

  describe("verifyManifestInputBytes", () => {
    it("passes silently when the file's actual bytes match the declared contentHash", () => {
      const manifest = fixtureManifest();
      expect(() => verifyManifestInputBytes(manifest, "fixture_source.csv", "a,b\n1,2\n")).not.toThrow();
    });

    it("throws when the file has NO manifest entry at all (exporter consuming an undeclared file)", () => {
      const manifest = fixtureManifest();
      expect(() => verifyManifestInputBytes(manifest, "totally_undeclared_file.csv", "x,y\n1,2\n")).toThrow(
        /NO entry in.*manifest\.json/,
      );
    });

    it("throws on a ONE-BYTE tamper of the input file (hash-mismatch failure)", () => {
      const manifest = fixtureManifest();
      // Same file, ONE byte different from what produced the committed contentHash.
      const tampered = "a,b\n1,3\n"; // "2" -> "3"
      expect(() => verifyManifestInputBytes(manifest, "fixture_source.csv", tampered)).toThrow(
        /does not match the .* ACTUAL bytes at read time/,
      );
    });
  });

  describe("assertNoOrphanedManifestSources", () => {
    it("passes when every manifest source is either touched or documented as deliberately-not-read", () => {
      const manifest = fixtureManifest();
      expect(() =>
        assertNoOrphanedManifestSources(manifest, new Set(["fixture_source.csv"]), new Set()),
      ).not.toThrow();
      expect(() => assertNoOrphanedManifestSources(manifest, new Set(), new Set(["fixture-source"]))).not.toThrow();
    });

    it("throws when a manifest source is neither touched NOR documented as deliberately-not-read (a source added to the manifest that the exporter's code doesn't know about)", () => {
      const manifest = fixtureManifest();
      manifest.sources.push({
        id: "new-source-nobody-wired-up",
        file: "brand_new_file.csv",
        label: "A source someone just added to the manifest",
        cadence: "manual",
        refreshMethod: "n/a",
        valueField: null,
        decreasePolicy: "not_refreshed",
        vintage: "2026-01-01",
        contentHash: "deadbeef",
      });
      expect(() =>
        assertNoOrphanedManifestSources(manifest, new Set(["fixture_source.csv"]), new Set()),
      ).toThrow(/new-source-nobody-wired-up/);
    });
  });
});
