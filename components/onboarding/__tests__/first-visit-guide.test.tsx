import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FirstVisitGuideDialog } from "@/components/onboarding/FirstVisitGuide";

const actions = {
  onStart: () => {},
  onSpotlight: () => {},
  onSkip: () => {},
  onBack: () => {},
  onNext: () => {},
  onClose: () => {},
  onUseAddress: () => {},
  onTrySample: () => {},
};

function render(screen: "welcome" | "tour", step = 0) {
  return renderToStaticMarkup(
    <FirstVisitGuideDialog screen={screen} step={step} {...actions} />,
  );
}

describe("FirstVisitGuideDialog", () => {
  it("makes the welcome optional and states the privacy boundary", () => {
    const html = render("welcome");

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Find what may apply to a Chicago address");
    expect(html).toContain("Show me around");
    expect(html).toContain("Explore on my own");
    expect(html).toContain("does not ask for an email");
    expect(html).toContain("Close site tour");
  });

  it("offers exactly one primary path with the static preview demoted", () => {
    const html = render("welcome");

    // The spotlight is the only filled CTA; the in-modal slideshow survives
    // as an inline fallback link rather than a competing equal choice.
    expect(html.match(/bg-\[#0C1B33\]/g)?.length).toBe(1);
    expect(html).toContain("Preview the four steps here instead");
    expect(html).not.toContain("Preview the workflow");
    expect(html).toContain("About 90 seconds");
  });

  it("demonstrates the address and project-goal screens", () => {
    const address = render("tour", 0);
    const goal = render("tour", 1);

    expect(address).toContain("Enter a Chicago address");
    expect(address).toContain("8701 S Bennett Ave");
    expect(address).toContain('data-testid="guide-address-preview"');
    expect(goal).toContain("Tell us what you are trying to do");
    expect(goal).toContain("Buy equipment");
    expect(goal).toContain('data-testid="guide-goal-preview"');
  });

  it("states that findings are leads rather than approvals or determinations", () => {
    const html = render("tour", 2);

    expect(html).toContain("See what the location may support");
    expect(html).toContain("source notes and verification links");
    expect(html).toContain("not an award, approval, or zoning determination");
  });

  it("finishes with an actionable sample and own-address choice", () => {
    const html = render("tour", 3);

    expect(html).toContain("Leave with clear next steps");
    expect(html).toContain("Verify");
    expect(html).toContain("Prepare");
    expect(html).toContain("Connect");
    expect(html).toContain("Try sample report");
    expect(html).toContain("Use my address");
    expect(html).not.toContain(">Next<");
  });
});
