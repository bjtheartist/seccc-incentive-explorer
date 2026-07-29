import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CountyReliefRecipientsPanel from "../CountyReliefRecipientsPanel";

const baseProps = {
  zipCode: "60617",
  recipients: [],
  sourceLink: null,
  onClose: () => {},
  onRetry: () => {},
};

describe("CountyReliefRecipientsPanel", () => {
  it("renders historical recipients without implying current funding", () => {
    const html = renderToStaticMarkup(
      <CountyReliefRecipientsPanel
        {...baseProps}
        status="ready"
        sourceLink="https://example.gov/awardees.pdf"
        recipients={[
          {
            id: "cook-1",
            businessName: "South Shore Bakery",
            historicalAwardAmount: 10_000,
          },
          {
            id: "cook-2",
            businessName: "East Side Fabrication",
            historicalAwardAmount: 20_000,
          },
        ]}
      />,
    );

    expect(html).toContain("Recipients in 60617");
    expect(html).toContain("South Shore Bakery");
    expect(html).toContain("East Side Fabrication");
    expect(html).toContain("Historical award");
    expect(html).toContain("$10,000");
    expect(html).toContain("program is complete");
    expect(html).toContain("not a current funding opportunity");
    expect(html).toContain("No street address is inferred");
    expect(html).not.toContain("possible incentive");
    expect(html).not.toContain("available funding");
  });

  it("renders distinct loading, unauthorized, error, and empty states", () => {
    const loading = renderToStaticMarkup(
      <CountyReliefRecipientsPanel {...baseProps} status="loading" />,
    );
    const unauthorized = renderToStaticMarkup(
      <CountyReliefRecipientsPanel {...baseProps} status="unauthorized" />,
    );
    const error = renderToStaticMarkup(
      <CountyReliefRecipientsPanel {...baseProps} status="error" />,
    );
    const empty = renderToStaticMarkup(
      <CountyReliefRecipientsPanel {...baseProps} status="ready" />,
    );

    expect(loading).toContain("Loading recipient records");
    expect(unauthorized).toContain("Admin session expired");
    expect(error).toContain("Recipient records unavailable");
    expect(empty).toContain("No recipient records found");
  });

  it("does not render an unsafe source link", () => {
    const html = renderToStaticMarkup(
      <CountyReliefRecipientsPanel
        {...baseProps}
        status="ready"
        sourceLink="javascript:alert(1)"
      />,
    );

    expect(html).not.toContain("<a ");
  });
});
