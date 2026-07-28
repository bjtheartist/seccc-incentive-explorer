import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MapLegendPanel from "../MapLegendPanel";
import { ZONE_KEYS, VACANT_LABELS, ZONING_CATEGORIES } from "@/lib/constants";
import { POI_LAYERS } from "../map-helpers";
import { INVESTMENT_VIEW_MODE_LABELS } from "@/lib/investment-deck-modes";
import {
  MEGAPROJECT_ANNOUNCED_CAPITAL_LABEL,
  MEGAPROJECT_STATUS_GROUP_LABELS,
  type MegaprojectSummary,
} from "@/lib/community-investment-layer";

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

  it("renders one compact three-mode control only when admin AND toggle on", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel {...baseProps()} adminSessionActive={true} communityInvestmentVisible={true} />
    );
    expect(html).toContain(CONTROL_MARKER);
    expect(html).toContain("grid-cols-3");
    expect(html).toContain(INVESTMENT_VIEW_MODE_LABELS.dots);
    expect(html).toContain(INVESTMENT_VIEW_MODE_LABELS.arcs);
    expect(html).toContain(INVESTMENT_VIEW_MODE_LABELS.density);
  });

  it("renders Megaprojects as a separate admin-only overlay switch", () => {
    const nonAdmin = renderToStaticMarkup(
      <MapLegendPanel {...baseProps()} adminSessionActive={false} communityInvestmentVisible={true} />
    );
    expect(nonAdmin).not.toContain("Toggle Megaprojects overlay");

    const toggleOff = renderToStaticMarkup(
      <MapLegendPanel {...baseProps()} adminSessionActive={true} communityInvestmentVisible={false} />
    );
    expect(toggleOff).not.toContain("Toggle Megaprojects overlay");

    const on = renderToStaticMarkup(
      <MapLegendPanel {...baseProps()} adminSessionActive={true} communityInvestmentVisible={true} />
    );
    expect(on).toContain("Toggle Megaprojects overlay");
    expect(on).toContain("Additional layer");
    expect(on).toContain("Major private developments");
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
    // Per-class honest caption: dots are sized by each record's OWN money field,
    // not a single "amount awarded" that would floor every non-grant dot.
    expect(dots).toContain("Dot size = each record");
    expect(dots).toContain("own capital amount");

    const density = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentViewMode="density"
      />
    );
    expect(density).not.toContain("Dot size = each record");
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

  it("labels Arcs honestly as 'Foundation flows (N tracked HQs)'", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentViewMode="arcs"
        investmentFunderHqCount={12}
      />
    );
    expect(html).toContain("Foundation flows (12 tracked HQs)");
    // The existing caption stays alongside the honest label.
    expect(html).toContain("Arc: funder HQ");
  });

  it("Density gets a dollars|records metric toggle; records swaps the caption", () => {
    const dollars = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentViewMode="density"
        investmentDensityMetric="dollars"
      />
    );
    expect(dollars).toContain('aria-label="Density metric"');
    expect(dollars).toContain("$ awarded (hex bins, 250m)");
    expect(dollars).not.toContain("record count (hex bins, 250m)");

    const records = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentViewMode="density"
        investmentDensityMetric="records"
      />
    );
    expect(records).toContain("record count (hex bins, 250m)");
    expect(records).not.toContain("$ awarded (hex bins, 250m)");
  });

  it("Megaprojects overlay renders the status legend, announced-capital label, and not-plotted note", () => {
    const summary: MegaprojectSummary = {
      plottedCount: 106,
      groupCounts: { open: 12, building: 16, planned: 75, stalled: 3 },
      totalAnnounced: 73_906_800_000,
    };
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentViewMode="dots"
        investmentMegaprojectsVisible={true}
        investmentMegaprojectSummary={summary}
        investmentMegaprojectCitywideNames={["Advocate Health Care South Side Investment"]}
      />
    );
    // Four status-group labels + their counts.
    expect(html).toContain(MEGAPROJECT_STATUS_GROUP_LABELS.open);
    expect(html).toContain(MEGAPROJECT_STATUS_GROUP_LABELS.building);
    expect(html).toContain(MEGAPROJECT_STATUS_GROUP_LABELS.planned);
    expect(html).toContain(MEGAPROJECT_STATUS_GROUP_LABELS.stalled);
    expect(html).toContain("12");
    expect(html).toContain("16");
    expect(html).toContain("75");
    // Announced total: formatted figure + the EXACT label (Announced, never Awarded).
    expect(html).toContain("$73,906,800,000");
    expect(html).toContain(MEGAPROJECT_ANNOUNCED_CAPITAL_LABEL);
    expect(MEGAPROJECT_ANNOUNCED_CAPITAL_LABEL).toBe("Announced private capital — not awarded dollars");
    // Citywide / multi-site "not plotted" note + the name in the hover title.
    expect(html).toContain("1 citywide/multi-site");
    expect(html).toContain("not plotted");
    expect(html).toContain("Advocate Health Care South Side Investment");
  });

  it("can combine Megaprojects with another base view", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentViewMode="arcs"
        investmentFunderHqCount={12}
        investmentMegaprojectsVisible={true}
        investmentMegaprojectSummary={{
          plottedCount: 1,
          groupCounts: { open: 1, building: 0, planned: 0, stalled: 0 },
          totalAnnounced: 1,
        }}
      />
    );
    expect(html).toContain("Foundation flows (12 tracked HQs)");
    expect(html).toContain("Major developments (1 plotted)");
    expect(html).toContain(MEGAPROJECT_ANNOUNCED_CAPITAL_LABEL);
  });

  it("does not show the megaproject detail legend while the overlay is off", () => {
    for (const mode of ["dots", "arcs", "density"] as const) {
      const html = renderToStaticMarkup(
        <MapLegendPanel
          {...baseProps()}
          adminSessionActive={true}
          communityInvestmentVisible={true}
          investmentViewMode={mode}
          investmentMegaprojectsVisible={false}
          investmentMegaprojectSummary={{
            plottedCount: 1,
            groupCounts: { open: 1, building: 0, planned: 0, stalled: 0 },
            totalAnnounced: 1,
          }}
        />
      );
      expect(html).not.toContain(MEGAPROJECT_ANNOUNCED_CAPITAL_LABEL);
    }
  });
});
