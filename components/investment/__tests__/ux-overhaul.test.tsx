import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusCards } from "@/components/investment/StatusCards";
import { FunderTypeBars } from "@/components/investment/FunderTypeBars";
import { FunderFlowTable } from "@/components/investment/FunderFlowTable";
import type { FunderTypeBreakdown, FlowRow } from "@/lib/investment-analysis";

/**
 * Semantic guard for the UX-overhaul surfaces (Sol #2–#4). Asserts the load-bearing
 * contract — the three-status grammar, the "never $0" empty disbursement slot, the
 * non-grant capital-class row, sorted funder-type bars with $ + %, and the
 * searchable flow table — plus the iron-rule language ("Awarded" only; never
 * received/available/remaining/unspent). Not the private SVG/markup geometry.
 */

const FORBIDDEN = /\b(received|available|remaining|unspent)\b/i;

const byFunderType: FunderTypeBreakdown[] = [
  { funderType: "government", awardedDollars: 900_000_000, count: 40, share: 0.9 },
  { funderType: "philanthropic", awardedDollars: 90_000_000, count: 12, share: 0.09 },
  { funderType: "private_development", awardedDollars: 0, count: 3, share: 0 },
];

const flowRows: FlowRow[] = [
  { id: "r1", funderName: "Pritzker Traubert Foundation", funderType: "philanthropic", source: "foundation", recipient: "Neighborhood Group", year: 2023, amountAwarded: 5_000_000 },
  { id: "r2", funderName: "City of Chicago", funderType: "government", source: "cdg", recipient: "Main St LLC", year: 2022, amountAwarded: 250_000 },
];

describe("StatusCards — three-status grammar", () => {
  const html = renderToStaticMarkup(
    <StatusCards
      awarded={1_787_353_617}
      announced={74_900_000_000}
      capital={{ authorizedTif: 6_600_000_000, federalProgram: 1_640_000_000, creditCapital: 1_870_000_000 }}
      asOf="2026-07-28T10:00:00.000Z"
      coverageHref="#methodology"
      animate={false}
    />,
  );

  it("shows all three non-additive status cards", () => {
    expect(html).toContain("Known awarded dollars captured since 2020");
    expect(html).toContain("Announced private capital");
    expect(html).toContain("Reported disbursements");
  });

  it("renders the empty disbursement slot as text, never $0", () => {
    expect(html).toContain("Not yet reported by any source");
    expect(html).not.toContain("$0");
  });

  it("carries the non-grant capital-class row under its own nouns", () => {
    expect(html).toContain("TIF authorized");
    expect(html).toContain("Federal program (CDBG/HOME)");
    expect(html).toContain("Tax-credit capital (LIHTC/NMTC)");
  });

  it("renders the awarded figure and an as-of / coverage line, no banned language", () => {
    expect(html).toContain("$1,787,353,617");
    expect(html).toContain("Coverage &amp; methodology");
    expect(html).not.toMatch(FORBIDDEN);
  });
});

describe("FunderTypeBars — sorted bars with $ and %", () => {
  const html = renderToStaticMarkup(<FunderTypeBars byFunderType={byFunderType} />);

  it("lists dollar-valued funder types with exact dollars and share", () => {
    expect(html).toContain("Government");
    expect(html).toContain("$900,000,000");
    expect(html).toContain("90%");
    expect(html).toContain("#2563EB"); // government identity hue
  });

  it("surfaces a zero-dollar funder type as a count-only row (not a bar)", () => {
    expect(html).toContain("Private development");
    expect(html).toContain("dollar amounts not disclosed");
    expect(html).not.toMatch(FORBIDDEN);
  });
});

describe("FunderFlowTable — searchable default flow view", () => {
  const html = renderToStaticMarkup(<FunderFlowTable rows={flowRows} total={5_250_000} />);

  it("renders a searchable funder → program → recipient table", () => {
    expect(html).toContain("Search funder, program, or recipient");
    expect(html).toContain("Pritzker Traubert Foundation");
    expect(html).toContain("Neighborhood Group");
    expect(html).toContain("$5,000,000");
    expect(html).not.toMatch(FORBIDDEN);
  });
});
