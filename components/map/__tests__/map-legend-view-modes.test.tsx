import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MapLegendPanel from "../MapLegendPanel";
import { ZONE_KEYS, VACANT_LABELS, ZONING_CATEGORIES } from "@/lib/constants";
import { POI_LAYERS } from "../map-helpers";
import { INVESTMENT_VIEW_MODE_LABELS } from "@/lib/investment-deck-modes";

/**
 * The admin view-mode control (Dots | Arcs | Density) must appear ONLY when the
 * viewer is admin (adminSessionActive) AND the "Community investment" toggle is
 * on — mirroring the gating tests in map-legend-admin-investment.test.tsx. Its
 * mode-specific captions (arc fallback count, density hex ramp) are asserted
 * without a map, since deck.gl WebGL cannot render in this env.
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

const CONTROL_MARKER = 'aria-label="Investment view mode"';

describe("MapLegendPanel investment view-mode control", () => {
  it("does not render the control for a non-admin viewer", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel {...baseProps()} adminSessionActive={false} communityInvestmentVisible={true} />
    );
    expect(html).not.toContain(CONTROL_MARKER);
  });

  it("does not render the control when admin but the toggle is off", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel {...baseProps()} adminSessionActive={true} communityInvestmentVisible={false} />
    );
    expect(html).not.toContain(CONTROL_MARKER);
  });

  it("renders the three-mode control only when admin AND toggle on", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel {...baseProps()} adminSessionActive={true} communityInvestmentVisible={true} />
    );
    expect(html).toContain(CONTROL_MARKER);
    expect(html).toContain(INVESTMENT_VIEW_MODE_LABELS.dots);
    expect(html).toContain(INVESTMENT_VIEW_MODE_LABELS.arcs);
    expect(html).toContain(INVESTMENT_VIEW_MODE_LABELS.density);
  });

  it("shows the dot-size hint in Dots mode only", () => {
    const dots = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentViewMode="dots"
      />
    );
    expect(dots).toContain("Dot size = amount awarded");

    const density = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentViewMode="density"
      />
    );
    expect(density).not.toContain("Dot size = amount awarded");
  });

  it("captions the Arcs fallback count when funder HQs are missing", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentViewMode="arcs"
        investmentArcMissingHqCount={4}
      />
    );
    expect(html).toContain("4 grants without a mapped funder HQ shown as dots");
  });

  it("omits the Arcs fallback caption when no HQs are missing", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentViewMode="arcs"
        investmentArcMissingHqCount={0}
      />
    );
    expect(html).not.toContain("without a mapped funder HQ");
  });

  it("renders the density hex-bin caption in Density mode", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentViewMode="density"
      />
    );
    expect(html).toContain("$ awarded (hex bins, 250m)");
  });
});
