import { describe, expect, it, vi } from "vitest";
import {
  DRAWN_AREA_ANALYSIS_SOURCE_ID,
  analyzedPolygonCollection,
  blocksDrawnAreaSnapshot,
  beginDrawnAreaEdit,
  readEditedPolygon,
  setAnalyzedPolygon,
  shouldCancelDrawnAreaEditOnKey,
  shouldCancelDrawnAreaEditOnModeChange,
} from "../drawn-area-edit";
import type { DrawnAreaEditor } from "../drawn-area-edit";

const GEOMETRY: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-87.63, 41.88],
      [-87.62, 41.88],
      [-87.62, 41.89],
      [-87.63, 41.88],
    ],
  ],
};

function editor(features: GeoJSON.Feature[] = []) {
  return {
    add: vi.fn(() => ["area-1"]),
    changeMode: vi.fn(),
    deleteAll: vi.fn(),
    getAll: vi.fn(() => ({ type: "FeatureCollection" as const, features })),
  };
}

describe("drawn-area locked/edit lifecycle", () => {
  it("renders the analyzed polygon outside Mapbox Draw", () => {
    expect(analyzedPolygonCollection(GEOMETRY).features).toHaveLength(1);
    expect(analyzedPolygonCollection(null).features).toEqual([]);

    const setData = vi.fn();
    const getSource = vi.fn((id: string) =>
      id === DRAWN_AREA_ANALYSIS_SOURCE_ID ? { setData } : undefined,
    );
    setAnalyzedPolygon({ getSource } as never, GEOMETRY);
    expect(setData).toHaveBeenCalledWith(analyzedPolygonCollection(GEOMETRY));
  });

  it("enters direct_select only after the explicit edit action", () => {
    const draw = editor();
    expect(beginDrawnAreaEdit(draw as DrawnAreaEditor, GEOMETRY)).toBe("area-1");
    expect(draw.deleteAll).toHaveBeenCalledOnce();
    expect(draw.add).toHaveBeenCalledWith({
      type: "Feature",
      properties: { role: "editing-area" },
      geometry: GEOMETRY,
    });
    expect(draw.changeMode).toHaveBeenCalledWith("direct_select", {
      featureId: "area-1",
    });
  });

  it("reads only a polygon draft and fails closed when Draw has none", () => {
    const polygon = { type: "Feature" as const, properties: {}, geometry: GEOMETRY };
    expect(readEditedPolygon(editor([polygon]) as DrawnAreaEditor)).toEqual(GEOMETRY);
    expect(readEditedPolygon(editor() as DrawnAreaEditor)).toBeNull();
  });

  it("keeps map dossiers blocked throughout editing and cancels an Escape mode exit", () => {
    expect(blocksDrawnAreaSnapshot(false, true)).toBe(true);
    expect(blocksDrawnAreaSnapshot(true, false)).toBe(true);
    expect(blocksDrawnAreaSnapshot(false, false)).toBe(false);
    expect(shouldCancelDrawnAreaEditOnModeChange(true, "simple_select")).toBe(true);
    expect(shouldCancelDrawnAreaEditOnModeChange(true, "direct_select")).toBe(false);
    expect(shouldCancelDrawnAreaEditOnModeChange(false, "simple_select")).toBe(false);
    expect(shouldCancelDrawnAreaEditOnKey(true, "Escape")).toBe(true);
    expect(shouldCancelDrawnAreaEditOnKey(true, "Enter")).toBe(false);
    expect(shouldCancelDrawnAreaEditOnKey(false, "Escape")).toBe(false);
  });
});
