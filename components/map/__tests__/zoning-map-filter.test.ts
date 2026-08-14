import { describe, expect, it, vi } from "vitest";

import {
  applyMapZoningFamilyVisibility,
  applyMapZoningLayerFilters,
  buildMapZoningLayerFilter,
  installMapZoningLayers,
  loadMapZoningSource,
  mapZoningDistrictTypeOptions,
  mapZoningExactCodeOptions,
  mapZoningFamilyOptions,
  mapZoningTypeRequiresOrdinanceLookup,
  publishedZoneClassesFromGeoJSON,
} from "../zoning-map-filter";

const SOURCE_CLASSES = [
  "C1-1",
  "C1-2",
  "B3-2",
  "RS-2",
  "RM4.5",
  "RM-4.5",
  "M2-2",
  "PD 123",
  "PMD 4",
  "T",
];

describe("incentive-map zoning filter helpers", () => {
  it("extracts distinct published source values without retaining geometry", () => {
    expect(
      publishedZoneClassesFromGeoJSON({
        type: "FeatureCollection",
        features: [
          { properties: { zone_class: " c1-1 " }, geometry: { coordinates: [1, 2, 3] } },
          { properties: { zone_class: "C1-1" } },
          { properties: { zone_class: "RS-2" } },
          { properties: { zone_class: null } },
          { properties: {} },
        ],
      }),
    ).toEqual(["C1-1", "RS-2"]);
    expect(publishedZoneClassesFromGeoJSON(null)).toEqual([]);
    expect(publishedZoneClassesFromGeoJSON({ features: "not-an-array" })).toEqual([]);
  });

  it("loads the City zoning source once and exposes an available state", async () => {
    const load = vi.fn().mockResolvedValue({
      type: "FeatureCollection",
      features: [{ properties: { zone_class: "C1-1" } }],
    });

    await expect(loadMapZoningSource(load)).resolves.toEqual({
      data: expect.objectContaining({ type: "FeatureCollection" }),
      publishedZoneClasses: ["C1-1"],
      status: "available",
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it.each([
    new Error("request rejected"),
    new DOMException("request aborted", "AbortError"),
  ])("reports an unavailable state when the optional source fails: %s", async (error) => {
    const load = vi.fn().mockRejectedValue(error);

    await expect(loadMapZoningSource(load)).resolves.toEqual({
      data: null,
      publishedZoneClasses: [],
      status: "unavailable",
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it("builds family options from distinct canonical published codes", () => {
    const options = mapZoningFamilyOptions(SOURCE_CLASSES);
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "commercial", codeCount: 3 }),
        expect.objectContaining({ value: "residential", codeCount: 2 }),
        expect.objectContaining({ value: "manufacturing", codeCount: 1 }),
        expect.objectContaining({ value: "pd", codeCount: 2 }),
        expect.objectContaining({ value: "transport", codeCount: 1 }),
      ]),
    );
  });

  it("cascades district types from the selected family", () => {
    expect(mapZoningDistrictTypeOptions(SOURCE_CLASSES, "")).toEqual([]);
    expect(mapZoningDistrictTypeOptions(SOURCE_CLASSES, "commercial")).toEqual([
      expect.objectContaining({ value: "B3", codeCount: 1 }),
      expect.objectContaining({ value: "C1", codeCount: 2 }),
    ]);
    expect(mapZoningDistrictTypeOptions(SOURCE_CLASSES, "residential")).toEqual([
      expect.objectContaining({ value: "RM", codeCount: 1 }),
      expect.objectContaining({ value: "RS", codeCount: 1 }),
    ]);
  });

  it("builds exact options only after family and type are selected", () => {
    expect(mapZoningExactCodeOptions(SOURCE_CLASSES, "", "")).toEqual([]);
    expect(mapZoningExactCodeOptions(SOURCE_CLASSES, "commercial", "")).toEqual([]);
    expect(mapZoningExactCodeOptions(SOURCE_CLASSES, "commercial", "C1")).toEqual([
      expect.objectContaining({ value: "C1-1", label: expect.stringContaining("low intensity") }),
      expect.objectContaining({ value: "C1-2", label: expect.stringContaining("medium intensity") }),
    ]);
  });

  it("collapses known published aliases into one exact option", () => {
    expect(mapZoningExactCodeOptions(SOURCE_CLASSES, "residential", "RM")).toEqual([
      expect.objectContaining({ value: "RM-4.5" }),
    ]);
  });

  it("stops PD and PMD at the ordinance-lookup type level", () => {
    expect(mapZoningTypeRequiresOrdinanceLookup("PD")).toBe(true);
    expect(mapZoningTypeRequiresOrdinanceLookup("PMD")).toBe(true);
    expect(mapZoningTypeRequiresOrdinanceLookup("C1")).toBe(false);
    expect(mapZoningExactCodeOptions(SOURCE_CLASSES, "pd", "PD")).toEqual([]);
  });

  it("keeps the base family filter when no child selection is active", () => {
    expect(buildMapZoningLayerFilter(["C", "B"], SOURCE_CLASSES, "", "")).toEqual([
      "any",
      ["==", ["slice", ["upcase", ["to-string", ["get", "zone_class"]]], 0, 1], "C"],
      ["==", ["slice", ["upcase", ["to-string", ["get", "zone_class"]]], 0, 1], "B"],
    ]);
  });

  it("refines a family layer to the exact source values for a type", () => {
    expect(buildMapZoningLayerFilter(["C", "B"], SOURCE_CLASSES, "C1", "")).toEqual([
      "all",
      expect.any(Array),
      [
        "in",
        ["upcase", ["to-string", ["get", "zone_class"]]],
        ["literal", ["C1-1", "C1-2"]],
      ],
    ]);
  });

  it("matches every source spelling behind one canonical exact option", () => {
    expect(buildMapZoningLayerFilter(["RS", "RT", "RM"], SOURCE_CLASSES, "RM", "RM-4.5")).toEqual([
      "all",
      expect.any(Array),
      [
        "in",
        ["upcase", ["to-string", ["get", "zone_class"]]],
        ["literal", ["RM4.5", "RM-4.5"]],
      ],
    ]);
  });

  it("fails closed when a selected code is absent from the source", () => {
    expect(buildMapZoningLayerFilter(["C", "B"], SOURCE_CLASSES, "C1", "C1-5")).toEqual([
      "all",
      expect.any(Array),
      ["==", ["literal", 1], ["literal", 0]],
    ]);
  });

  it("updates existing fill and line filters without replacing the map source", () => {
    const sourceIdentity = { id: "chicago-zoning" };
    const map = {
      getLayer: vi.fn(() => ({ id: "existing-layer" })),
      setFilter: vi.fn(),
      setLayoutProperty: vi.fn(),
      getSource: vi.fn((_id: string) => sourceIdentity),
      addSource: vi.fn(),
      removeSource: vi.fn(),
      addLayer: vi.fn(),
    };
    const sourceBefore = map.getSource("chicago-zoning");

    expect(
      applyMapZoningLayerFilters(
        map,
        [{ key: "commercial", prefixes: ["C", "B"] }],
        SOURCE_CLASSES,
        "C1",
        "C1-1",
      ),
    ).toBe(2);

    expect(map.setFilter).toHaveBeenCalledTimes(2);
    expect(map.setFilter).toHaveBeenNthCalledWith(
      1,
      "zoning-commercial-fill",
      expect.any(Array),
    );
    expect(map.setFilter).toHaveBeenNthCalledWith(
      2,
      "zoning-commercial-line",
      expect.any(Array),
    );
    expect(map.setFilter.mock.calls[0][1]).toEqual(map.setFilter.mock.calls[1][1]);
    expect(map.getSource("chicago-zoning")).toBe(sourceBefore);
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.removeSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("removes partial source/layer work when a Mapbox add operation fails", () => {
    const sources = new Set<string>();
    const layers = new Set<string>();
    const map = {
      addSource: vi.fn((id: string) => sources.add(id)),
      getSource: vi.fn((id: string) => (sources.has(id) ? { id } : undefined)),
      removeSource: vi.fn((id: string) => sources.delete(id)),
      addLayer: vi.fn((layer: { id: string }) => {
        if (layer.id === "zoning-commercial-line") throw new Error("Mapbox add failed");
        layers.add(layer.id);
      }),
      getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
      removeLayer: vi.fn((id: string) => layers.delete(id)),
    };

    expect(() =>
      installMapZoningLayers(
        map,
        [{ key: "commercial", prefixes: ["C", "B"], color: "#4A90D9" }],
        { type: "FeatureCollection", features: [] },
        SOURCE_CLASSES,
      ),
    ).toThrow("Mapbox add failed");

    expect(sources.size).toBe(0);
    expect(layers.size).toBe(0);
    expect(map.removeLayer).toHaveBeenCalledWith("zoning-commercial-fill");
    expect(map.removeSource).toHaveBeenCalledWith("chicago-zoning");
  });

  it("focuses one family by mutating only existing layer visibility", () => {
    const map = {
      getLayer: vi.fn(() => ({ id: "existing-layer" })),
      setFilter: vi.fn(),
      setLayoutProperty: vi.fn(),
    };
    const visibility = applyMapZoningFamilyVisibility(
      map,
      [
        { key: "residential", prefixes: ["RS", "RT", "RM"] },
        { key: "commercial", prefixes: ["C", "B"] },
      ],
      "commercial",
    );

    expect(visibility).toEqual({ residential: false, commercial: true });
    expect(map.setLayoutProperty).toHaveBeenCalledTimes(4);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "zoning-residential-fill",
      "visibility",
      "none",
    );
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "zoning-commercial-line",
      "visibility",
      "visible",
    );
  });
});
