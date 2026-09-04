import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIRST_VISIT_GUIDE_STORAGE_KEY } from "@/lib/first-visit-guide";
import { INVESTMENT_GUIDE_STORAGE_KEY } from "@/lib/investment-guide";
import {
  MAP_GUIDE_STORAGE_KEY,
  MAP_GUIDE_VERSION,
  MAP_TOUR_DEMO_ADDRESS,
  MAP_TOUR_ILLUSTRATIVE_NOTE,
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

/**
 * The map tour's anchors live across five source files (unlike the investment
 * tour's single page), so the canary maps each step key to the one file
 * expected to carry its anchor.
 *
 * `map-dossier` is declared as `tourAnchor="map-dossier"` — MapDossierCard's
 * DossierSection forwards that prop straight into `data-tour`, asserted just
 * below — and `map-hint` is an element the tour itself injects, so its
 * "source" is lib/map-guide.ts.
 */
const ANCHOR_SOURCES: Record<string, string> = {
  "map-search": "../../components/map/MapSearch.tsx",
  "map-dossier": "../../components/map/MapDossierCard.tsx",
  "map-presets": "../../components/map/MapLegendPanel.tsx",
  "map-hint": "../map-guide.ts",
  "nav-report": "../../components/layout/Header.tsx",
};

describe("map tour step definitions", () => {
  it("defines five unique stops, in the owner-approved order", () => {
    expect(MAP_TOUR_STEPS).toHaveLength(5);
    expect(MAP_TOUR_STEPS.map((step) => step.key)).toEqual([
      "map-search",
      "map-dossier",
      "map-presets",
      "map-hint",
      "nav-report",
    ]);
    expect(new Set(MAP_TOUR_STEPS.map((step) => step.selector)).size).toBe(5);
  });

  it("no longer anchors any stop to the whole map canvas", () => {
    // The regression this rebuild exists to kill: a stop highlighting
    // `map-canvas` cuts a hole the size of the viewport, so the dim reads as
    // every OTHER thing on the page being ghosted out.
    for (const step of MAP_TOUR_STEPS) {
      expect(step.selector, step.key).not.toContain("map-canvas");
    }
  });

  it("anchors every data-tour selector to an attribute that actually exists in its source file", () => {
    for (const step of MAP_TOUR_STEPS) {
      const match = /^\[data-tour="([^"]+)"\]$/.exec(step.selector);
      if (!match) throw new Error(`${step.key}: expected a bare data-tour selector`);
      const sourcePath = ANCHOR_SOURCES[step.key];
      if (!sourcePath) throw new Error(`${step.key}: no anchor source registered`);
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
      const declared =
        source.includes(`data-tour="${match[1]}"`) ||
        source.includes(`tourAnchor="${match[1]}"`);
      expect(declared, `${step.key} → ${sourcePath}`).toBe(true);
    }
  });

  it("routes DossierSection's tourAnchor prop into a real data-tour attribute", () => {
    // Guards the one indirection the canary above allows.
    const source = readFileSync(
      new URL("../../components/map/MapDossierCard.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("<details data-tour={tourAnchor}");
  });

  it("pairs every perform with an undo, and never ships one without the other", () => {
    // A stop that CHANGES the page and cannot change it back leaves the
    // visitor stranded in a demo state they did not ask for — the demo
    // address still in the search box, a preset they never picked, a hint
    // marker sitting on the map.
    for (const step of MAP_TOUR_STEPS) {
      expect(Boolean(step.perform), `${step.key}: perform`).toBe(Boolean(step.undo));
    }

    // The four acting stops, named — so deleting a perform is a failure
    // rather than a silently weaker tour.
    expect(MAP_TOUR_STEPS.filter((step) => step.perform).map((step) => step.key)).toEqual([
      "map-search",
      "map-dossier",
      "map-presets",
      "map-hint",
    ]);
    expect(MAP_TOUR_STEPS.find((step) => step.key === "nav-report")?.perform).toBeUndefined();
  });

  it("types a demo address on the corridor the stops that follow depend on", () => {
    expect(MAP_TOUR_DEMO_ADDRESS).toBe("1500 E 87th St, Chicago, IL 60619");
  });
});

describe("map tour illustrative-only disclosure", () => {
  const DEMO_RESULT_STOPS = ["map-search", "map-dossier", "map-hint"];

  it("carries the illustrative line on every stop that is showing the demo result", () => {
    for (const key of DEMO_RESULT_STOPS) {
      const step = MAP_TOUR_STEPS.find((s) => s.key === key);
      expect(step?.note, key).toBe(MAP_TOUR_ILLUSTRATIVE_NOTE);
      expect(step?.note, key).toMatch(/illustration only/i);
      expect(step?.note, key).toMatch(/search your own address/i);
    }
  });

  it("puts that line into the popover body a visitor actually reads", () => {
    for (const key of DEMO_RESULT_STOPS) {
      const step = MAP_TOUR_STEPS.find((s) => s.key === key)!;
      const html = mapTourPopoverHtml(step);
      expect(html, key).toContain(step.description);
      expect(html, key).toContain(MAP_TOUR_ILLUSTRATIVE_NOTE);
      // Rendered in the muted mono label style, not as body copy.
      expect(html, key).toContain('class="cie-tour-note"');
    }
  });

  it("does not tack the caveat onto stops that show nothing demo-specific", () => {
    for (const key of ["map-presets", "nav-report"]) {
      const step = MAP_TOUR_STEPS.find((s) => s.key === key);
      expect(step?.note, key).toBeUndefined();
      expect(mapTourPopoverHtml(step!), key).not.toContain("cie-tour-note");
    }
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
    // Same falsifiable ban as the other tours' guards: no quantity claims in
    // frozen tour copy, including spelled-out magnitudes and symbol-only
    // quantities. The demo ADDRESS has digits, of course — it is typed into
    // the page, never written into frozen copy, which is why it is asserted
    // as a constant above and banned here.
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

  it("keeps the overlap disclaimer on the stop that now shows the overlaps", () => {
    // Moved from the old citywide-glance stop to the dossier stop, because
    // that is where a visitor now reads the zones touching an address. The
    // sentence's MEANING is the public-claim guard, not its position.
    const dossierStep = MAP_TOUR_STEPS.find((step) => step.key === "map-dossier");
    expect(dossierStep?.description).toMatch(/starting point for program-by-program review/i);
    expect(dossierStep?.description).toMatch(
      /do not by themselves confirm eligibility or stacking/i,
    );

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

  it("tells the visitor all three ways to interrogate the map", () => {
    const hintStep = MAP_TOUR_STEPS.find((step) => step.key === "map-hint");
    expect(hintStep?.description).toMatch(/click/i);
    expect(hintStep?.description).toMatch(/right-click/i);
    expect(hintStep?.description).toMatch(/tap/i);
  });

  it("closes on the nav control it actually anchors to", () => {
    const reportStep = MAP_TOUR_STEPS.find((step) => step.key === "nav-report");
    expect(reportStep?.description).toContain("Generate Report");
    // One sentence, per the approved design.
    expect(reportStep?.description.split(/(?<=\.)\s+/)).toHaveLength(1);
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
