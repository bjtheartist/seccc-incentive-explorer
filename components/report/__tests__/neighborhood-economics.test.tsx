import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AnchorCards,
  ComparisonBar,
  EconomicSignalCards,
  econMoney,
  econPct,
  visibleSectionItems,
} from "@/components/report/NeighborhoodEconomics";
import type {
  NeighborhoodEconomicContext,
  ReportSection,
} from "@/lib/report-engine";

describe("econMoney", () => {
  it("formats across magnitudes", () => {
    expect(econMoney(2_400_000_000)).toBe("$2.4B");
    expect(econMoney(3_500_000)).toBe("$3.5M");
    expect(econMoney(87_400)).toBe("$87K");
    expect(econMoney(950)).toBe("$950");
  });

  it("returns null for missing values", () => {
    expect(econMoney(null)).toBeNull();
    expect(econMoney(undefined)).toBeNull();
  });
});

describe("econPct", () => {
  it("signs positive rates by default", () => {
    expect(econPct(0.12)).toBe("+12%");
    expect(econPct(-0.07)).toBe("-7%");
  });

  it("omits the sign when unsigned", () => {
    expect(econPct(0.83, false)).toBe("83%");
  });

  it("returns null for missing values", () => {
    expect(econPct(null)).toBeNull();
    expect(econPct(undefined)).toBeNull();
  });
});

describe("visibleSectionItems", () => {
  it("hides the anchors section entirely (rendered as cards)", () => {
    const section: ReportSection = {
      title: "Local Impact Anchors",
      description: "",
      items: [{ label: "Anchor", value: "x" }],
    };
    expect(visibleSectionItems(section)).toEqual([]);
  });

  it("filters card-rendered labels out of the economic section", () => {
    const section: ReportSection = {
      title: "Neighborhood Economic Context",
      description: "",
      items: [
        { label: "Business Continuity", value: "x" },
        { label: "Jobs & Payroll", value: "x" },
        { label: "Something Else", value: "kept" },
      ],
    };
    expect(visibleSectionItems(section).map((i) => i.label)).toEqual([
      "Something Else",
    ]);
  });

  it("passes other sections through untouched", () => {
    const section: ReportSection = {
      title: "Confirmed Programs",
      description: "",
      items: [{ label: "SBIF", value: "x" }],
    };
    expect(visibleSectionItems(section)).toHaveLength(1);
  });
});

describe("EconomicSignalCards", () => {
  it("renders nothing when no signals are present", () => {
    expect(renderToStaticMarkup(<EconomicSignalCards economics={{}} />)).toBe(
      "",
    );
  });

  it("labels measured signals with the public-record tag", () => {
    const economics: NeighborhoodEconomicContext = {
      businessContinuity: {
        continuityRate: 0.83,
        baselineYear: 2019,
        comparisonYear: 2024,
      },
    };
    const html = renderToStaticMarkup(
      <EconomicSignalCards economics={economics} />,
    );
    expect(html).toContain("Business Continuity");
    expect(html).toContain("83%");
    expect(html).toContain("Measured public record");
  });

  it("keeps modeled figures labeled as modeled, never as available funding", () => {
    const economics: NeighborhoodEconomicContext = {
      leakage: { capturableDemand: 12_000_000 },
      multiplier: {
        localOutputEstimateLow: 5_000_000,
        localOutputEstimateHigh: 8_000_000,
      },
    };
    const html = renderToStaticMarkup(
      <EconomicSignalCards economics={economics} />,
    );
    expect(html).toContain("$12.0M/yr");
    expect(html).toContain("Modeled from ACS income");
    expect(html).toContain("$5.0M–$8.0M");
    expect(html).toContain("Modeled / needs verification");
  });

  it("caps the grid at six cards, dropping the lowest-priority signal", () => {
    const economics: NeighborhoodEconomicContext = {
      businessContinuity: { continuityRate: 0.8 },
      jobsPayroll: { payrollGrowthRate: 0.1, employmentGrowthRate: 0.05 },
      reinvestment: { permitCount: 42, reportedCost: 1_000_000 },
      property: { assessedValueChangeRate: 0.15 },
      tifFinance: { fundBalance: 2_000_000, districtName: "Commercial Ave" },
      leakage: { capturableDemand: 12_000_000 },
      multiplier: {
        localOutputEstimateLow: 5_000_000,
        localOutputEstimateHigh: 8_000_000,
      },
    };
    const html = renderToStaticMarkup(
      <EconomicSignalCards economics={economics} />,
    );
    expect(html).toContain("Resident Spending Power");
    // Local Multiplier is built last (lowest priority) and drops off the 2×3 grid.
    expect(html).not.toContain("Local Multiplier");
  });
});

describe("AnchorCards", () => {
  it("renders nothing for an empty list", () => {
    expect(renderToStaticMarkup(<AnchorCards anchors={[]} />)).toBe("");
  });

  it("renders anchor name, rationale, and source link", () => {
    const html = renderToStaticMarkup(
      <AnchorCards
        anchors={[
          {
            name: "South Chicago Library",
            type: "Library",
            rationale: "Foot traffic anchor",
            multiplierChannels: "Nearby lunch spots",
            sourceUrls: ["https://example.com/library"],
          },
        ]}
      />,
    );
    expect(html).toContain("South Chicago Library");
    expect(html).toContain("Foot traffic anchor");
    expect(html).toContain("What it may support");
    expect(html).toContain("https://example.com/library");
  });
});

describe("ComparisonBar", () => {
  it("renders both rows with the city as baseline", () => {
    const html = renderToStaticMarkup(
      <ComparisonBar
        label="Median Household Income"
        locationFormatted="$52K"
        cityFormatted="$71K"
        pct={73}
      />,
    );
    expect(html).toContain("Median Household Income");
    expect(html).toContain("73% of city median");
    expect(html).toContain("$52K");
    expect(html).toContain("$71K");
  });
});
