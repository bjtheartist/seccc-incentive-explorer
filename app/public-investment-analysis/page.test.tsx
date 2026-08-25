import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PublicInvestmentAnalysisBetaPage from "./page";

describe("Public Investment Analysis beta page", () => {
  const html = renderToStaticMarkup(<PublicInvestmentAnalysisBetaPage />);

  it("states the beta status and early-access invitation explicitly", () => {
    expect(html).toContain("Public Investment Analysis is a beta feature currently being tested.");
    expect(html).toContain("sign up for early access");
  });

  it("collects identity, organization, use case, and email for review", () => {
    expect(html).toContain('name="name"');
    expect(html).toContain('name="title"');
    expect(html).toContain('name="organization"');
    expect(html).toContain('name="useCase"');
    expect(html).toContain('name="email"');
  });

  it("keeps approved-user passwordless sign-in distinct from the public request", () => {
    expect(html).toContain("Already approved?");
  });

  it("names public dollars, philanthropic dollars, and visual analysis", () => {
    expect(html).toContain("Public dollars");
    expect(html).toContain("Philanthropic dollars");
    expect(html).toContain("Visual analysis");
  });
});
