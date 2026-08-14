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
  { id: "r1", funderName: "Pritzker Traubert Foundation", funderType: "philanthropic", source: "foundation", governmentFundingPurpose: null, recipient: "Neighborhood Group", year: 2023, amountAwarded: 5_000_000 },
  { id: "r2", funderName: "City of Chicago", funderType: "government", source: "cdg", governmentFundingPurpose: "capital_project", recipient: "Main St LLC", year: 2022, amountAwarded: 250_000 },
];

describe("StatusCards — three-status grammar", () => {
  const capital = {
    authorizedTif: 6_600_000_000,
    federalProgram: 1_640_000_000,
    creditCapital: 1_870_000_000,
    publishedStateAppropriation: 715_300_000,
  };

  const html = renderToStaticMarkup(
    <StatusCards
      awarded={1_787_353_617}
      announced={74_900_000_000}
      capital={capital}
      asOf="2026-07-28T10:00:00.000Z"
      coverageHref="#methodology"
      animate={false}
      disbursement={{ scope: "not-applicable" }}
    />,
  );

  it("shows all three non-additive status cards", () => {
    expect(html).toContain("Known awarded dollars captured since 2020");
    expect(html).toContain("Announced private capital");
    expect(html).toContain("Reported disbursements");
  });

  it("renders the not-applicable-scope disbursement slot as text, never $0", () => {
    expect(html).toContain("Not shown on this page");
    expect(html).not.toContain("$0");
  });

  it("carries the non-grant capital-class row under its own nouns, including the fifth class (consult F8)", () => {
    expect(html).toContain("TIF authorized");
    expect(html).toContain("Federal program (CDBG/HOME)");
    expect(html).toContain("Tax-credit capital (LIHTC/NMTC)");
    expect(html).toContain("State appropriation");
  });

  it("renders the awarded figure and an as-of / coverage line, no banned language", () => {
    expect(html).toContain("$1,787,353,617");
    expect(html).toContain("Coverage &amp; methodology");
    expect(html).not.toMatch(FORBIDDEN);
  });
});

describe("StatusCards — citywide disbursement scope (audit finding 6 / consult F5)", () => {
  const html = renderToStaticMarkup(
    <StatusCards
      awarded={2_219_913_961.84}
      announced={74_900_000_000}
      capital={{
        authorizedTif: 6_435_096_232.67,
        federalProgram: 1_526_489_712.89,
        creditCapital: 1_874_379_288.43,
        publishedStateAppropriation: 715_314_337.33,
      }}
      asOf="2026-08-12T10:00:00.000Z"
      coverageHref="#coverage"
      animate={false}
      disbursement={{ scope: "citywide", totalRecoveryDisbursed: 923_413_575.69 }}
    />,
  );

  it("renders the consult's exact F5 sentence, with the dollar figure read from the live total", () => {
    expect(html).toContain(
      "Closed recovery-program files report $923.4M disbursed; ordinary award, foundation, TIF, HUD, tax-credit, and appropriation sources do not report recipient receipts.",
    );
    expect(html).toContain("$923,413,576"); // formatFullDollars rounds .69 up
  });

  it("never shows the citywide-only placeholder when the figure IS shown", () => {
    expect(html).not.toContain("Not shown on this page");
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
    expect(html).toContain("Government funding purpose");
    expect(html).toContain("Capital projects");
    expect(html).toContain("Not government");
    expect(html).toContain("$5,000,000");
    expect(html).not.toMatch(FORBIDDEN);
  });
});
