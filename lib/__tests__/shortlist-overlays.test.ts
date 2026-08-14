/**
 * review5 S2 — TEST requirement: "inject one failed relevant layer...
 * no negative for that layer, known positives preserved." Exercises
 * resolveCandidateOverlays (lib/shortlist-overlays.ts), the function
 * scripts/export-shortlist-universe.ts now calls instead of the old
 * error-swallowing checkStaticZoneKeys.
 *
 * No live DB or real broken fixture files (Hard Rule) — the failure is
 * injected via resolveZoneEvidenceV2's own `loadZoneFile` test hook.
 */
import { describe, expect, it } from "vitest";
import { resolveCandidateOverlays } from "../shortlist-overlays";

// A 0.01deg square around (41.75, -87.6) — big enough to contain the test point.
const MATCHING_SQUARE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Test TIF District" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-87.61, 41.74],
            [-87.59, 41.74],
            [-87.59, 41.76],
            [-87.61, 41.76],
            [-87.61, 41.74],
          ],
        ],
      },
    },
  ],
};

const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

// A real, well-formed feature far from the test point — a "clean scan,
// zero matches" case, distinct from an empty collection (which resolves
// `unknown/layer_missing`, not `not_matched` — see checkStaticZoneV2's own
// doc comment in lib/zones-check.ts).
const NON_MATCHING_SQUARE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Somewhere Else" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-88.5, 42.5],
            [-88.4, 42.5],
            [-88.4, 42.6],
            [-88.5, 42.6],
            [-88.5, 42.5],
          ],
        ],
      },
    },
  ],
};

describe("resolveCandidateOverlays", () => {
  it("marks every overlay unknown (never present:false-as-confirmed) when the site has no coordinates", async () => {
    const overlays = await resolveCandidateOverlays(null, null);
    for (const key of ["ssa", "ccsa", "tif", "nof"] as const) {
      expect(overlays[key]).toEqual({ present: false, name: null, unknown: true });
    }
  });

  it("a known positive on one layer is preserved even when a DIFFERENT layer fails to load — no negative rendered for the failed layer", async () => {
    const overlays = await resolveCandidateOverlays(41.75, -87.6, {
      loadZoneFile: async (key: string) => {
        if (key === "nof") throw new Error("simulated: nof-corridors.geojson unreadable");
        if (key === "tif") return MATCHING_SQUARE;
        return NON_MATCHING_SQUARE;
      },
    });

    // Known positive preserved.
    expect(overlays.tif.present).toBe(true);
    expect(overlays.tif.unknown).toBe(false);
    expect(overlays.tif.name).toBe("Test TIF District");

    // The failed layer is UNKNOWN, never a confirmed `present: false`.
    expect(overlays.nof.unknown).toBe(true);
    expect(overlays.nof.present).toBe(false);

    // A genuinely checked layer (a real, non-empty, well-formed source
    // scanned clean with zero matches) still resolves to a confirmed
    // non-match — not swept into "unknown" just because a sibling layer
    // failed to load.
    expect(overlays.ssa.unknown).toBe(false);
    expect(overlays.ssa.present).toBe(false);
  });

  it("an EMPTY-but-loaded collection for a registered layer is unknown, not a confirmed non-match — nothing was actually loaded to test against", async () => {
    // Mirrors resolveZoneLayerEvidence's own documented rule (lib/zones-
    // check.ts): a well-formed empty FeatureCollection is NOT the same
    // evidence as "we scanned real boundaries and found nothing" — an
    // export bug that silently ships an empty layer file must not read as
    // a confirmed absence for every site.
    const overlays = await resolveCandidateOverlays(41.9, -87.9, {
      loadZoneFile: async () => EMPTY_COLLECTION,
    });
    for (const key of ["ssa", "ccsa", "tif", "nof"] as const) {
      expect(overlays[key].present).toBe(false);
      expect(overlays[key].unknown).toBe(true);
      expect(overlays[key].name).toBeNull();
    }
  });
});
