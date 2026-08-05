import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MapLegendPanel from "../MapLegendPanel";
import { ZONE_KEYS, VACANT_LABELS, ZONING_CATEGORIES } from "@/lib/constants";
import { POI_LAYERS } from "../map-helpers";
import { PERMIT_MAP_TYPES, defaultPermitTypeVisibility } from "@/lib/permit-map";

function baseProps() {
  return {
    zoneVisible: Object.fromEntries(ZONE_KEYS.map((key) => [key, false])),
    poiVisible: Object.fromEntries(Object.keys(POI_LAYERS).map((key) => [key, false])),
    zoningVisible: Object.fromEntries(ZONING_CATEGORIES.map((category) => [category.key, true])),
    vacantVisible: Object.fromEntries(Object.keys(VACANT_LABELS).map((key) => [key, false])),
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

describe("MapLegendPanel building permits", () => {
  it("keeps the permit layer off by default", () => {
    const html = renderToStaticMarkup(<MapLegendPanel {...baseProps()} />);
    expect(html).toContain("Building permits");
    expect(html).toContain("visible at zoom 12+");
    expect(html).not.toContain("Permit types");
  });

  it("renders every source permit type when the layer is on", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        permitsVisible
        permitTypeVisible={defaultPermitTypeVisibility()}
      />,
    );

    expect(PERMIT_MAP_TYPES).toHaveLength(9);
    expect(html).toContain("Permit types");
    for (const permitType of PERMIT_MAP_TYPES) {
      expect(html).toContain(permitType.label);
    }
  });

  it("states the filing and verification limits without a dollar rollup", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        permitsVisible
        permitTypeVisible={defaultPermitTypeVisibility()}
      />,
    );

    expect(html).toContain("Filings indicate permit activity, not completed construction");
    expect(html).toContain("Verify status with the City");
    expect(html).not.toMatch(/permit (total|investment|value)/i);
  });
});
