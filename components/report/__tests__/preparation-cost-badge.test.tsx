import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PreparationCostBadge,
  parseDocumentCostLine,
} from "@/components/report/PreparationCostBadge";

describe("report preparation cost signals", () => {
  it("parses document-level cost markers without consuming program attribution", () => {
    expect(parseDocumentCostLine("Phase I environmental assessment [$$$] — TIF, NOF")).toEqual({
      documentName: "Phase I environmental assessment",
      programs: "TIF, NOF",
      cost: {
        tier: "$$$",
        basis: "Often requires specialized professional work.",
      },
    });
  });

  it("renders an accessible qualitative marker", () => {
    const html = renderToStaticMarkup(
      <PreparationCostBadge
        signal={{ tier: "$$", basis: "May involve filing fees or professional help." }}
      />,
    );
    expect(html).toContain("Preparation cost $$");
    expect(html).toContain("May involve filing fees or professional help");
  });
});
