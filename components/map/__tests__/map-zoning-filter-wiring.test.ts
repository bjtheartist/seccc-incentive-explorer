import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../MapView.tsx", import.meta.url), "utf8");
const helperSource = readFileSync(new URL("../zoning-map-filter.ts", import.meta.url), "utf8");

describe("MapView zoning-filter wiring", () => {
  it("derives choices from the already loaded City zoning source", () => {
    expect(source).toContain("loadMapZoningSource(() =>");
    expect(source).toContain("setZoningDistrictClasses(publishedZoneClasses)");
    expect(source).not.toContain("fetchZoningFilter");
  });

  it("updates existing fill and line filters without recreating the map", () => {
    const applyFilterSource = helperSource.slice(
      helperSource.indexOf("export function applyMapZoningLayerFilters"),
      helperSource.indexOf("export function mapZoningFamilyVisibility"),
    );
    expect(source).toContain("applyMapZoningLayerFilters(");
    expect(applyFilterSource).toContain("map.setFilter(layerId, filter)");
    expect(applyFilterSource).toContain('["fill", "line"] as const');
    expect(applyFilterSource).not.toContain("addSource");
    expect(applyFilterSource).not.toContain("removeSource");
  });

  it("clears child selections when the family or type changes", () => {
    const familyHandler = source.slice(
      source.indexOf("const selectZoningFamily"),
      source.indexOf("const selectZoningDistrictType"),
    );
    expect(familyHandler).toContain('setZoningDistrictTypeFilter("")');
    expect(familyHandler).toContain('setZoningExactCodeFilter("")');
    expect(familyHandler).toContain("setActivePreset(null)");

    const typeHandler = source.slice(
      source.indexOf("const selectZoningDistrictType"),
      source.indexOf("const selectZoningExactCode"),
    );
    expect(typeHandler).toContain('setZoningExactCodeFilter("")');
    expect(typeHandler).toContain("setActivePreset(null)");
  });

  it("preserves manual family toggles by clearing linked focus first", () => {
    const manualHandlers = source.slice(
      source.indexOf("/* ── Toggle individual zoning category"),
      source.indexOf("/* ── Inspect zoning mode cursor"),
    );
    expect(manualHandlers.match(/setZoningFamilyFilter\(""\)/g)).toHaveLength(2);
    expect(manualHandlers.match(/setZoningDistrictTypeFilter\(""\)/g)).toHaveLength(2);
    expect(manualHandlers.match(/setZoningExactCodeFilter\(""\)/g)).toHaveLength(2);
    expect(manualHandlers.match(/setActivePreset\(null\)/g)).toHaveLength(2);
  });

  it("turns rejected or aborted optional zoning loads into an unavailable state", () => {
    expect(helperSource).toContain('status: "unavailable"');
    expect(source).toContain('setZoningLayerStatus("unavailable")');
    expect(source).toContain("removeMapZoningLayers(map, ZONING_CATEGORIES)");
    expect(source).toContain("setZoningDistrictClasses([])");
  });

  it("publishes available choices only after Mapbox installation succeeds", () => {
    const installAt = source.indexOf("installMapZoningLayers(");
    const classesAt = source.indexOf("setZoningDistrictClasses(publishedZoneClasses)", installAt);
    const availableAt = source.indexOf('setZoningLayerStatus("available")', classesAt);
    expect(installAt).toBeGreaterThan(-1);
    expect(classesAt).toBeGreaterThan(installAt);
    expect(availableAt).toBeGreaterThan(classesAt);
  });
});
