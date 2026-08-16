/**
 * Unit guards for the Site Shortlist map's pure half.
 *
 * The sandboxes this repo is developed in cannot paint mapbox WebGL at all —
 * the style-load event never fires, even on pages proven in production — so
 * these tests are the ONLY pre-deploy check the map panel gets. Everything the
 * component would otherwise decide inline is therefore a plain function here,
 * and each of the rules below is pinned rather than assumed:
 *
 *   • every infrastructure layer defaults OFF, and the stored form of "all off"
 *     is key REMOVAL (so a fresh tab starts from the documented default)
 *   • the grocery label discloses its own staleness, on the legend, always
 *     (the source is a table the City no longer maintains)
 *   • pin numbering matches the CARD numbering exactly, including when a
 *     coordinate-less record has to be dropped from the map
 *   • every payload-to-feature transform degrades to `[]` rather than throwing
 *     or inventing a point
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AIRPORTS,
  BADGE_PIN_COLORS,
  INFRASTRUCTURE_LAYERS,
  INFRASTRUCTURE_LAYERS_BY_ID,
  INFRASTRUCTURE_LAYERS_STORAGE_KEY,
  INFRASTRUCTURE_LAYER_IDS,
  airportFeatures,
  amenityPointFeatures,
  badgePinAccent,
  badgePinColor,
  defaultInfrastructureLayerVisibility,
  expresswayLineFeatures,
  infrastructureFeatures,
  infrastructureLayerId,
  infrastructureSourceId,
  isInfrastructureLayerId,
  loadStoredInfrastructureLayerVisibility,
  parseInfrastructureLayerVisibility,
  pinZoningBadgeText,
  railStationFeatures,
  serializeInfrastructureLayerVisibility,
  shortlistCardDomId,
  shortlistPinBounds,
  shortlistPinFeatures,
  storeInfrastructureLayerVisibility,
  withInfrastructureLayerVisibility,
  type InfrastructureLayerVisibility,
} from "../shortlist-map-layers";
import type { RankedShortlistCandidate } from "../shortlist-engine";

// ── Fixtures ────────────────────────────────────────────────────────────────

function candidate(overrides: Partial<RankedShortlistCandidate> = {}): RankedShortlistCandidate {
  return {
    key: "pin:20331000010000",
    address: "8000 S COTTAGE GROVE AVE",
    pin: "20331000010000",
    lat: 41.75,
    lon: -87.605,
    propertyType: "vacant_building",
    buildingSqft: 4200,
    lotSqft: 6000,
    zoningDistrict: "B3-2",
    zoningStatus: "resolved",
    badge: "aligned",
    badgeNote: "The mapped district family is broadly aligned with this project category.",
    ownerLabel: "Corporate / LLC · out-of-state mailing address (unverified)",
    incentiveCount: 2,
    saleYear: null,
    violation: false,
    conflictingPropertyTypes: false,
    overlays: {
      ssa: { present: false, name: null },
      ccsa: { present: false, name: null },
      tif: { present: false, name: null },
      nof: { present: false, name: null },
    },
    transitScore: null,
    score: 60,
    ...overrides,
  } as RankedShortlistCandidate;
}

/** Map-backed sessionStorage stub, matching lib/__tests__/owner-clusters-toggle. */
function fakeSessionStorage() {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── The catalog ─────────────────────────────────────────────────────────────

describe("infrastructure layer catalog", () => {
  it("carries every declared id exactly once, in catalog order", () => {
    expect(INFRASTRUCTURE_LAYERS.map((layer) => layer.id)).toEqual([
      ...INFRASTRUCTURE_LAYER_IDS,
    ]);
    expect(new Set(INFRASTRUCTURE_LAYERS.map((layer) => layer.id)).size).toBe(
      INFRASTRUCTURE_LAYERS.length,
    );
  });

  it("covers the seven layers the infrastructure lens promises", () => {
    expect([...INFRASTRUCTURE_LAYER_IDS]).toEqual([
      "rail",
      "expressways",
      "airports",
      "parks",
      "libraries",
      "schools",
      "grocery",
    ]);
  });

  it("labels the grocery layer with its own staleness", () => {
    // Non-negotiable: the City stopped maintaining the source table years ago,
    // so the legend must say so where the reader clicks, not in a footnote.
    expect(INFRASTRUCTURE_LAYERS_BY_ID.grocery.label).toBe("Grocery (city dataset, may lag)");
    expect(INFRASTRUCTURE_LAYERS_BY_ID.grocery.label.toLowerCase()).toContain("may lag");
    expect(INFRASTRUCTURE_LAYERS_BY_ID.grocery.sourceNote).toContain("no longer maintains");
  });

  it("points every fetched layer at a committed public file, and the airports at none", () => {
    for (const layer of INFRASTRUCTURE_LAYERS) {
      if (layer.id === "airports") {
        expect(layer.dataUrl).toBeNull();
        continue;
      }
      expect(layer.dataUrl).toMatch(/^\/data\/[a-z-]+\.(json|geojson)$/);
    }
  });

  it("namespaces its mapbox source and layer ids so nothing collides with the pins", () => {
    for (const id of INFRASTRUCTURE_LAYER_IDS) {
      expect(infrastructureSourceId(id)).toBe(`shortlist-infra-${id}`);
      expect(infrastructureLayerId(id, "dot")).toBe(`shortlist-infra-${id}-dot`);
      expect(infrastructureSourceId(id)).not.toContain("shortlist-pin");
    }
  });

  it("recognizes only real layer ids", () => {
    expect(isInfrastructureLayerId("parks")).toBe(true);
    expect(isInfrastructureLayerId("hospitals")).toBe(false);
    expect(isInfrastructureLayerId(null)).toBe(false);
    expect(isInfrastructureLayerId(7)).toBe(false);
  });
});

// ── Visibility record + persistence ─────────────────────────────────────────

describe("infrastructure layer visibility", () => {
  it("defaults every layer off", () => {
    const defaults = defaultInfrastructureLayerVisibility();
    for (const id of INFRASTRUCTURE_LAYER_IDS) expect(defaults[id]).toBe(false);
  });

  it("round-trips through serialize/parse", () => {
    const state = withInfrastructureLayerVisibility(
      withInfrastructureLayerVisibility(defaultInfrastructureLayerVisibility(), "rail", true),
      "grocery",
      true,
    );
    expect(parseInfrastructureLayerVisibility(serializeInfrastructureLayerVisibility(state))).toEqual(
      state,
    );
  });

  it("leaves the source record untouched when toggling", () => {
    const before = defaultInfrastructureLayerVisibility();
    const after = withInfrastructureLayerVisibility(before, "parks", true);
    expect(before.parks).toBe(false);
    expect(after.parks).toBe(true);
  });

  it("defaults everything off for malformed, empty, or non-object payloads", () => {
    const off = defaultInfrastructureLayerVisibility();
    expect(parseInfrastructureLayerVisibility(null)).toEqual(off);
    expect(parseInfrastructureLayerVisibility("")).toEqual(off);
    expect(parseInfrastructureLayerVisibility("{not json")).toEqual(off);
    expect(parseInfrastructureLayerVisibility("[true,true]")).toEqual(off);
    expect(parseInfrastructureLayerVisibility("null")).toEqual(off);
  });

  it("keeps valid fields and defaults only the unusable ones", () => {
    const parsed = parseInfrastructureLayerVisibility(
      JSON.stringify({ rail: true, parks: "yes", schools: 1, unknown_layer: true }),
    );
    expect(parsed.rail).toBe(true);
    // A non-boolean is never coerced into "on" — it falls back to the off default.
    expect(parsed.parks).toBe(false);
    expect(parsed.schools).toBe(false);
    expect(Object.keys(parsed).sort()).toEqual([...INFRASTRUCTURE_LAYER_IDS].sort());
  });

  it("returns the all-off default on SSR", () => {
    vi.stubGlobal("window", undefined);
    expect(loadStoredInfrastructureLayerVisibility()).toEqual(
      defaultInfrastructureLayerVisibility(),
    );
  });

  it("survives a remount within the same tab", () => {
    const storage = fakeSessionStorage();
    vi.stubGlobal("window", { sessionStorage: storage.api });

    storeInfrastructureLayerVisibility(
      withInfrastructureLayerVisibility(defaultInfrastructureLayerVisibility(), "libraries", true),
    );
    expect(loadStoredInfrastructureLayerVisibility().libraries).toBe(true);
  });

  it("stores the all-off default as key removal", () => {
    const storage = fakeSessionStorage();
    vi.stubGlobal("window", { sessionStorage: storage.api });

    storeInfrastructureLayerVisibility(
      withInfrastructureLayerVisibility(defaultInfrastructureLayerVisibility(), "rail", true),
    );
    expect(storage.store.has(INFRASTRUCTURE_LAYERS_STORAGE_KEY)).toBe(true);

    storeInfrastructureLayerVisibility(defaultInfrastructureLayerVisibility());
    expect(storage.store.has(INFRASTRUCTURE_LAYERS_STORAGE_KEY)).toBe(false);
    expect(loadStoredInfrastructureLayerVisibility()).toEqual(
      defaultInfrastructureLayerVisibility(),
    );
  });

  it("never throws when the store is blocked", () => {
    const blocked = {
      sessionStorage: {
        getItem() {
          throw new Error("blocked");
        },
        setItem() {
          throw new Error("blocked");
        },
        removeItem() {
          throw new Error("blocked");
        },
      },
    };
    vi.stubGlobal("window", blocked);

    const state: InfrastructureLayerVisibility = withInfrastructureLayerVisibility(
      defaultInfrastructureLayerVisibility(),
      "schools",
      true,
    );
    expect(() => storeInfrastructureLayerVisibility(state)).not.toThrow();
    expect(loadStoredInfrastructureLayerVisibility()).toEqual(
      defaultInfrastructureLayerVisibility(),
    );
  });
});

// ── Pins ────────────────────────────────────────────────────────────────────

describe("badge colors", () => {
  it("matches the card's zoning-badge palette", () => {
    expect(badgePinColor("aligned")).toBe(BADGE_PIN_COLORS.aligned.color);
    expect(badgePinColor("aligned")).toBe("#166534");
    expect(badgePinColor("not-aligned")).toBe("#A45B00");
    expect(badgePinColor("planned-development")).toBe("#7C3AED");
    expect(badgePinColor("unresolved")).toBe("#475569");
    expect(badgePinAccent("aligned")).toBe("#22C55E");
    expect(badgePinAccent("not-aligned")).toBe("#F59E0B");
  });
});

describe("shortlistCardDomId", () => {
  it("turns a PIN key into a legal, stable element id", () => {
    expect(shortlistCardDomId("20-33-100-001-0000")).toBe("shortlist-card-20-33-100-001-0000");
  });

  it("sanitizes the address@lat,lon fallback key", () => {
    const id = shortlistCardDomId("8000 S COTTAGE GROVE AVE@41.75000,-87.60500");
    expect(id.startsWith("shortlist-card-")).toBe(true);
    expect(id).not.toMatch(/[@,.\s]/);
    expect(id.endsWith("-")).toBe(false);
  });

  it("is deterministic", () => {
    expect(shortlistCardDomId("a b c")).toBe(shortlistCardDomId("a b c"));
  });
});

describe("pinZoningBadgeText", () => {
  it("repeats the card's badge label verbatim, including the unresolved fallback", () => {
    expect(pinZoningBadgeText(candidate({ badge: "aligned" }))).toBe("Broad family alignment");
    expect(pinZoningBadgeText(candidate({ badge: "unresolved" }))).toBe("District unresolved");
  });
});

describe("shortlistPinFeatures", () => {
  it("numbers pins exactly in rank order", () => {
    const features = shortlistPinFeatures([
      candidate({ key: "a", lat: 41.75, lon: -87.6 }),
      candidate({ key: "b", lat: 41.76, lon: -87.61 }),
      candidate({ key: "c", badge: "not-aligned", lat: 41.77, lon: -87.62 }),
    ]);
    expect(features.map((f) => f.properties?.markerNumber)).toEqual([1, 2, 3]);
    expect(features.map((f) => f.properties?.key)).toEqual(["a", "b", "c"]);
  });

  it("colors by badge and carries the card's zoning badge and jump target", () => {
    const [aligned, unresolved] = shortlistPinFeatures([
      candidate({ key: "a", lat: 41.75, lon: -87.6 }),
      candidate({ key: "b", badge: "unresolved", lat: 41.76, lon: -87.61 }),
    ]);
    expect(aligned.properties?.color).toBe(BADGE_PIN_COLORS.aligned.color);
    expect(aligned.properties?.zoningDistrict).toBe("B3-2");
    expect(aligned.properties?.zoningBadge).toBe("Broad family alignment");
    expect(aligned.properties?.domId).toBe(shortlistCardDomId("a"));
    expect(unresolved.properties?.color).toBe(BADGE_PIN_COLORS.unresolved.color);
    expect(unresolved.properties?.zoningBadge).toBe("District unresolved");
  });

  it("writes GeoJSON lon/lat order", () => {
    const [feature] = shortlistPinFeatures([candidate({ lat: 41.75, lon: -87.605 })]);
    expect(feature.geometry).toEqual({ type: "Point", coordinates: [-87.605, 41.75] });
  });

  it("drops coordinate-less records WITHOUT renumbering the ones that remain", () => {
    // The card list still shows the dropped record at its own number, so the
    // plotted pins must keep the numbers they would have had.
    const features = shortlistPinFeatures([
      candidate({ key: "a", lat: 41.75, lon: -87.6 }),
      candidate({ key: "null-island", lat: 0, lon: 0 }),
      candidate({ key: "c", lat: 41.77, lon: -87.62 }),
    ]);
    expect(features.map((f) => f.properties?.key)).toEqual(["a", "c"]);
    expect(features.map((f) => f.properties?.markerNumber)).toEqual([1, 3]);
  });

  it("filters by visible key without compacting original rank numbers", () => {
    const ranked = [
      candidate({ key: "a", lat: 41.75, lon: -87.6 }),
      candidate({ key: "b", lat: 41.76, lon: -87.61 }),
      candidate({ key: "c", lat: 41.77, lon: -87.62 }),
    ];
    const features = shortlistPinFeatures(ranked, new Set(["b", "c"]));
    expect(features.map((f) => f.properties?.key)).toEqual(["b", "c"]);
    expect(features.map((f) => f.properties?.markerNumber)).toEqual([2, 3]);
  });

  it("keeps a filtered coordinate-less record out of the map while preserving later ranks", () => {
    const ranked = [
      candidate({ key: "a", lat: 41.75, lon: -87.6 }),
      candidate({ key: "no-coordinate", lat: null, lon: null }),
      candidate({ key: "c", lat: 41.77, lon: -87.62 }),
    ];
    const features = shortlistPinFeatures(ranked, new Set(["no-coordinate", "c"]));
    expect(features.map((f) => f.properties?.key)).toEqual(["c"]);
    expect(features.map((f) => f.properties?.markerNumber)).toEqual([3]);
  });

  it("drops non-finite or null coordinates", () => {
    expect(shortlistPinFeatures([candidate({ lat: Number.NaN, lon: -87.6 })])).toHaveLength(0);
    expect(shortlistPinFeatures([candidate({ lat: null, lon: -87.6 })])).toHaveLength(0);
  });

  it("returns nothing for an empty list", () => {
    expect(shortlistPinFeatures([])).toEqual([]);
  });
});

describe("shortlistPinBounds", () => {
  it("spans every plotted pin as [west, south, east, north]", () => {
    const features = shortlistPinFeatures([
      candidate({ key: "a", lat: 41.75, lon: -87.62 }),
      candidate({ key: "b", lat: 41.78, lon: -87.6 }),
    ]);
    expect(shortlistPinBounds(features)).toEqual([-87.62, 41.75, -87.6, 41.78]);
  });

  it("is null when nothing is plottable", () => {
    expect(shortlistPinBounds([])).toBeNull();
  });
});

// ── Overlay transforms ──────────────────────────────────────────────────────

describe("railStationFeatures", () => {
  it("maps stations to dots labelled with their system", () => {
    const [feature] = railStationFeatures({
      stations: [{ name: "63rd", system: "CTA", lat: 41.78, lon: -87.63, ada: true }],
    });
    expect(feature.geometry).toEqual({ type: "Point", coordinates: [-87.63, 41.78] });
    expect(feature.properties?.label).toBe("63rd (CTA)");
    expect(feature.properties?.system).toBe("CTA");
  });

  it("skips rows with an unusable name or coordinate", () => {
    expect(
      railStationFeatures({
        stations: [
          { name: "", system: "CTA", lat: 41.7, lon: -87.6 },
          { name: "Ghost", system: "CTA", lat: "n/a", lon: -87.6 },
          { name: "Good", system: "Metra", lat: 41.7, lon: -87.6 },
        ],
      }),
    ).toHaveLength(1);
  });

  it("returns [] rather than throwing on a shapeless payload", () => {
    expect(railStationFeatures(null)).toEqual([]);
    expect(railStationFeatures({})).toEqual([]);
    expect(railStationFeatures({ stations: "nope" })).toEqual([]);
  });
});

describe("expresswayLineFeatures", () => {
  const network = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "expressway", name: "Dan Ryan Expy (I-90/94)" },
        geometry: { type: "LineString", coordinates: [[-87.62, 41.73], [-87.62, 41.74]] },
      },
      {
        type: "Feature",
        properties: { kind: "rail", name: "Red Line" },
        geometry: { type: "LineString", coordinates: [[-87.63, 41.73], [-87.63, 41.74]] },
      },
    ],
  };

  it("keeps only the expressway features, with their names", () => {
    const features = expresswayLineFeatures(network);
    expect(features).toHaveLength(1);
    expect(features[0].properties?.name).toBe("Dan Ryan Expy (I-90/94)");
  });

  it("never lets the file's rail lines leak into the expressway layer", () => {
    expect(
      expresswayLineFeatures(network).some((f) => f.properties?.name === "Red Line"),
    ).toBe(false);
  });

  it("skips features whose geometry is not a line", () => {
    expect(
      expresswayLineFeatures({
        features: [
          {
            type: "Feature",
            properties: { kind: "expressway", name: "Point-shaped" },
            geometry: { type: "Point", coordinates: [-87.6, 41.7] },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("returns [] on a shapeless payload", () => {
    expect(expresswayLineFeatures(undefined)).toEqual([]);
    expect(expresswayLineFeatures({ features: 3 })).toEqual([]);
  });
});

describe("amenityPointFeatures", () => {
  it("labels a park with its acreage and a plain amenity with just its name", () => {
    const [park, library] = amenityPointFeatures({
      points: [
        { name: "Tuley", lat: 41.75, lon: -87.6, acres: 4.2 },
        { name: "Whitney M. Young Branch", lat: 41.76, lon: -87.61 },
      ],
    });
    expect(park.properties?.label).toBe("Tuley · 4.2 acres");
    expect(library.properties?.label).toBe("Whitney M. Young Branch");
    expect(library.geometry).toEqual({ type: "Point", coordinates: [-87.61, 41.76] });
  });

  it("skips unusable rows and shapeless payloads", () => {
    expect(
      amenityPointFeatures({ points: [{ name: "No coords", lat: null, lon: null }] }),
    ).toEqual([]);
    expect(amenityPointFeatures(null)).toEqual([]);
    expect(amenityPointFeatures({ points: {} })).toEqual([]);
  });
});

describe("airportFeatures", () => {
  it("is the two static airports, needing no dataset at all", () => {
    expect(INFRASTRUCTURE_LAYERS_BY_ID.airports.dataUrl).toBeNull();
    expect(AIRPORTS).toHaveLength(2);
    const features = airportFeatures();
    expect(features.map((f) => f.properties?.name)).toEqual([
      "Midway International",
      "O'Hare International",
    ]);
    expect(features[0].geometry).toEqual({ type: "Point", coordinates: [-87.7522, 41.7868] });
    expect(features[1].geometry).toEqual({ type: "Point", coordinates: [-87.909, 41.9803] });
  });
});

describe("infrastructureFeatures dispatcher", () => {
  it("routes each layer to the transform its shape declares", () => {
    expect(infrastructureFeatures("airports", null)).toHaveLength(2);
    expect(
      infrastructureFeatures("rail", { stations: [{ name: "A", system: "CTA", lat: 41.7, lon: -87.6 }] }),
    ).toHaveLength(1);
    expect(
      infrastructureFeatures("parks", { points: [{ name: "P", lat: 41.7, lon: -87.6 }] }),
    ).toHaveLength(1);
    expect(
      infrastructureFeatures("expressways", {
        features: [
          {
            type: "Feature",
            properties: { kind: "expressway", name: "X" },
            geometry: { type: "LineString", coordinates: [[-87.6, 41.7], [-87.6, 41.71]] },
          },
        ],
      }),
    ).toHaveLength(1);
  });

  it("returns [] for any payload it cannot read, never a thrown error", () => {
    for (const id of INFRASTRUCTURE_LAYER_IDS) {
      if (id === "airports") continue;
      expect(() => infrastructureFeatures(id, "garbage")).not.toThrow();
      expect(infrastructureFeatures(id, "garbage")).toEqual([]);
    }
  });
});

// ── Component wiring guards ─────────────────────────────────────────────────
//
// The map panel itself cannot be exercised here (mapbox WebGL does not paint
// in this environment), so these read the component sources and pin the few
// wirings whose silent loss would be invisible until a reader complained:
// the persisted-toggle round-trip, the lazy-load discipline, the container
// sizing mapbox's own CSS depends on, and the card/pin identity link.

describe("SiteShortlistMap wiring", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/vacancy/SiteShortlistMap.tsx"),
    "utf8",
  );

  it("seeds its toggles from sessionStorage and writes every change back", () => {
    expect(source).toMatch(/useState<InfrastructureLayerVisibility>\(\(\)\s*=>\s*\n?\s*loadStoredInfrastructureLayerVisibility\(\)/);
    expect(source).toContain("storeInfrastructureLayerVisibility(next)");
  });

  it("fetches an overlay only from inside the visibility effect, never at mount", () => {
    // One fetch call site, and it sits under the `if (!visible) continue` gate.
    expect(source.match(/await fetch\(/g) ?? []).toHaveLength(1);
    expect(source).toContain("overlayCacheRef.current.set(layer.id, features)");
    expect(source).toContain("if (overlayCacheRef.current.has(layer.id))");
  });

  it("gives the mapbox container an explicit full size", () => {
    // mapbox-gl.css collapses a container without one, and a collapsed
    // container paints nothing while reporting no error at all.
    expect(source).toMatch(/ref=\{containerRef\}[^>]*className="absolute inset-0 h-full w-full"/);
  });

  it("emits the registered layer-toggle event with zip, layer, and enabled", () => {
    expect(source).toContain('trackEvent("site_shortlist_map_layer_toggled"');
    expect(source).toMatch(/metadata:\s*\{\s*zip,\s*layer:\s*id,\s*enabled:/);
  });

  it("draws every overlay beneath the candidate pins", () => {
    expect(source).toContain("map.getLayer(PIN_DISC_LAYER) ? PIN_DISC_LAYER : undefined");
  });

  it("closes a pin popup before a filter updates its GeoJSON source", () => {
    const popupCloseIndex = source.indexOf("pinPopupRef.current?.remove();", source.indexOf("Keep the pin source"));
    const setDataIndex = source.indexOf('source?.setData({ type: "FeatureCollection", features: pinFeatures })');
    expect(popupCloseIndex).toBeGreaterThan(-1);
    expect(popupCloseIndex).toBeLessThan(setDataIndex);
  });
});

describe("SiteShortlistResults wiring", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/vacancy/SiteShortlistResults.tsx"),
    "utf8",
  );

  it("renders the map panel above the ranked-list section", () => {
    const mapIndex = source.indexOf("<SiteShortlistMap");
    const listIndex = source.indexOf('role="group" aria-label="Filter by zoning badge"');
    expect(mapIndex).toBeGreaterThan(-1);
    expect(mapIndex).toBeLessThan(listIndex);
  });

  it("gives every card the id the pin popup jumps to", () => {
    expect(source).toContain("id={shortlistCardDomId(candidate.key)}");
  });

  it("puts the incentive snapshot FIRST in the card action row", () => {
    const snapshotIndex = source.indexOf("Incentive snapshot");
    const viewerIndex = source.indexOf("CookViewer parcel");
    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(snapshotIndex).toBeLessThan(viewerIndex);
  });

  it("builds the snapshot link through the shared href builder", () => {
    expect(source).toContain("shortlistSnapshotHref({");
    expect(source).toContain('trackEvent("site_shortlist_snapshot_clicked"');
  });

  it("offers a badge filter control that never re-fetches enrichment", () => {
    // The filter narrows what is SHOWN; the enrichment effect must key off
    // the FULL ranked list, not the filtered `visible` list, or switching
    // the filter would re-fire the request.
    expect(source).toContain("[ranked]);");
    expect(source).not.toContain("[visible]);");
  });

  it("passes the same filtered candidate keys to the map without narrowing the CSV", () => {
    expect(source).toContain("visibleCandidateKeys={visibleCandidateKeys}");
    expect(source).toContain("shortlistCsv(ranked, facts, resolutionStates, zip)");
  });
});
