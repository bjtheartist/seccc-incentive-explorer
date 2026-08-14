import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ZONE_KEYS, VACANT_LABELS, ZONING_CATEGORIES } from "@/lib/constants";
import MapLegendPanel from "../MapLegendPanel";
import { POI_LAYERS } from "../map-helpers";

const SOURCE_CLASSES = [
  "B1-2",
  "C1-1",
  "C1-2",
  "RS-2",
  "PD 123",
  "PMD 4",
];

function baseProps() {
  return {
    zoneVisible: Object.fromEntries(ZONE_KEYS.map((key) => [key, false])),
    poiVisible: Object.fromEntries(Object.keys(POI_LAYERS).map((key) => [key, false])),
    zoningVisible: Object.fromEntries(
      ZONING_CATEGORIES.map((category) => [category.key, true]),
    ),
    zoningDistrictClasses: SOURCE_CLASSES,
    zoningLayerStatus: "available" as const,
    vacantVisible: Object.fromEntries(
      Object.keys(VACANT_LABELS).map((key) => [key, false]),
    ),
    parcelsVisible: false,
    ownerFilter: "all" as const,
    expandedZone: null,
    zoningRefOpen: false,
    classRefOpen: false,
    inspectMode: false,
    activePreset: null,
    adminSessionActive: false,
    ownerClustersVisible: false,
    onClose: () => {},
    onToggleZone: () => {},
    onTogglePoi: () => {},
    onToggleZoningCategory: () => {},
    onToggleAllZoning: () => {},
    onSetVacantVisible: () => {},
    onSetParcelsVisible: () => {},
    onSetOwnerFilter: () => {},
    onSetExpandedZone: () => {},
    onSetZoningRefOpen: () => {},
    onSetClassRefOpen: () => {},
    onSetInspectMode: () => {},
    onApplyPreset: () => {},
    onSetOwnerClustersVisible: () => {},
  };
}

describe("MapLegendPanel linked zoning filters", () => {
  it("renders family, type, and exact controls with the permit-use boundary", () => {
    const html = renderToStaticMarkup(<MapLegendPanel {...baseProps()} />);

    expect(html).toContain("Focus zoning overlay");
    expect(html).toContain('id="map-zoning-family-filter"');
    expect(html).toContain('id="map-zoning-type-filter"');
    expect(html).toContain('id="map-zoning-exact-filter"');
    expect(html).toContain("Business/Commercial (3 codes)");
    expect(html).toContain("Manual family visibility");
    expect(html).toContain("does not determine whether a particular use is permitted");
    expect(html.match(/text-base/g)).toHaveLength(3);
    expect(html.match(/focus-visible:ring-2/g)).toHaveLength(3);
  });

  it("cascades commercial options down to C1 and exact published codes", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        zoningFamilyFilter="commercial"
        zoningDistrictTypeFilter="C1"
        zoningExactCodeFilter="C1-1"
      />,
    );

    expect(html).toContain("C1 · Neighborhood Commercial (2 codes)");
    expect(html).toContain("C1-1 · Neighborhood Commercial (low intensity)");
    expect(html).toContain("C1-2 · Neighborhood Commercial (medium intensity)");
    expect(html).toContain("C1-1 highlighted");
    expect(html).toContain(">Clear<");
  });

  it("stops PD at an ordinance handoff instead of presenting numbers as reusable codes", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        zoningFamilyFilter="pd"
        zoningDistrictTypeFilter="PD"
      />,
    );

    expect(html).toContain("Inspect the site-specific ordinance");
    expect(html).toContain("PD and PMD numbers point to site-specific ordinances");
    expect(html).not.toContain("inspect the published designation and governing ordinance");
    expect(html).not.toContain('value="PD 123"');
  });

  it("explains why the controls are unavailable before the zoning source loads", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        zoningDistrictClasses={[]}
        zoningLayerStatus="loading"
      />,
    );

    expect(html).toContain("Published district choices will appear when the zoning layer finishes loading");
    expect(html).toContain('id="map-zoning-family-filter" disabled=""');
  });

  it("reports an unavailable source instead of promising that loading will finish", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        zoningDistrictClasses={SOURCE_CLASSES}
        zoningLayerStatus="unavailable"
      />,
    );

    expect(html).toContain("Published zoning districts are temporarily unavailable");
    expect(html).not.toContain("will appear when the zoning layer finishes loading");
    expect(html).toContain('id="map-zoning-family-filter" disabled=""');
    expect(html).toContain('type="checkbox" disabled=""');
    expect(html).toMatch(/<button disabled=""[^>]*>(?:Hide|Show) all<\/button>/);
  });
});
