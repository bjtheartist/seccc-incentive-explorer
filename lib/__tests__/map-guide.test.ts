import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIRST_VISIT_GUIDE_STORAGE_KEY } from "@/lib/first-visit-guide";
import { INVESTMENT_GUIDE_STORAGE_KEY } from "@/lib/investment-guide";
import {
  MAP_GUIDE_STORAGE_KEY,
  MAP_GUIDE_VERSION,
  MAP_TOUR_STEPS,
  readMapGuidePreference,
  writeMapGuidePreference,
} from "@/lib/map-guide";

function memoryStorage(initial: Record<string, string> = {}) {
  const values: Record<string, string> = { ...initial };
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, next: string) => {
      values[key] = next;
    },
    snapshot: () => ({ ...values }),
  };
}

describe("map guide storage key isolation", () => {
  it("uses a key wholly separate from the other tours' keys", () => {
    expect(MAP_GUIDE_STORAGE_KEY).not.toBe(FIRST_VISIT_GUIDE_STORAGE_KEY);
    expect(MAP_GUIDE_STORAGE_KEY).not.toBe(INVESTMENT_GUIDE_STORAGE_KEY);
    expect(MAP_GUIDE_STORAGE_KEY).toBe("cie:map-guide");
  });

  it("completing or skipping the map tour never writes another tour's key", () => {
    for (const status of ["completed", "skipped"] as const) {
      const storage = memoryStorage();
      writeMapGuidePreference(storage, status);

      expect(storage.snapshot()[MAP_GUIDE_STORAGE_KEY]).toBeDefined();
      expect(storage.snapshot()[FIRST_VISIT_GUIDE_STORAGE_KEY]).toBeUndefined();
      expect(storage.snapshot()[INVESTMENT_GUIDE_STORAGE_KEY]).toBeUndefined();
    }
  });

  it("pre-existing preferences for the other tours are untouched by reading or writing the map key", () => {
    const sitewide = JSON.stringify({
      version: 1,
      status: "completed",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const storage = memoryStorage({ [FIRST_VISIT_GUIDE_STORAGE_KEY]: sitewide });

    expect(readMapGuidePreference(storage)).toBeNull();
    writeMapGuidePreference(storage, "completed");
    expect(storage.snapshot()[FIRST_VISIT_GUIDE_STORAGE_KEY]).toBe(sitewide);
  });
});

describe("map guide preference", () => {
  it("persists a versioned completion", () => {
    const storage = memoryStorage();
    const preference = writeMapGuidePreference(storage, "completed");

    expect(preference.version).toBe(MAP_GUIDE_VERSION);
    expect(preference.status).toBe("completed");
    expect(JSON.parse(storage.snapshot()[MAP_GUIDE_STORAGE_KEY])).toEqual(preference);
  });

  it("recognizes completed and skipped preferences for the current version", () => {
    for (const status of ["completed", "skipped"] as const) {
      const storage = memoryStorage({
        [MAP_GUIDE_STORAGE_KEY]: JSON.stringify({
          version: MAP_GUIDE_VERSION,
          status,
          updatedAt: "2026-08-12T12:00:00.000Z",
        }),
      });
      expect(readMapGuidePreference(storage)?.status).toBe(status);
    }
  });

  it("reopens after a version change and tolerates malformed or blocked storage", () => {
    const old = memoryStorage({
      [MAP_GUIDE_STORAGE_KEY]: JSON.stringify({
        version: MAP_GUIDE_VERSION - 1,
        status: "completed",
        updatedAt: "x",
      }),
    });
    expect(readMapGuidePreference(old)).toBeNull();
    expect(
      readMapGuidePreference(memoryStorage({ [MAP_GUIDE_STORAGE_KEY]: "not-json" })),
    ).toBeNull();
    expect(
      readMapGuidePreference({
        getItem() {
          throw new Error("storage blocked");
        },
      }),
    ).toBeNull();
  });
});

/**
 * The map tour's anchors live across four component files (unlike the
 * investment tour's single page), so the canary maps each step key to the
 * one source file expected to carry its data-tour attribute.
 */
const ANCHOR_SOURCES: Record<string, string> = {
  "map-search": "../../components/map/MapSearch.tsx",
  "map-presets": "../../components/map/MapLegendPanel.tsx",
  "map-canvas": "../../components/map/MapView.tsx",
  "map-glance": "../../components/map/IncentiveGlance.tsx",
};

describe("map tour step definitions", () => {
  it("defines four unique steps", () => {
    expect(MAP_TOUR_STEPS).toHaveLength(4);
    expect(new Set(MAP_TOUR_STEPS.map((step) => step.key)).size).toBe(4);
    expect(new Set(MAP_TOUR_STEPS.map((step) => step.selector)).size).toBe(4);
  });

  it("anchors every data-tour selector to an attribute that actually exists in its source file", () => {
    for (const step of MAP_TOUR_STEPS) {
      const match = /^\[data-tour="([^"]+)"\]$/.exec(step.selector);
      if (!match) throw new Error(`${step.key}: expected a bare data-tour selector`);
      const sourcePath = ANCHOR_SOURCES[step.key];
      if (!sourcePath) throw new Error(`${step.key}: no anchor source registered`);
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
      expect(source, `${step.key} → ${sourcePath}`).toContain(`data-tour="${match[1]}"`);
    }
  });
});

/** Every string the tour renders, labelled so a failure names the offending field. */
function tourCopyFields(): Array<[string, string]> {
  return MAP_TOUR_STEPS.flatMap((step): Array<[string, string]> => [
    [`${step.key}.title`, step.title],
    [`${step.key}.description`, step.description],
  ]);
}

describe("map tour copy boundaries", () => {
  it("carries no hardcoded totals, dollar figures, or record counts", () => {
    // Same falsifiable ban as the other tours' guards: no quantity claims in
    // frozen tour copy, including spelled-out magnitudes and symbol-only
    // quantities.
    const bannedQuantityWords =
      /\b(dozen|hundred|thousand|million|billion|percent)\b|[$%]|\d/i;
    for (const [field, text] of tourCopyFields()) {
      expect(text, field).not.toMatch(bannedQuantityWords);
    }
  });

  it("never promises an outcome the map cannot give", () => {
    for (const [field, text] of tourCopyFields()) {
      expect(text, field).not.toMatch(
        /official determination|guarantee|pre-?approv|you qualify|confirmed receipt/i,
      );
    }
  });

  it("names only the inputs the map search can resolve", () => {
    // Same input-honesty rule the sitewide tour learned in production: the
    // search resolves a street address or a business name; naming a PIN,
    // parcel, or ward walks the visitor into its not-found error.
    const searchStep = MAP_TOUR_STEPS.find((step) => step.key === "map-search");
    expect(`${searchStep?.title} ${searchStep?.description}`).not.toMatch(
      /\bPINs?\b|parcel (number|id)|\bward\b/i,
    );
  });

  it("keeps the overlap disclaimer, and only restates a limit the page itself already states", () => {
    const glanceStep = MAP_TOUR_STEPS.find((step) => step.key === "map-glance");
    expect(glanceStep?.description).toMatch(/does not by itself confirm eligibility/i);

    // The claim must be checkable against the page's own copy, not invented.
    const mapPageSource = readFileSync(new URL("../../app/map/page.tsx", import.meta.url), "utf8");
    expect(mapPageSource).toMatch(/overlap alone does not confirm eligibility/i);
  });

  it("does not enumerate individual preset bundles in frozen copy", () => {
    // The legend rendered six preset chips at the time of writing and the set
    // will keep moving; naming bundles in frozen tour copy rots the same way
    // hardcoded totals do (the tour would confidently list four of six). The
    // step teaches the mechanism, not the roster.
    const presetsStep = MAP_TOUR_STEPS.find((step) => step.key === "map-presets");
    expect(presetsStep?.description).toMatch(/preset/i);
    for (const bundle of ["city", "state", "federal", "environmental", "zoning", "vacancy"]) {
      expect(presetsStep?.description.toLowerCase(), bundle).not.toContain(bundle);
    }
  });
});
