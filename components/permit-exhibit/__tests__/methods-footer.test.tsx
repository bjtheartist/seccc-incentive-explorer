// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PERMIT_EXHIBIT_LIMITS } from "@/lib/permit-exhibit";
import { FIXTURE_PERMIT_EXHIBIT_MIXED, fixturePermitExhibitHighUnlocated } from "@/lib/permit-exhibit-fixtures";
import { MethodsFooter } from "../MethodsFooter";

afterEach(() => {
  cleanup();
});

/**
 * S4 pinning tests — non-suppressible methods & limits footer: snapshot
 * date, source dataset, query params printed verbatim, match-method +
 * unlocated coverage arithmetic, the exact 3-item limits block, and the
 * reproducible exhibit-id footer sentence.
 */
describe("MethodsFooter — S4", () => {
  it("renders the snapshot date, source dataset link, and query params verbatim", () => {
    render(<MethodsFooter meta={FIXTURE_PERMIT_EXHIBIT_MIXED.meta} coverage={FIXTURE_PERMIT_EXHIBIT_MIXED.coverage} />);
    expect(screen.getByRole("link", { name: FIXTURE_PERMIT_EXHIBIT_MIXED.meta.sourceLabel })).toBeTruthy();
    const queryLine = screen.getByTestId("query-params-line");
    expect(queryLine.textContent).toContain(FIXTURE_PERMIT_EXHIBIT_MIXED.meta.queryParams.pinFormatted);
    expect(queryLine.textContent).toContain(String(FIXTURE_PERMIT_EXHIBIT_MIXED.meta.queryParams.radiusFt));
  });

  it("renders the match-method breakdown counts computed from the subject rows", () => {
    render(<MethodsFooter meta={FIXTURE_PERMIT_EXHIBIT_MIXED.meta} coverage={FIXTURE_PERMIT_EXHIBIT_MIXED.coverage} />);
    const breakdown = screen.getByTestId("match-method-breakdown");
    expect(breakdown.textContent).toContain(String(FIXTURE_PERMIT_EXHIBIT_MIXED.coverage.matchMethodBreakdown.pinParcel));
    expect(breakdown.textContent).toContain(String(FIXTURE_PERMIT_EXHIBIT_MIXED.coverage.matchMethodBreakdown.addressExact));
    expect(breakdown.textContent).toContain(String(FIXTURE_PERMIT_EXHIBIT_MIXED.coverage.matchMethodBreakdown.proximity));
  });

  it("renders the unlocated count and never collapses it to zero when the coverage says otherwise", () => {
    const highUnlocated = fixturePermitExhibitHighUnlocated();
    render(<MethodsFooter meta={highUnlocated.meta} coverage={highUnlocated.coverage} />);
    const unlocated = screen.getByTestId("unlocated-count");
    expect(unlocated.textContent).toBe(highUnlocated.coverage.area.unlocatedCount.toLocaleString("en-US"));
    expect(highUnlocated.coverage.area.unlocatedCount).toBeGreaterThan(0);
  });

  it("renders exactly the spec's 3-item limits block, verbatim, from the spine", () => {
    render(<MethodsFooter meta={FIXTURE_PERMIT_EXHIBIT_MIXED.meta} coverage={FIXTURE_PERMIT_EXHIBIT_MIXED.coverage} />);
    expect(PERMIT_EXHIBIT_LIMITS.length).toBe(3);
    for (const limit of PERMIT_EXHIBIT_LIMITS) {
      expect(screen.getByText(limit)).toBeTruthy();
    }
  });

  it("renders the reproducible exhibit-id footer sentence with its vintage semantics", () => {
    render(<MethodsFooter meta={FIXTURE_PERMIT_EXHIBIT_MIXED.meta} coverage={FIXTURE_PERMIT_EXHIBIT_MIXED.coverage} />);
    expect(screen.getByText(FIXTURE_PERMIT_EXHIBIT_MIXED.meta.exhibitIdFooter)).toBeTruthy();
    expect(FIXTURE_PERMIT_EXHIBIT_MIXED.meta.exhibitIdFooter).toContain(FIXTURE_PERMIT_EXHIBIT_MIXED.meta.exhibitId);
  });

  it("never renders a summed coverage cost figure — coverage is counts only", () => {
    const { container } = render(
      <MethodsFooter meta={FIXTURE_PERMIT_EXHIBIT_MIXED.meta} coverage={FIXTURE_PERMIT_EXHIBIT_MIXED.coverage} />,
    );
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});
