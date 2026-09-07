import { describe, expect, it } from "vitest";
import { FIRST_VISIT_GUIDE_STORAGE_KEY } from "@/lib/first-visit-guide";
import { INVESTMENT_GUIDE_STORAGE_KEY } from "@/lib/investment-guide";
import {
  MAP_GUIDE_STORAGE_KEY,
  MAP_GUIDE_VERSION,
  MAP_TOUR_STEPS,
  chooseTourSide,
  fitsHighlightBudget,
  mapTourPopoverHtml,
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

  it("offers the rebuilt tour once to a visitor who resolved the old four-stop one", () => {
    // The version bump IS the re-offer mechanism: a v1 "completed" (or
    // "skipped") preference reads as no preference, so MapSpotlight's
    // auto-start fires exactly once more, and the outcome it then writes is
    // stamped v2 and never reopens again.
    expect(MAP_GUIDE_VERSION).toBe(2);
    for (const status of ["completed", "skipped"] as const) {
      const storage = memoryStorage({
        [MAP_GUIDE_STORAGE_KEY]: JSON.stringify({
          version: 1,
          status,
          updatedAt: "2026-08-12T12:00:00.000Z",
        }),
      });
      expect(readMapGuidePreference(storage), status).toBeNull();

      writeMapGuidePreference(storage, status);
      expect(readMapGuidePreference(storage)).toMatchObject({ version: 2, status });
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

describe("map tour popover copy", () => {
  it("escapes descriptions and notes before rendering HTML", () => {
    expect(mapTourPopoverHtml({
      ...MAP_TOUR_STEPS[0], description: "<script> & text", note: "<note>",
    })).toBe('&lt;script&gt; &amp; text<span class="cie-tour-note">&lt;note&gt;</span>');
  });

  it("renders a plain description when there is no note", () => {
    expect(mapTourPopoverHtml({ ...MAP_TOUR_STEPS[1], note: undefined }))
      .toBe(MAP_TOUR_STEPS[1].description);
  });
});

/** Every string the tour renders, labelled so a failure names the offending field. */
function tourCopyFields(): Array<[string, string]> {
  return MAP_TOUR_STEPS.flatMap((step): Array<[string, string]> => [
    [`${step.key}.title`, step.title],
    [`${step.key}.description`, step.description],
    ...(step.note ? ([[`${step.key}.note`, step.note]] as Array<[string, string]>) : []),
  ]);
}

describe("map tour copy boundaries", () => {
  it("carries no hardcoded totals, dollar figures, or record counts", () => {
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
    expect(searchStep?.description).toMatch(/street address or a business name/i);
    expect(searchStep?.description).toMatch(/centers/i);
  });

  it("keeps the overlap disclaimer on the area-details explanation", () => {
    const dossierStep = MAP_TOUR_STEPS.find((step) => step.key === "map-inspect");
    expect(dossierStep?.description).toMatch(/starting point for program-by-program review/i);
    expect(dossierStep?.description).toMatch(
      /do not by themselves confirm eligibility or stacking/i,
    );

  });

  it("does not enumerate individual preset bundles in frozen copy", () => {
    // The legend rendered six preset chips at the time of writing and the set
    // will keep moving; naming bundles in frozen tour copy rots the same way
    // hardcoded totals do (the tour would confidently list four of six). The
    // step teaches the mechanism, not the roster.
    const presetsStep = MAP_TOUR_STEPS.find((step) => step.key === "map-layers");
    expect(presetsStep?.description).toMatch(/preset/i);
    for (const bundle of ["city", "state", "federal", "environmental", "zoning", "vacancy"]) {
      expect(presetsStep?.description.toLowerCase(), bundle).not.toContain(bundle);
    }
  });

  it("tells the visitor all three ways to interrogate the map", () => {
    const hintStep = MAP_TOUR_STEPS.find((step) => step.key === "map-inspect");
    expect(hintStep?.description).toMatch(/click/i);
    expect(hintStep?.description).toMatch(/right-click/i);
    expect(hintStep?.description).toMatch(/tap/i);
  });

  it("closes on the nav control it actually anchors to", () => {
    const reportStep = MAP_TOUR_STEPS.find((step) => step.key === "nav-report");
    expect(reportStep?.description).toContain("Generate Report");
    expect(reportStep?.description).toMatch(/phone.*menu/i);
  });
});

describe("popover placement guards", () => {
  const viewport = { width: 1280, height: 800 };

  it("rejects a highlight that would swallow the viewport", () => {
    // 60% of 1280x800 is 614,400px².
    expect(fitsHighlightBudget({ width: 1280, height: 800 }, viewport)).toBe(false);
    expect(fitsHighlightBudget({ width: 1000, height: 700 }, viewport)).toBe(false);
    expect(fitsHighlightBudget({ width: 340, height: 120 }, viewport)).toBe(true);
    // A zero-area viewport must not divide by zero into a rejection.
    expect(fitsHighlightBudget({ width: 10, height: 10 }, { width: 0, height: 0 })).toBe(true);
  });

  it("keeps the preferred side when it has room", () => {
    const rect = { top: 300, bottom: 340, left: 500, right: 800 };
    expect(chooseTourSide(rect, viewport, "bottom")).toBe("bottom");
  });

  it("moves off a side with no room instead of letting the popover be clamped", () => {
    // An anchor pinned to the top of the viewport, horizontally centred:
    // "top" has 8px, "bottom" has the rest.
    const rect = { top: 8, bottom: 48, left: 540, right: 740 };
    expect(chooseTourSide(rect, viewport, "top")).toBe("bottom");

    // An anchor hard against the right edge cannot open to the right.
    const rightEdge = { top: 300, bottom: 340, left: 1180, right: 1270 };
    expect(chooseTourSide(rightEdge, viewport, "right")).not.toBe("right");
  });

  it("holds the preferred side when nothing has more room than it", () => {
    // Everything is cramped: driver.js's own centred fallback owns this case,
    // so this must not thrash between equally bad sides.
    const cramped = { top: 20, bottom: 780, left: 20, right: 1260 };
    expect(chooseTourSide(cramped, viewport, "bottom")).toBe("bottom");
  });
});
