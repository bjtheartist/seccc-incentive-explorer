import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MapLegendPanel from "../MapLegendPanel";
import { ZONE_KEYS, VACANT_LABELS, ZONING_CATEGORIES } from "@/lib/constants";
import { POI_LAYERS } from "../map-helpers";

/**
 * The ADMIN ownership-cluster legend section is probe-driven
 * (components/map/MapView.tsx probes /api/owner-file/session once on mount
 * and passes the result in as adminSessionActive) — it must never render for
 * a non-admin visitor, and must render with the "Ownership clusters" toggle
 * defaulted OFF when it does.
 */
function baseProps() {
  return {
    zoneVisible: Object.fromEntries(ZONE_KEYS.map((k) => [k, false])),
    poiVisible: Object.fromEntries(Object.keys(POI_LAYERS).map((k) => [k, false])),
    zoningVisible: Object.fromEntries(ZONING_CATEGORIES.map((cat) => [cat.key, true])),
    vacantVisible: Object.fromEntries(Object.keys(VACANT_LABELS).map((k) => [k, false])),
    parcelsVisible: false,
    ownerFilter: "all" as const,
    expandedZone: null,
    zoningRefOpen: false,
    classRefOpen: false,
    inspectMode: false,
    activePreset: null,
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

describe("MapLegendPanel admin ownership-cluster section", () => {
  it("does not render the ADMIN section for a non-admin viewer", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={false}
        ownerClustersVisible={false}
      />
    );
    expect(html).not.toContain("Admin");
    expect(html).not.toContain("Ownership clusters");
  });

  it("renders the ADMIN section with the toggle defaulted off for an admin viewer", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        ownerClustersVisible={false}
      />
    );
    expect(html).toContain("Admin");
    expect(html).toContain("Ownership clusters");
    // Unchecked checkbox — no checked attribute in the static markup.
    expect(html).not.toMatch(/Ownership clusters[\s\S]*?checked="?true"?/);
  });

  it("reflects the toggle being on", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        ownerClustersVisible={true}
      />
    );
    expect(html).toContain("Ownership clusters");
  });

  it("shows a loading indicator and an error message when provided", () => {
    const loadingHtml = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        ownerClustersVisible={true}
        ownerClustersLoading={true}
      />
    );
    expect(loadingHtml).toContain("Loading ownership clusters");

    const errorHtml = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        ownerClustersVisible={true}
        ownerClustersError="Ownership clusters could not be loaded."
      />
    );
    expect(errorHtml).toContain("Ownership clusters could not be loaded.");
  });
});
