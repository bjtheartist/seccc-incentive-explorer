import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FunderDonut } from "@/components/investment/FunderDonut";
import { YearBars } from "@/components/investment/YearBars";
import { SourceBars } from "@/components/investment/SourceBars";
import type { FunderTypeBreakdown, YearBreakdown, SourceBreakdown } from "@/lib/investment-analysis";

/**
 * Semantic guard for the visx-substrate analysis charts. These assert the
 * load-bearing contract — validated funder-type hues, the neutral magnitude hue,
 * native tooltips, the mandatory direct labels, and the iron-rule language
 * ("Awarded" only; never received / available / remaining / unspent) — not the
 * private SVG geometry, so the visx refactor is free to change path internals.
 * The components are server components; rendering them to static markup here
 * doubles as the server-render check.
 */

const byFunderType: FunderTypeBreakdown[] = [
  { funderType: "government", awardedDollars: 900_000_000, count: 40, share: 0.9 },
  { funderType: "philanthropic", awardedDollars: 90_000_000, count: 12, share: 0.09 },
  { funderType: "private_development", awardedDollars: 10_000_000, count: 3, share: 0.01 },
];

const byYear: YearBreakdown[] = [
  { year: 2020, awardedDollars: 100_000_000, count: 5 },
  { year: 2021, awardedDollars: 0, count: 0 },
  { year: 2022, awardedDollars: 400_000_000, count: 20 },
  { year: 2023, awardedDollars: 137_000_000, count: 10 },
  { year: 2026, awardedDollars: 50_000_000, count: 2 },
];

const bySource: SourceBreakdown[] = [
  { source: "nof-large", awardedDollars: 500_000_000, count: 15 },
  { source: "sbif", awardedDollars: 12_500_000, count: 4 },
  { source: "development", awardedDollars: 0, count: 7 },
];

const FORBIDDEN = /\b(received|available|remaining|unspent)\b/i;

describe("investment analysis charts (visx substrate)", () => {
  it("FunderDonut keeps the three validated hues, tooltips, and the center total", () => {
    const html = renderToStaticMarkup(<FunderDonut byFunderType={byFunderType} total={1_000_000_000} />);
    expect(html).toContain("#2563EB");
    expect(html).toContain("#059669");
    expect(html).toContain("#7C3AED");
    expect(html).toContain("<title>"); // native hover tooltip per slice
    expect(html).toContain("$1.0B"); // center total, compact
    expect(html).toContain("awarded since 2020");
    expect(html).not.toMatch(FORBIDDEN);
  });

  it("YearBars is a single neutral series with a peak-only direct label", () => {
    const html = renderToStaticMarkup(
      <YearBars byYear={byYear} unYeared={2} generatedAt="2026-08-04T13:54:09.889Z" />,
    );
    expect(html).toContain("#475569"); // magnitude hue
    expect(html).not.toContain("#2563EB"); // funder-type hues stay off the magnitude chart
    expect(html).toContain("$400.0M"); // peak year label
    expect(html).not.toContain("$137.0M"); // non-peak years are not directly labeled
    expect(html).toContain("<title>");
    // Deliverable 3 (audit finding 11 / consult F8): the badge no longer
    // claims ordinary calendar "YTD" — a foundation row in this bucket would
    // be grouped by its own (possibly already-complete, non-calendar) filer
    // tax year, not a still-accumulating calendar year.
    expect(html).toContain("2026 · Partial source/reporting-year coverage");
    expect(html).not.toContain("· Partial year<");
    expect(html).toContain("August 4, 2026");
    expect(html).toContain("source/reporting year");
    expect(html).toContain("Closed CARES and ARPA recipient files");
    expect(html).not.toMatch(FORBIDDEN);
  });

  it("SourceBars uses the neutral hue with tip values and a dev count-only row", () => {
    const html = renderToStaticMarkup(<SourceBars bySource={bySource} />);
    expect(html).toContain("#475569");
    expect(html).not.toContain("#7C3AED");
    expect(html).toContain("$500.0M");
    expect(html).toContain("dollar amounts not disclosed");
    expect(html).toContain("<title>");
    expect(html).not.toMatch(FORBIDDEN);
  });
});
