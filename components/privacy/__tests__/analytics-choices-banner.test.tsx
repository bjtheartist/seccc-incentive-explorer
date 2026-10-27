import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnalyticsChoicesBannerView } from "@/components/privacy/AnalyticsChoicesBanner";

const noop = () => {};

function render(current: "on" | "off" | null, gpc = false) {
  return renderToStaticMarkup(
    <AnalyticsChoicesBannerView
      current={current}
      gpc={gpc}
      onAccept={noop}
      onDecline={noop}
      onClose={noop}
    />,
  );
}

describe("AnalyticsChoicesBannerView", () => {
  it("first visit: explains the cookies, links the policy, and offers both choices", () => {
    const html = render(null);
    expect(html).toContain('aria-label="Cookie and analytics choices"');
    expect(html).toContain("We never sell your information.");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain("Turn off analytics");
    expect(html).toContain(">OK<");
  });

  it("reopened after opting out: says analytics is off and offers to turn it back on", () => {
    const html = render("off");
    expect(html).toContain("Analytics is currently off.");
    expect(html).toContain("Turn analytics on");
  });

  it("with Global Privacy Control: states analytics is off and offers no way to turn it on", () => {
    const html = render(null, true);
    expect(html).toContain("Global Privacy Control signal is on");
    expect(html).not.toContain("Turn analytics on");
    expect(html).not.toContain(">OK<");
    expect(html).toContain(">Close<");
  });
});
