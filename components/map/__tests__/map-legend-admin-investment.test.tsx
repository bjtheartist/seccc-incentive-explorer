import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MapLegendPanel from "../MapLegendPanel";
import { buildInvestmentPopupHtml, formatAwardedAmount } from "../map-helpers";
import { ZONE_KEYS, VACANT_LABELS, ZONING_CATEGORIES } from "@/lib/constants";
import { POI_LAYERS } from "../map-helpers";
import { FUNDER_TYPE_LABELS, INVESTMENT_YEAR_RANGES } from "@/lib/community-investment-layer";

/**
 * The ADMIN "Community investment" legend section is probe-driven exactly like
 * the ownership-cluster section (components/map/MapView.tsx probes
 * /api/owner-file/session once on mount and passes the 204 result in as
 * adminSessionActive): it must never render for a non-admin visitor, and must
 * render with the toggle defaulted OFF when it does. Mirrors
 * map-legend-admin-ownership.test.tsx.
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

describe("MapLegendPanel community-investment admin section", () => {
  it("does not render the section for a non-admin viewer", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel {...baseProps()} adminSessionActive={false} communityInvestmentVisible={false} />
    );
    expect(html).not.toContain("Admin");
    expect(html).not.toContain("Community investment");
  });

  it("renders the toggle defaulted off for an admin viewer (204), with no sub-controls", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel {...baseProps()} adminSessionActive={true} communityInvestmentVisible={false} />
    );
    expect(html).toContain("Admin");
    expect(html).toContain("Community investment");
    // Off → the year/funder/citywide sub-controls are absent.
    expect(html).not.toContain("Dot size = amount awarded");
    expect(html).not.toContain("Citywide commitments");
    // Unchecked toggle — no checked attribute right after the label.
    expect(html).not.toMatch(/Community investment[\s\S]*?checked="?true"?/);
  });

  it("shows year chips, present funderType checkboxes, and the dot-size hint when on", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentPresentFunderTypes={["government", "philanthropic"]}
        investmentYearRange="all"
        investmentFunderTypes={{
          government: true,
          philanthropic: true,
          private_development: true,
        }}
      />
    );
    // Year chips.
    for (const range of INVESTMENT_YEAR_RANGES) {
      expect(html).toContain(range.label);
    }
    // Only the present funder types get a checkbox.
    expect(html).toContain(FUNDER_TYPE_LABELS.government);
    expect(html).toContain(FUNDER_TYPE_LABELS.philanthropic);
    expect(html).not.toContain(FUNDER_TYPE_LABELS.private_development);
    expect(html).toContain("Dot size = amount awarded");
  });

  it("renders the collapsible Citywide commitments note with a count when there are citywide records", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentCitywide={{ count: 3, totalDollars: 500_000 }}
      />
    );
    expect(html).toContain("Citywide commitments (3)");
  });

  it("omits the Citywide note when the count is zero", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentCitywide={{ count: 0, totalDollars: 0 }}
      />
    );
    expect(html).not.toContain("Citywide commitments");
  });

  it("shows loading + error messages when provided", () => {
    const loadingHtml = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        communityInvestmentLoading={true}
      />
    );
    expect(loadingHtml).toContain("Loading community investment");

    const errorHtml = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        communityInvestmentError="Community investment data could not be loaded."
      />
    );
    expect(errorHtml).toContain("Community investment data could not be loaded.");
  });

  it("does not render sub-controls or the color key when the toggle is off even if data is present", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={false}
        investmentPresentFunderTypes={["government"]}
        investmentCitywide={{ count: 5, totalDollars: 1_000_000 }}
      />
    );
    expect(html).not.toContain("Dot size = amount awarded");
    expect(html).not.toContain("Citywide commitments");
  });
});

describe("buildInvestmentPopupHtml", () => {
  const full = {
    recipient: "Auburn Gresham GDC",
    funderName: "MacArthur Foundation — Chicago Prize",
    funderType: "philanthropic",
    amountAwarded: 10_000_000,
    logLine: "Healthy Lifestyle Hub build-out",
    year: 2020,
    status: "completed",
    sourceLink: "https://example.org/grant",
  };

  it("labels the dollar figure 'Awarded' and NEVER 'received'", () => {
    const html = buildInvestmentPopupHtml(full);
    expect(html).toContain("Awarded");
    expect(html).toContain("$10,000,000");
    expect(html.toLowerCase()).not.toContain("received");
  });

  it("renders recipient, funder, funder-type chip, year, status, log line, and source link", () => {
    const html = buildInvestmentPopupHtml(full);
    expect(html).toContain("Auburn Gresham GDC");
    expect(html).toContain("MacArthur Foundation — Chicago Prize");
    expect(html).toContain(FUNDER_TYPE_LABELS.philanthropic);
    expect(html).toContain("2020");
    expect(html).toContain("completed");
    expect(html).toContain("Healthy Lifestyle Hub build-out");
    expect(html).toContain('href="https://example.org/grant"');
  });

  it("renders 'Not disclosed' for a null amount, still 'Awarded', still never 'received'", () => {
    const html = buildInvestmentPopupHtml({
      recipient: "Some Development",
      funderName: "Invest South/West",
      funderType: "private_development",
      amountAwarded: null,
      logLine: null,
      year: null,
      status: "announced",
      sourceLink: "",
    });
    expect(html).toContain("Awarded");
    expect(html).toContain("Not disclosed");
    expect(html.toLowerCase()).not.toContain("received");
    // No source anchor when there is no link.
    expect(html).not.toContain("<a ");
  });

  it("drops a non-http(s) source link", () => {
    const html = buildInvestmentPopupHtml({ ...full, sourceLink: "javascript:alert(1)" });
    expect(html).not.toContain("<a ");
  });
});

describe("formatAwardedAmount", () => {
  it("formats whole dollars with grouping", () => {
    expect(formatAwardedAmount(1234567)).toBe("$1,234,567");
    expect(formatAwardedAmount(0)).toBe("$0");
  });

  it("returns 'Not disclosed' for null/undefined/non-finite", () => {
    expect(formatAwardedAmount(null)).toBe("Not disclosed");
    expect(formatAwardedAmount(undefined)).toBe("Not disclosed");
    expect(formatAwardedAmount(Number.NaN)).toBe("Not disclosed");
  });
});
