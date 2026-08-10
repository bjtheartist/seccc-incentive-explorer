import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FunderFlowTable } from "@/components/investment/FunderFlowTable";
import type { FlowRow } from "@/lib/investment-analysis";

/**
 * The flow table's purpose filter must only offer purposes that can actually
 * match a row. buildFlowRows keeps records with a positive awarded amount, and
 * every `programmatic` / `unclassified` government record in the published export
 * is a null-amount capital class (NMTC tax credits, CDBG/HOME allocations, state
 * relief). A hardcoded option for those rendered a filter that returned an empty
 * table in every community — reading as a contradiction of the non-zero purpose
 * counts in the "Government funding by purpose" section directly above it.
 */

const row = (over: Partial<FlowRow> & Pick<FlowRow, "id">): FlowRow => ({
  funderName: "City of Chicago",
  funderType: "government",
  source: "cdg",
  governmentFundingPurpose: "capital_project",
  recipient: "Main St LLC",
  year: 2022,
  amountAwarded: 250_000,
  ...over,
});

describe("FunderFlowTable — purpose filter offers only reachable options", () => {
  it("omits purposes that no row carries", () => {
    const html = renderToStaticMarkup(
      <FunderFlowTable rows={[row({ id: "r1" })]} total={250_000} />,
    );

    expect(html).toContain('value="capital_project"');
    expect(html).not.toContain('value="programmatic"');
    expect(html).not.toContain('value="unclassified"');
  });

  it("offers a purpose as soon as a dollar-valued row carries it", () => {
    const html = renderToStaticMarkup(
      <FunderFlowTable
        rows={[
          row({ id: "r1" }),
          row({ id: "r2", governmentFundingPurpose: "unclassified", amountAwarded: 90_000 }),
        ]}
        total={340_000}
      />,
    );

    expect(html).toContain('value="unclassified"');
    expect(html).toContain("Not classified from source");
  });

  it("drops the whole control when no row carries a government purpose", () => {
    const html = renderToStaticMarkup(
      <FunderFlowTable
        rows={[
          row({
            id: "r1",
            funderName: "Pritzker Traubert Foundation",
            funderType: "philanthropic",
            source: "foundation",
            governmentFundingPurpose: null,
            recipient: "Neighborhood Group",
            amountAwarded: 5_000_000,
          }),
        ]}
        total={5_000_000}
      />,
    );

    expect(html).not.toContain("Government funding purpose");
    expect(html).toContain("Not government");
  });
});
