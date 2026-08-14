import type {
  FillLayerSpecification,
  FilterSpecification,
  GeoJSONSourceSpecification,
  LineLayerSpecification,
} from "mapbox-gl";

import { ZONING_CODE_DESCRIPTIONS } from "@/lib/constants";
import {
  ZONING_DISTRICT_FAMILIES,
  ZONE_SUBTYPES,
  classifyZoneClass,
  normalizeZoneClass,
  subtypeById,
  zoneSubtype,
} from "@/lib/zoning-districts";

export interface MapZoningFilterOption {
  value: string;
  label: string;
  codeCount: number;
}

export interface MapZoningFilterState {
  family: string;
  districtType: string;
  exactCode: string;
}

export interface MapZoningLayerCategory {
  key: string;
  prefixes: readonly string[];
}

export interface MapZoningLayerAdapter {
  getLayer: (id: string) => unknown;
  setFilter: (id: string, filter: FilterSpecification) => unknown;
  setLayoutProperty: (
    id: string,
    name: "visibility",
    value: "visible" | "none",
  ) => unknown;
}

export interface MapZoningInstallAdapter {
  addSource: (id: string, source: GeoJSONSourceSpecification) => unknown;
  getSource: (id: string) => unknown;
  removeSource: (id: string) => unknown;
  addLayer: (layer: FillLayerSpecification | LineLayerSpecification) => unknown;
  getLayer: (id: string) => unknown;
  removeLayer: (id: string) => unknown;
}

export type MapZoningLayerStatus = "loading" | "available" | "unavailable";

export interface MapZoningSourceResult {
  data: unknown | null;
  publishedZoneClasses: string[];
  status: Exclude<MapZoningLayerStatus, "loading">;
}

export interface MapZoningInstallCategory extends MapZoningLayerCategory {
  color: string;
}

export const EMPTY_MAP_ZONING_FILTER: MapZoningFilterState = {
  family: "",
  districtType: "",
  exactCode: "",
};

function canonicalZoneClass(value: string): string | null {
  return normalizeZoneClass(value.trim().toUpperCase());
}

function uniqueCanonicalZoneClasses(sourceZoneClasses: readonly string[]): string[] {
  return [
    ...new Set(
      sourceZoneClasses
        .map(canonicalZoneClass)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

/** Pull the source's published zone_class strings without retaining geometry. */
export function publishedZoneClassesFromGeoJSON(data: unknown): string[] {
  if (!data || typeof data !== "object" || !("features" in data)) return [];
  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];

  const values = new Set<string>();
  for (const feature of features) {
    if (!feature || typeof feature !== "object" || !("properties" in feature)) continue;
    const properties = (feature as { properties?: unknown }).properties;
    if (!properties || typeof properties !== "object" || !("zone_class" in properties)) continue;
    const zoneClass = (properties as { zone_class?: unknown }).zone_class;
    if (typeof zoneClass !== "string" || zoneClass.trim().length === 0) continue;
    values.add(zoneClass.trim().toUpperCase());
  }

  return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Resolve the optional City zoning source into an explicit UI state. Rejected
 * and aborted requests both fail closed so the map never presents an endless
 * loading message for an unavailable optional layer.
 */
export async function loadMapZoningSource(
  load: () => Promise<unknown>,
): Promise<MapZoningSourceResult> {
  try {
    const data = await load();
    const publishedZoneClasses = publishedZoneClassesFromGeoJSON(data);
    if (!data || publishedZoneClasses.length === 0) {
      return { data: null, publishedZoneClasses: [], status: "unavailable" };
    }
    return { data, publishedZoneClasses, status: "available" };
  } catch {
    return { data: null, publishedZoneClasses: [], status: "unavailable" };
  }
}

export function mapZoningFamilyOptions(
  sourceZoneClasses: readonly string[],
): MapZoningFilterOption[] {
  const canonical = uniqueCanonicalZoneClasses(sourceZoneClasses);
  return ZONING_DISTRICT_FAMILIES.map((family) => ({
    value: family.id,
    label: family.label,
    codeCount: canonical.filter((zoneClass) => classifyZoneClass(zoneClass)?.id === family.id)
      .length,
  })).filter((option) => option.codeCount > 0);
}

export function mapZoningDistrictTypeOptions(
  sourceZoneClasses: readonly string[],
  familySelection: string,
): MapZoningFilterOption[] {
  if (!familySelection) return [];
  const canonical = uniqueCanonicalZoneClasses(sourceZoneClasses);

  return ZONE_SUBTYPES.filter((subtype) => subtype.familyId === familySelection)
    .map((subtype) => ({
      value: subtype.id,
      label: `${subtype.id} · ${subtype.label}`,
      codeCount: canonical.filter((zoneClass) => zoneSubtype(zoneClass) === subtype.id).length,
    }))
    .filter((option) => option.codeCount > 0);
}

export function mapZoningExactCodeOptions(
  sourceZoneClasses: readonly string[],
  familySelection: string,
  districtTypeSelection: string,
): MapZoningFilterOption[] {
  if (!familySelection || !districtTypeSelection) return [];
  if (subtypeById(districtTypeSelection)?.requiresOrdinanceLookup) return [];

  return uniqueCanonicalZoneClasses(sourceZoneClasses)
    .filter(
      (zoneClass) =>
        classifyZoneClass(zoneClass)?.id === familySelection &&
        zoneSubtype(zoneClass) === districtTypeSelection,
    )
    .map((zoneClass) => ({
      value: zoneClass,
      label: ZONING_CODE_DESCRIPTIONS[zoneClass]
        ? `${zoneClass} · ${ZONING_CODE_DESCRIPTIONS[zoneClass]}`
        : zoneClass,
      codeCount: 1,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export function mapZoningTypeRequiresOrdinanceLookup(districtTypeSelection: string): boolean {
  return Boolean(subtypeById(districtTypeSelection)?.requiresOrdinanceLookup);
}

function sourceZoneClassesForSelection(
  sourceZoneClasses: readonly string[],
  districtTypeSelection: string,
  exactCodeSelection: string,
): string[] {
  const exactCanonical = exactCodeSelection ? canonicalZoneClass(exactCodeSelection) : null;
  return sourceZoneClasses.filter((sourceValue) => {
    const canonical = canonicalZoneClass(sourceValue);
    if (!canonical) return false;
    if (districtTypeSelection && zoneSubtype(canonical) !== districtTypeSelection) return false;
    if (exactCanonical && canonical !== exactCanonical) return false;
    return true;
  });
}

/**
 * Keep the existing per-family layer contract, then refine it with the linked
 * type/exact selection. Source spellings are retained so published aliases
 * (for example RM4.5 and RM-4.5) remain visible under one canonical option.
 */
export function buildMapZoningLayerFilter(
  familyPrefixes: readonly string[],
  sourceZoneClasses: readonly string[],
  districtTypeSelection: string,
  exactCodeSelection: string,
): FilterSpecification {
  const zoneClassExpression = [
    "upcase",
    ["to-string", ["get", "zone_class"]],
  ] as const;
  const prefixFilters = familyPrefixes.map((prefix) => [
    "==",
    ["slice", zoneClassExpression, 0, prefix.length],
    prefix.toUpperCase(),
  ]);
  const familyFilter =
    prefixFilters.length === 1 ? prefixFilters[0] : ["any", ...prefixFilters];

  if (!districtTypeSelection && !exactCodeSelection) {
    return familyFilter as FilterSpecification;
  }

  const allowedSourceValues = sourceZoneClassesForSelection(
    sourceZoneClasses,
    districtTypeSelection,
    exactCodeSelection,
  );
  if (allowedSourceValues.length === 0) {
    return ["all", familyFilter, ["==", ["literal", 1], ["literal", 0]]] as FilterSpecification;
  }

  return [
    "all",
    familyFilter,
    ["in", zoneClassExpression, ["literal", allowedSourceValues]],
  ] as FilterSpecification;
}

/** Remove the shared zoning source and every category layer without throwing. */
export function removeMapZoningLayers(
  map: MapZoningInstallAdapter,
  categories: readonly MapZoningLayerCategory[],
): void {
  for (const category of [...categories].reverse()) {
    for (const suffix of ["line", "fill"] as const) {
      const layerId = `zoning-${category.key}-${suffix}`;
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      } catch {
        // Best-effort cleanup must not prevent the rest of map initialization.
      }
    }
  }
  try {
    if (map.getSource("chicago-zoning")) map.removeSource("chicago-zoning");
  } catch {
    // A partially initialized optional layer must never fail the full map.
  }
}

/**
 * Install the existing zoning source and all fill/line layers atomically from
 * the UI's perspective. Any Mapbox add failure removes partial work and then
 * rethrows so the caller can expose the unavailable state.
 */
export function installMapZoningLayers(
  map: MapZoningInstallAdapter,
  categories: readonly MapZoningInstallCategory[],
  data: GeoJSON.FeatureCollection,
  sourceZoneClasses: readonly string[],
): void {
  try {
    map.addSource("chicago-zoning", {
      type: "geojson",
      data,
      generateId: true,
    });

    for (const category of categories) {
      const filter = buildMapZoningLayerFilter(
        category.prefixes,
        sourceZoneClasses,
        "",
        "",
      );
      map.addLayer({
        id: `zoning-${category.key}-fill`,
        type: "fill",
        source: "chicago-zoning",
        filter,
        layout: { visibility: "visible" },
        paint: {
          "fill-color": category.color,
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.65,
            0.45,
          ],
        },
      });
      map.addLayer({
        id: `zoning-${category.key}-line`,
        type: "line",
        source: "chicago-zoning",
        filter,
        layout: { visibility: "visible" },
        paint: {
          "line-color": "#ffffff",
          "line-width": 0.3,
          "line-opacity": 0.5,
        },
      });
    }
  } catch (error) {
    removeMapZoningLayers(map, categories);
    throw error;
  }
}

/** Update existing layers in place; this deliberately has no source or fetch API. */
export function applyMapZoningLayerFilters(
  map: MapZoningLayerAdapter,
  categories: readonly MapZoningLayerCategory[],
  sourceZoneClasses: readonly string[],
  districtTypeSelection: string,
  exactCodeSelection: string,
): number {
  let updatedLayers = 0;
  for (const category of categories) {
    const filter = buildMapZoningLayerFilter(
      category.prefixes,
      sourceZoneClasses,
      districtTypeSelection,
      exactCodeSelection,
    );
    for (const suffix of ["fill", "line"] as const) {
      const layerId = `zoning-${category.key}-${suffix}`;
      if (!map.getLayer(layerId)) continue;
      map.setFilter(layerId, filter);
      updatedLayers += 1;
    }
  }
  return updatedLayers;
}

export function mapZoningFamilyVisibility(
  categories: readonly MapZoningLayerCategory[],
  familySelection: string,
): Record<string, boolean> {
  return Object.fromEntries(
    categories.map((category) => [
      category.key,
      familySelection === "" || category.key === familySelection,
    ]),
  );
}

/** Apply family focus to existing layers and return the matching React state. */
export function applyMapZoningFamilyVisibility(
  map: MapZoningLayerAdapter,
  categories: readonly MapZoningLayerCategory[],
  familySelection: string,
): Record<string, boolean> {
  const visibility = mapZoningFamilyVisibility(categories, familySelection);
  for (const category of categories) {
    for (const suffix of ["fill", "line"] as const) {
      const layerId = `zoning-${category.key}-${suffix}`;
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(
          layerId,
          "visibility",
          visibility[category.key] ? "visible" : "none",
        );
      }
    }
  }
  return visibility;
}
