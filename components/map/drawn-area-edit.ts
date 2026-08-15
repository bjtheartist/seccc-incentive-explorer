import type mapboxgl from "mapbox-gl";

export const DRAWN_AREA_ANALYSIS_SOURCE_ID = "drawn-area-analysis";
export const DRAWN_AREA_ANALYSIS_FILL_LAYER_ID = "drawn-area-analysis-fill";
export const DRAWN_AREA_ANALYSIS_LINE_LAYER_ID = "drawn-area-analysis-line";

type DrawFeatureId = string | number;

export interface DrawnAreaEditor {
  add(feature: GeoJSON.Feature<GeoJSON.Polygon>): DrawFeatureId[];
  changeMode(mode: string, options?: Record<string, unknown>): void;
  deleteAll(): void;
  getAll(): GeoJSON.FeatureCollection;
}

export function blocksDrawnAreaSnapshot(
  drawing: boolean,
  editing: boolean,
): boolean {
  return drawing || editing;
}

export function shouldCancelDrawnAreaEditOnModeChange(
  editing: boolean,
  nextMode: string,
): boolean {
  return editing && nextMode !== "direct_select";
}

export function shouldCancelDrawnAreaEditOnKey(
  editing: boolean,
  key: string,
): boolean {
  return editing && key === "Escape";
}

export function analyzedPolygonCollection(
  geometry: GeoJSON.Polygon | null,
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: "FeatureCollection",
    features: geometry
      ? [
          {
            type: "Feature",
            properties: { role: "analyzed-area" },
            geometry,
          },
        ]
      : [],
  };
}

export function setAnalyzedPolygon(
  map: Pick<mapboxgl.Map, "getSource">,
  geometry: GeoJSON.Polygon | null,
): void {
  const source = map.getSource(
    DRAWN_AREA_ANALYSIS_SOURCE_ID,
  ) as mapboxgl.GeoJSONSource | undefined;
  source?.setData(analyzedPolygonCollection(geometry));
}

/**
 * Move the analyzed geometry into Draw only while the user explicitly edits.
 * The ordinary viewing state has no Draw feature, so a pointer/touch drag that
 * begins inside the polygon belongs to Mapbox navigation and cannot translate
 * the analyzed geometry.
 */
export function beginDrawnAreaEdit(
  draw: DrawnAreaEditor,
  geometry: GeoJSON.Polygon,
): DrawFeatureId | null {
  draw.deleteAll();
  const ids = draw.add({
    type: "Feature",
    properties: { role: "editing-area" },
    geometry,
  });
  const id = ids[0];
  if (id === undefined || id === null) return null;
  draw.changeMode("direct_select", { featureId: String(id) });
  return id;
}

export function readEditedPolygon(
  draw: Pick<DrawnAreaEditor, "getAll">,
): GeoJSON.Polygon | null {
  const feature = draw
    .getAll()
    .features.find((candidate) => candidate.geometry?.type === "Polygon");
  return feature?.geometry?.type === "Polygon" ? feature.geometry : null;
}
