/**
 * First-visit spotlight tour for the public /map page. Kept entirely separate
 * from lib/first-visit-guide.ts (the sitewide tour) and lib/investment-guide.ts
 * (the gated /investment tour): its own storage key, its own version counter,
 * its own replay event — so completing one tour can never be mistaken for
 * completing another, and a version bump on one never silently reopens the
 * others.
 *
 * Single-page like the investment tour (no cross-page handoff), so no
 * session-storage leg machinery.
 */

export const MAP_GUIDE_VERSION = 1;
export const MAP_GUIDE_STORAGE_KEY = "cie:map-guide";
/** Dispatched by the persistent replay button to re-trigger the tour on demand. */
export const MAP_GUIDE_OPEN_EVENT = "cie:open-map-guide";

export type MapGuideStatus = "completed" | "skipped";

export interface MapGuidePreference {
  version: number;
  status: MapGuideStatus;
  updatedAt: string;
}

export interface MapTourStep {
  key: string;
  selector: string;
  title: string;
  description: string;
  side: "top" | "right" | "bottom" | "left";
}

/**
 * Four stops, anchored to elements that exist in the map surface today
 * (verified against MapView/MapSearch/MapLegendPanel/IncentiveGlance, not
 * assumed). Desktop shows all four; on a phone the legend panel starts
 * closed, so the presets stop is skipped by `skipMissingElement` and the
 * remaining three still read as a complete tour.
 */
export const MAP_TOUR_STEPS: MapTourStep[] = [
  {
    key: "map-search",
    selector: '[data-tour="map-search"]',
    title: "Start with an address",
    // Same input-honesty rule as the sitewide tour: the search resolves a
    // street address or a business name — never name a PIN here.
    description:
      "Search a business address, a property you are considering, or a business name, and the map centers there with every mapped zone that touches it. Or skip the search and just explore.",
    side: "bottom",
  },
  {
    key: "map-presets",
    selector: '[data-tour="map-presets"]',
    title: "Layers, in bundles",
    // Deliberately does not enumerate the preset names: frozen tour copy
    // rots the moment a bundle is added or renamed, the same way digits do.
    description:
      "Chicago's incentive geography arrives in layers, so the legend bundles them into one-tap presets. A preset swaps the whole view, and the toggles below it tune individual layers.",
    side: "right",
  },
  {
    key: "map-canvas",
    selector: '[data-tour="map-canvas"]',
    title: "The map answers clicks",
    description:
      "Click any zone for its details and the programs tied to it. Right-click anywhere for the zoning classification. On a phone, tap the map for area data.",
    side: "top",
  },
  {
    key: "map-glance",
    selector: '[data-tour="map-glance"]',
    title: "The citywide picture",
    description:
      "Below the map, the at-a-glance panel opens the coverage numbers behind what you see. Zones overlapping at an address is a starting point for program-by-program review — it does not by itself confirm eligibility or stacking.",
    side: "top",
  },
];

export function readMapGuidePreference(
  storage: Pick<Storage, "getItem">,
): MapGuidePreference | null {
  try {
    const raw = storage.getItem(MAP_GUIDE_STORAGE_KEY);
    if (!raw) return null;

    const value = JSON.parse(raw) as Partial<MapGuidePreference>;
    if (
      value.version !== MAP_GUIDE_VERSION ||
      (value.status !== "completed" && value.status !== "skipped") ||
      typeof value.updatedAt !== "string"
    ) {
      return null;
    }

    return value as MapGuidePreference;
  } catch {
    return null;
  }
}

export function writeMapGuidePreference(
  storage: Pick<Storage, "setItem">,
  status: MapGuideStatus,
) {
  const preference: MapGuidePreference = {
    version: MAP_GUIDE_VERSION,
    status,
    updatedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(MAP_GUIDE_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // The tour remains optional when storage is blocked or unavailable.
  }

  return preference;
}
