/**
 * SITE SHORTLIST MAP — the infrastructure lens, as pure data.
 *
 * The shortlist map answers "where are these records?"; this module answers the
 * follow-up a reader always asks next — "and what is AROUND them?". It carries
 * the catalog of optional context layers (rail, expressways, airports, parks,
 * libraries, public schools, grocery), their colors, their committed source
 * files, and the tab-scoped visibility record that remembers which are on.
 *
 * PURE AND CLIENT-SAFE. No mapbox, no React, no `node:fs`. The component reads
 * this catalog and does the drawing; every rule worth pinning — the all-off
 * default, the persistence round-trip, the source-JSON-to-feature transforms —
 * is a plain function that can be unit-tested without a WebGL context. That
 * matters more here than usual: the sandboxes this repo is developed in cannot
 * paint mapbox at all, so tests are the only pre-deploy check these layers get.
 *
 * TWO INVARIANTS THAT ARE NOT NEGOTIABLE
 *   1. EVERY LAYER DEFAULTS OFF. Overlay files are fetched lazily on first
 *      toggle (see `INFRASTRUCTURE_LAYERS[].dataUrl` and the component's cache
 *      ref), so a reader who never opens a toggle pays nothing. PR #106 trimmed
 *      this app's map payload deliberately; do not regress it by preloading.
 *   2. LABELS CARRY THEIR OWN STALENESS. The grocery table is one the City no
 *      longer maintains, so its label says so, in the legend, always. A layer
 *      whose source goes stale gets a truer label — never a quieter one.
 *
 * None of these layers is a screening signal. They are neighborhood context
 * drawn beside the candidates, and a dot near a park has earned nothing.
 */

import { ZONING_BADGE_LABELS, type RankedShortlistCandidate, type ZoningBadge } from "./shortlist-engine";

// ── Badge colors, matching the deliverable and the card's zoning badge ───────
//
// PR2 replaced the old Tier 1 / Tier 2 split with one ranked list and four
// zoning-screen badges (see lib/shortlist-engine.ts). Pin color now keys on
// badge, not tier, so the map and the card badge can never disagree.

export const BADGE_PIN_COLORS: Readonly<Record<ZoningBadge, { color: string; accent: string }>> = {
  aligned: { color: "#166534", accent: "#22C55E" },
  "not-aligned": { color: "#A45B00", accent: "#F59E0B" },
  "planned-development": { color: "#7C3AED", accent: "#A78BFA" },
  unresolved: { color: "#475569", accent: "#94A3B8" },
};

export function badgePinColor(badge: ZoningBadge): string {
  return BADGE_PIN_COLORS[badge].color;
}

export function badgePinAccent(badge: ZoningBadge): string {
  return BADGE_PIN_COLORS[badge].accent;
}

// ── Layer catalog ───────────────────────────────────────────────────────────

export const INFRASTRUCTURE_LAYER_IDS = [
  "rail",
  "expressways",
  "airports",
  "parks",
  "libraries",
  "schools",
  "grocery",
] as const;

export type InfrastructureLayerId = (typeof INFRASTRUCTURE_LAYER_IDS)[number];

/** How a layer's source JSON is shaped, which decides the feature transform. */
export type InfrastructureLayerShape = "rail" | "expressway" | "amenity" | "static";

export interface InfrastructureLayerConfig {
  id: InfrastructureLayerId;
  /** Legend text. For a stale source this MUST disclose the lag. */
  label: string;
  /** Rendered geometry: a dot layer or a line layer. */
  geometry: "point" | "line";
  shape: InfrastructureLayerShape;
  color: string;
  /**
   * The committed file fetched on FIRST toggle-on and cached for the session.
   * `null` means the layer needs no dataset at all (the two airports are
   * static coordinates), so it costs one render and zero bytes.
   */
  dataUrl: string | null;
  /** Provenance line shown under the legend group. */
  sourceNote: string;
}

export const INFRASTRUCTURE_LAYERS: readonly InfrastructureLayerConfig[] = [
  {
    id: "rail",
    label: "CTA + Metra stations",
    geometry: "point",
    shape: "rail",
    color: "#0F766E",
    dataUrl: "/data/rail-stations.json",
    sourceNote: "CTA 'L' stops (data.cityofchicago.org/8pix-ypme) and committed Metra stations.",
  },
  {
    id: "expressways",
    label: "Expressways",
    geometry: "line",
    shape: "expressway",
    color: "#64748B",
    dataUrl: "/data/transport-network.geojson",
    sourceNote: "Named expressway centerlines from this repository's committed transport network.",
  },
  {
    id: "airports",
    label: "Airports",
    geometry: "point",
    shape: "static",
    color: "#475569",
    dataUrl: null,
    sourceNote: "Midway and O'Hare, as two fixed reference points.",
  },
  {
    id: "parks",
    label: "Parks",
    geometry: "point",
    shape: "amenity",
    color: "#16A34A",
    dataUrl: "/data/park-points.json",
    sourceNote:
      "Chicago Park District parks (data.cityofchicago.org/ejsh-fztr), one locator point per park.",
  },
  {
    id: "libraries",
    label: "Libraries",
    geometry: "point",
    shape: "amenity",
    color: "#7C3AED",
    dataUrl: "/data/library-points.json",
    sourceNote: "Chicago Public Library branches (data.cityofchicago.org/x8fc-8rcq).",
  },
  {
    id: "schools",
    label: "Public schools",
    geometry: "point",
    shape: "amenity",
    color: "#B45309",
    dataUrl: "/data/school-points.json",
    sourceNote:
      "Chicago Public Schools, SY2526 edition (data.cityofchicago.org/pb6d-zzuh). District-published locations only.",
  },
  {
    // The City stopped maintaining this table years ago. The label says so on
    // the legend itself, not in a footnote a reader can miss.
    id: "grocery",
    label: "Grocery (city dataset, may lag)",
    geometry: "point",
    shape: "amenity",
    color: "#BE123C",
    dataUrl: "/data/grocery-points.json",
    sourceNote:
      "Stores the City recorded as open in a dataset it no longer maintains (data.cityofchicago.org/3e26-zek2). Openings and closings since are not reflected.",
  },
];

export const INFRASTRUCTURE_LAYERS_BY_ID: Readonly<
  Record<InfrastructureLayerId, InfrastructureLayerConfig>
> = Object.fromEntries(INFRASTRUCTURE_LAYERS.map((layer) => [layer.id, layer])) as Record<
  InfrastructureLayerId,
  InfrastructureLayerConfig
>;

export function isInfrastructureLayerId(value: unknown): value is InfrastructureLayerId {
  return (
    typeof value === "string" && (INFRASTRUCTURE_LAYER_IDS as readonly string[]).includes(value)
  );
}

/** The mapbox source/layer id namespace, so nothing collides with the pins. */
export function infrastructureSourceId(id: InfrastructureLayerId): string {
  return `shortlist-infra-${id}`;
}

export function infrastructureLayerId(id: InfrastructureLayerId, suffix: string): string {
  return `shortlist-infra-${id}-${suffix}`;
}

// ── Visibility record (sessionStorage, all-off default) ─────────────────────

export type InfrastructureLayerVisibility = Record<InfrastructureLayerId, boolean>;

export const INFRASTRUCTURE_LAYERS_STORAGE_KEY = "cie_shortlist_infrastructure_layers";

/** Every layer is OFF until the reader asks for it. */
export function defaultInfrastructureLayerVisibility(): InfrastructureLayerVisibility {
  return Object.fromEntries(
    INFRASTRUCTURE_LAYER_IDS.map((id) => [id, false]),
  ) as InfrastructureLayerVisibility;
}

/**
 * Parse persisted state defensively. Malformed JSON resets everything to off;
 * a valid object with one unusable field keeps the usable fields and defaults
 * only the broken one. Unknown keys are ignored, so removing a layer from the
 * catalog never leaves a poisoned record behind.
 */
export function parseInfrastructureLayerVisibility(
  raw: string | null | undefined,
): InfrastructureLayerVisibility {
  if (!raw) return defaultInfrastructureLayerVisibility();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return defaultInfrastructureLayerVisibility();
    }
    const values = parsed as Record<string, unknown>;
    return Object.fromEntries(
      INFRASTRUCTURE_LAYER_IDS.map((id) => [id, values[id] === true]),
    ) as InfrastructureLayerVisibility;
  } catch {
    return defaultInfrastructureLayerVisibility();
  }
}

/** Serialize in canonical catalog order, so stored state is stable. */
export function serializeInfrastructureLayerVisibility(
  visibility: InfrastructureLayerVisibility,
): string {
  return JSON.stringify(
    Object.fromEntries(INFRASTRUCTURE_LAYER_IDS.map((id) => [id, visibility[id] === true])),
  );
}

/** Read the tab-scoped preference. All-off on SSR or blocked storage. */
export function loadStoredInfrastructureLayerVisibility(): InfrastructureLayerVisibility {
  if (typeof window === "undefined") return defaultInfrastructureLayerVisibility();
  try {
    return parseInfrastructureLayerVisibility(
      window.sessionStorage.getItem(INFRASTRUCTURE_LAYERS_STORAGE_KEY),
    );
  } catch {
    return defaultInfrastructureLayerVisibility();
  }
}

/**
 * Persist the tab-scoped preference. The all-off default is stored as key
 * REMOVAL, matching the owner-clusters and public-investment toggles, so a
 * fresh tab always starts from the documented default rather than an artifact.
 */
export function storeInfrastructureLayerVisibility(
  visibility: InfrastructureLayerVisibility,
): void {
  if (typeof window === "undefined") return;
  try {
    const allOff = INFRASTRUCTURE_LAYER_IDS.every((id) => visibility[id] !== true);
    if (allOff) {
      window.sessionStorage.removeItem(INFRASTRUCTURE_LAYERS_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(
        INFRASTRUCTURE_LAYERS_STORAGE_KEY,
        serializeInfrastructureLayerVisibility(visibility),
      );
    }
  } catch {
    // Persistence is best-effort; a blocked store must never break the map.
  }
}

/** Return a new visibility record with one layer changed. */
export function withInfrastructureLayerVisibility(
  visibility: InfrastructureLayerVisibility,
  id: InfrastructureLayerId,
  visible: boolean,
): InfrastructureLayerVisibility {
  return { ...visibility, [id]: visible };
}

// ── Shortlist pins ──────────────────────────────────────────────────────────

/** The scroll target every pin popup jumps to. Kept ASCII-safe: a candidate
 *  key is a PIN or an `address@lat,lon` string, and neither is a legal id. */
export function shortlistCardDomId(key: string): string {
  return `shortlist-card-${key.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

/** The zoning text a pin popup shows — identical to the card's badge, so the
 *  map and the list can never disagree about a record's zoning status. */
export function pinZoningBadgeText(candidate: RankedShortlistCandidate): string {
  return ZONING_BADGE_LABELS[candidate.badge];
}

export interface ShortlistPinProps extends Record<string, unknown> {
  key: string;
  markerNumber: number;
  badge: ZoningBadge;
  address: string;
  zoningBadge: string;
  domId: string;
  color: string;
  accent: string;
}

/**
 * One numbered pin per RENDERED candidate, numbered exactly in rank order.
 * The map and the list share one numbering because a reader treats "07" on
 * the map and "07" in the list as the same record — and they must be.
 */
export function shortlistPinFeatures(
  ranked: readonly RankedShortlistCandidate[],
): GeoJSON.Feature[] {
  return ranked
    .filter(
      (candidate) =>
        typeof candidate.lat === "number" &&
        typeof candidate.lon === "number" &&
        Number.isFinite(candidate.lat) &&
        Number.isFinite(candidate.lon) &&
        candidate.lat !== 0 &&
        candidate.lon !== 0,
    )
    .map((candidate) => {
      // Number against the FULL ranked run, so filtering out a coordinate-less
      // record never renumbers the ones that remain.
      const markerNumber = ranked.indexOf(candidate) + 1;
      const props: ShortlistPinProps = {
        key: candidate.key,
        markerNumber,
        badge: candidate.badge,
        address: candidate.address,
        zoningBadge: pinZoningBadgeText(candidate),
        domId: shortlistCardDomId(candidate.key),
        color: badgePinColor(candidate.badge),
        accent: badgePinAccent(candidate.badge),
      };
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [candidate.lon as number, candidate.lat as number] },
        properties: props as unknown as GeoJSON.GeoJsonProperties,
      } satisfies GeoJSON.Feature;
    });
}

/** Bounds around the plotted pins, or null when nothing is plottable. */
export function shortlistPinBounds(
  features: readonly GeoJSON.Feature[],
): [number, number, number, number] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const feature of features) {
    if (feature.geometry?.type !== "Point") continue;
    const [lon, lat] = feature.geometry.coordinates as [number, number];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  return [west, south, east, north];
}

// ── Overlay source transforms (one per shape) ───────────────────────────────

/**
 * A finite number, or null. Deliberately stricter than `Number()`: `Number(null)`
 * and `Number("")` are BOTH 0, which is a perfectly finite coordinate off the
 * coast of Africa — so a row with a missing lat would otherwise be plotted at
 * Null Island instead of being dropped.
 */
function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Midway and O'Hare. Two fixed points, so this layer needs no dataset. */
export const AIRPORTS: readonly { name: string; lat: number; lon: number }[] = [
  { name: "Midway International", lat: 41.7868, lon: -87.7522 },
  { name: "O'Hare International", lat: 41.9803, lon: -87.909 },
];

export function airportFeatures(): GeoJSON.Feature[] {
  return AIRPORTS.map((airport) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [airport.lon, airport.lat] },
    properties: { name: airport.name },
  }));
}

/** rail-stations.json -> dots carrying the station name and system. */
export function railStationFeatures(payload: unknown): GeoJSON.Feature[] {
  const stations = (payload as { stations?: unknown })?.stations;
  if (!Array.isArray(stations)) return [];
  const out: GeoJSON.Feature[] = [];
  for (const raw of stations) {
    const station = raw as { name?: unknown; system?: unknown; lat?: unknown; lon?: unknown };
    const lat = finiteNumber(station.lat);
    const lon = finiteNumber(station.lon);
    if (typeof station.name !== "string" || !station.name.trim() || lat === null || lon === null) {
      continue;
    }
    const system = typeof station.system === "string" ? station.system : "";
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { name: station.name, system, label: system ? `${station.name} (${system})` : station.name },
    });
  }
  return out;
}

/** transport-network.geojson -> the named expressway centerlines only. The
 *  file also carries rail lines; those are a different layer's business. */
export function expresswayLineFeatures(payload: unknown): GeoJSON.Feature[] {
  const features = (payload as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: GeoJSON.Feature[] = [];
  for (const raw of features) {
    const feature = raw as GeoJSON.Feature;
    const props = (feature?.properties ?? {}) as Record<string, unknown>;
    if (props.kind !== "expressway") continue;
    const geometry = feature.geometry;
    if (!geometry || (geometry.type !== "LineString" && geometry.type !== "MultiLineString")) {
      continue;
    }
    out.push({
      type: "Feature",
      geometry,
      properties: { name: typeof props.name === "string" ? props.name : "Expressway" },
    });
  }
  return out;
}

/** Any of the four committed amenity point files -> dots. */
export function amenityPointFeatures(payload: unknown): GeoJSON.Feature[] {
  const points = (payload as { points?: unknown })?.points;
  if (!Array.isArray(points)) return [];
  const out: GeoJSON.Feature[] = [];
  for (const raw of points) {
    const point = raw as { name?: unknown; lat?: unknown; lon?: unknown; acres?: unknown };
    const lat = finiteNumber(point.lat);
    const lon = finiteNumber(point.lon);
    if (typeof point.name !== "string" || !point.name.trim() || lat === null || lon === null) {
      continue;
    }
    const acres = finiteNumber(point.acres);
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        name: point.name,
        label: acres !== null && acres > 0 ? `${point.name} · ${acres} acres` : point.name,
      },
    });
  }
  return out;
}

/**
 * Turn a fetched payload into features for a layer, by its declared shape. An
 * unparseable or unexpected payload yields `[]` — an empty layer, never a
 * thrown error and never an invented dot.
 */
export function infrastructureFeatures(
  id: InfrastructureLayerId,
  payload: unknown,
): GeoJSON.Feature[] {
  switch (INFRASTRUCTURE_LAYERS_BY_ID[id]?.shape) {
    case "static":
      return airportFeatures();
    case "rail":
      return railStationFeatures(payload);
    case "expressway":
      return expresswayLineFeatures(payload);
    case "amenity":
      return amenityPointFeatures(payload);
    default:
      return [];
  }
}
