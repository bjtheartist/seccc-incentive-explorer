import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EquityContext } from "@/components/investment/EquityContext";
import type { InvestmentEquity } from "@/lib/investment-analysis";

/**
 * Deliverable 3 (audit finding 5 / consult Q4) — the rank disclosure that
 * quantifies recipient-office clustering risk: a community's rank can be
 * dominated by where a foundation's grantee HEADQUARTERS sits rather than
 * where the money was spent. The dollar figures must be read from
 * equity.foundationDollars/foundationShare (computed live in
 * lib/investment-analysis.ts), never hand-typed — this test pins the exact
 * consult wording using values that mirror its own "Loop" illustration
 * without literally requiring that community.
 */

const baseEquity: InvestmentEquity = {
  rank: 1,
  totalCAs: 77,
  citywideMedianCA: 5_000_000,
  thisVsMedian: 128.8,
  citywideTotal: 2_219_913_961.84,
  share: 0.29,
  foundationDollars: 639_863_730,
  foundationShare: 0.993,
};

describe("EquityContext — Q4 rank disclosure", () => {
  it("carries the consult's exact disclosure sentence, with figures read from equity fields", () => {
    const html = renderToStaticMarkup(
      <EquityContext communityArea="Loop" totalAwarded={644_194_363.97} equity={baseEquity} />,
    );
    expect(html).toContain(
      "This ranks recipient-location concentrations, not neighborhood impact: a point may be a grantee headquarters or administrative address rather than the funded site",
    );
    expect(html).toContain("in Loop, foundation rows account for");
    expect(html).toContain("$639,863,730");
    expect(html).toContain("$644,194,364"); // formatFullDollars rounds .97 up
    expect(html).toContain("99.3%");
  });

  it("omits the foundation-share clause (with a plain period) when this community has zero foundation dollars", () => {
    const html = renderToStaticMarkup(
      <EquityContext
        communityArea="Beta"
        totalAwarded={500_000}
        equity={{ ...baseEquity, rank: 40, foundationDollars: 0, foundationShare: 0 }}
      />,
    );
    expect(html).toContain(
      "a point may be a grantee headquarters or administrative address rather than the funded site.",
    );
    expect(html).not.toContain("foundation rows account for");
  });

  it("never hand-types the disclosure's dollar figures — a different community's numbers render differently", () => {
    const htmlLoop = renderToStaticMarkup(
      <EquityContext communityArea="Loop" totalAwarded={644_194_363.97} equity={baseEquity} />,
    );
    const htmlOther = renderToStaticMarkup(
      <EquityContext
        communityArea="Near West Side"
        totalAwarded={100_000_000}
        equity={{ ...baseEquity, rank: 2, foundationDollars: 93_200_000, foundationShare: 0.932 }}
      />,
    );
    expect(htmlLoop).not.toEqual(htmlOther);
    expect(htmlOther).toContain("in Near West Side, foundation rows account for");
    expect(htmlOther).toContain("93.2%");
  });
});
