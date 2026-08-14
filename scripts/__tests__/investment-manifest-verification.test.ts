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

    /**
     * Sol gate finding 1 (round 4) — "geocode-cache.json must enter the
     * manifest and pass the same export-time byte verification as every
     * other input — no file the exporter reads may bypass it." Prior to this
     * round geocode-cache was carved out of DELIBERATELY_NOT_READ_MANIFEST_IDS
     * and read via a raw readFileSync in loadGeocodeCache(), so a tampered
     * on-disk cache would have been silently accepted. It now goes through
     * verifiedRead() (scripts/export-community-investment.ts's
     * loadGeocodeCache) exactly like every csv/tsv input — this test proves
     * the underlying primitive treats a geocode-cache-shaped entry no
     * differently from any other: a one-byte tamper is still refused.
     * scripts/__tests__/export-community-investment-manifest-coverage.test.ts
     * separately proves the REAL exporter actually routes geocode-cache.json
     * through this function on a real run.
     */
    it("throws on a ONE-BYTE tamper of a geocode-cache-shaped entry (the same guarantee applies to it as every other input)", () => {
      const cacheContent = '{\n  "123 Main St, Chicago, IL": { "lat": 41.8, "lng": -87.6 }\n}\n';
      const manifest: InvestmentManifest = {
        schemaVersion: 1,
        generatedAt: "2026-01-01T00:00:00.000Z",
        note: "fixture",
        sources: [
          {
            id: "geocode-cache",
            file: "geocode-cache.json",
            label: "Derived Census-geocoder cache — read AND written by the exporter itself, not a source",
            cadence: "manual",
            refreshMethod: "written automatically by npm run data:export:investment; never hand-edited",
            valueField: null,
            decreasePolicy: "not_refreshed",
            vintage: "2026-01-01",
            contentHash: createHash("sha256").update(cacheContent).digest("hex"),
          },
        ],
      };
      expect(() => verifyManifestInputBytes(manifest, "geocode-cache.json", cacheContent)).not.toThrow();

      const tampered = cacheContent.replace("41.8", "41.9"); // one coordinate digit flipped
      expect(() => verifyManifestInputBytes(manifest, "geocode-cache.json", tampered)).toThrow(
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
