import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MapLegendPanel from "../MapLegendPanel";
import {
  buildCountyReliefPopupHtml,
  buildInvestmentPopupHtml,
  formatAwardedAmount,
} from "../map-helpers";
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
    expect(html).not.toContain("Dot size = each record");
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
    expect(html).toContain("Dot size = each record");
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
    expect(html).not.toContain("Dot size = each record");
    expect(html).not.toContain("Citywide commitments");
  });

  it("shows the capital-class sub-legend only when a NON-grant class is present", () => {
    const withNonGrant = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentPresentCapitalClasses={["grant", "tif_subsidy", "tax_credit"]}
      />
    );
    expect(withNonGrant).toContain("Capital class");
    expect(withNonGrant).toContain("TIF subsidy");
    expect(withNonGrant).toContain("Authorized");
    expect(withNonGrant).toContain("Tax credit");
    expect(withNonGrant).toContain("Tax-credit allocation");

    // Grant-only → no sub-legend (it would be noise).
    const grantOnly = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        investmentPresentCapitalClasses={["grant"]}
      />
    );
    expect(grantOnly).not.toContain("Capital class");
  });

  it("renders the county and state overlays as independent, default-off controls", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        communityInvestmentVisible={true}
        publicInvestmentOverlays={{
          county_relief_awards: true,
          state_capital_projects: false,
        }}
        countyReliefZipCount={18}
        stateCapitalPlottedCount={7}
        stateCapitalCitywideCount={11}
      />
    );
    expect(html).toContain("County relief awards");
    expect(html).toContain("State capital projects");
    expect(html).toContain("18 Chicago ZIP areas mapped");
    expect(html).not.toContain("7 address-sited");
    expect(html).toContain("not an active funding opportunity");
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

  it("renders recipient, funder, funder-type chip, year, humanized status, log line, and source link", () => {
    const html = buildInvestmentPopupHtml(full);
    expect(html).toContain("Auburn Gresham GDC");
    expect(html).toContain("MacArthur Foundation — Chicago Prize");
    expect(html).toContain(FUNDER_TYPE_LABELS.philanthropic);
    expect(html).toContain("2020");
    // Status is humanized — "Completed", never the raw enum value.
    expect(html).toContain("Completed");
    expect(html).toContain("Healthy Lifestyle Hub build-out");
    expect(html).toContain('href="https://example.org/grant"');
  });

  it("labels a DEVELOPMENT figure 'Announced' (never 'Awarded'), reads announcedInvestment, humanizes status", () => {
    const html = buildInvestmentPopupHtml({
      recipient: "1901 Project",
      funderName: "United Center Joint Venture",
      funderType: "private_development",
      amountAwarded: null,
      announcedInvestment: 7_000_000_000,
      logLine: "55-acre entertainment district",
      year: 2024,
      status: "under_construction",
      sourceLink: "https://example.org/1901",
    });
    expect(html).toContain("Announced");
    expect(html).toContain("$7,000,000,000");
    // A development NEVER shows the "Awarded" label.
    expect(html).not.toContain("Awarded");
    expect(html.toLowerCase()).not.toContain("received");
    // Raw snake_case status must be humanized to "Under construction".
    expect(html).toContain("Under construction");
    expect(html).not.toContain("under_construction");
  });

  it("renders 'Not disclosed' for a development with no announced figure (still 'Announced', never 'received')", () => {
    const html = buildInvestmentPopupHtml({
      recipient: "Some Development",
      funderName: "Invest South/West",
      funderType: "private_development",
      amountAwarded: null,
      announcedInvestment: null,
      logLine: null,
      year: null,
      status: "announced",
      sourceLink: "",
    });
    expect(html).toContain("Announced");
    expect(html).toContain("Not disclosed");
    expect(html.toLowerCase()).not.toContain("received");
    // No source anchor when there is no link.
    expect(html).not.toContain("<a ");
  });

  it("drops a non-http(s) source link", () => {
    const html = buildInvestmentPopupHtml({ ...full, sourceLink: "javascript:alert(1)" });
    expect(html).not.toContain("<a ");
  });

  // The money-NOUN span (the label directly in front of the dollar figure) is
  // rendered with this style fragment; asserting against it isolates the money
  // noun from the separate lifecycle-status badge (which may itself read
  // "Awarded" for a TIF/tax-credit record — a different, legitimate axis).
  const MONEY_LABEL = (label: string) => `color:#8A93A6">${label}</span>`;

  it("labels a TIF ceiling 'Authorized' (never the 'Awarded' money noun), reading authorizedAmount", () => {
    const html = buildInvestmentPopupHtml({
      recipient: "5039 N Kimball",
      funderName: "City of Chicago — TIF",
      funderType: "government",
      capitalClass: "tif_subsidy",
      amountAwarded: null,
      authorizedAmount: 2_500_000,
      status: "awarded",
      year: 2021,
    });
    expect(html).toContain(MONEY_LABEL("Authorized"));
    expect(html).toContain("$2,500,000");
    expect(html).not.toContain(MONEY_LABEL("Awarded"));
    expect(html.toLowerCase()).not.toContain("received");
  });

  it("labels a HUD CDBG/HOME allocation with the 'Federal program funding' money noun", () => {
    const html = buildInvestmentPopupHtml({
      recipient: "3403 W Lawrence",
      funderName: "City of Chicago — CDBG/HOME",
      funderType: "government",
      capitalClass: "federal_program",
      amountAwarded: null,
      authorizedAmount: 68_868,
      status: "completed",
    });
    expect(html).toContain(MONEY_LABEL("Federal program funding"));
    expect(html).toContain("$68,868");
    expect(html).not.toContain(MONEY_LABEL("Awarded"));
  });

  it("labels a LIHTC/NMTC figure with the 'Tax-credit allocation' money noun, reading creditAmount", () => {
    const html = buildInvestmentPopupHtml({
      recipient: "901 W 63rd St",
      funderName: "IHDA — LIHTC",
      funderType: "government",
      capitalClass: "tax_credit",
      amountAwarded: null,
      creditAmount: 9_107_089,
      status: "awarded",
    });
    expect(html).toContain(MONEY_LABEL("Tax-credit allocation"));
    expect(html).toContain("$9,107,089");
    expect(html).not.toContain(MONEY_LABEL("Awarded"));
  });

  it("labels a DCEO amount as a published appropriation balance, never an award or opportunity", () => {
    const html = buildInvestmentPopupHtml({
      recipient: "Chicago Park District",
      funderName: "Illinois DCEO",
      funderType: "government",
      capitalClass: "state_appropriation",
      amountAwarded: null,
      publishedBalance: 125_000,
      status: "appropriated",
    });
    expect(html).toContain(MONEY_LABEL("Published appropriation balance"));
    expect(html).toContain("$125,000");
    expect(html).not.toContain(MONEY_LABEL("Awarded"));
    expect(html).toContain("Appropriation record");
  });

  it("adds an 'Analyze this community →' link to the record's community area", () => {
    const html = buildInvestmentPopupHtml({ ...full, communityArea: "Auburn Gresham" });
    expect(html).toContain("Analyze this community");
    expect(html).toContain('href="/investment/Auburn%20Gresham"');
  });

  it("omits the Analyze link when the record has no community area", () => {
    const html = buildInvestmentPopupHtml(full);
    expect(html).not.toContain("Analyze this community");
  });
});

describe("buildCountyReliefPopupHtml", () => {
  it("shows ZIP-level historical disbursement context without presenting an active program", () => {
    const html = buildCountyReliefPopupHtml({
      zipCode: "60617",
      awardCount: 42,
      totalDisbursed: 620_000,
      sourceLink: "https://example.org/source.pdf",
    });
    expect(html).toContain("ZIP 60617");
    expect(html).toContain("42 small-business awards");
    expect(html).toContain("$620,000");
    expect(html).toContain("program is complete");
    expect(html).toContain("not an active funding opportunity");
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
