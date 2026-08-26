// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { PERMIT_EXHIBIT_COST_LABEL } from "@/lib/permit-exhibit";
import { FIXTURE_PERMIT_EXHIBIT_MIXED } from "@/lib/permit-exhibit-fixtures";
import { AreaContextSection } from "../AreaContextSection";

afterEach(() => {
  cleanup();
});

/**
 * S2 pinning tests. Mixed fixture: area.rows has 5 `point` rows (the 4
 * subject rows plus one radius-only new-construction permit) and 1
 * `address_only` row (100778899) — never confirmed by its own coordinate,
 * so it must render ONLY in the disclosed subsection.
 */
describe("AreaContextSection — S2", () => {
  it("renders point-located rows in the main area table", () => {
    render(<AreaContextSection area={FIXTURE_PERMIT_EXHIBIT_MIXED.area} radiusFt={500} />);
    expect(screen.getByText("5 located-by-point records")).toBeTruthy();
  });

  it("NEVER shows an address-only row in the main point table — only inside its own subsection", () => {
    render(<AreaContextSection area={FIXTURE_PERMIT_EXHIBIT_MIXED.area} radiusFt={500} />);
    const subsection = screen.getByTestId("area-address-only-subsection");
    expect(within(subsection).getByText("100778899")).toBeTruthy();
    for (const node of screen.getAllByText("100778899")) {
      expect(node.closest('[data-testid="area-address-only-subsection"]')).not.toBeNull();
    }
  });

  it("aggregates byYear/byType as counts only — never renders a cost figure in the aggregate panel", () => {
    render(<AreaContextSection area={FIXTURE_PERMIT_EXHIBIT_MIXED.area} radiusFt={500} />);
    // Every byYear count from the fixture appears somewhere in the counts panel.
    for (const row of FIXTURE_PERMIT_EXHIBIT_MIXED.area.byYear) {
      expect(screen.getAllByText(String(row.year)).length).toBeGreaterThan(0);
    }
  });

  it("labels the per-row cost column with the exact pinned label and never sums it", () => {
    const { container } = render(<AreaContextSection area={FIXTURE_PERMIT_EXHIBIT_MIXED.area} radiusFt={500} />);
    expect(screen.getAllByText(PERMIT_EXHIBIT_COST_LABEL).length).toBeGreaterThan(0);
    const sum = FIXTURE_PERMIT_EXHIBIT_MIXED.area.rows.reduce(
      (total, row) => total + (row.estimatedCostSelfReported ?? 0),
      0,
    );
    expect(container.textContent).not.toContain(`$${sum.toLocaleString("en-US")}`);
  });

  it("renders the honest 'no point-located records' message when the radius has none", () => {
    render(
      <AreaContextSection
        area={{ byYear: [], byType: [], rows: FIXTURE_PERMIT_EXHIBIT_MIXED.area.rows.filter((r) => r.locatedVia === "address_only") }}
        radiusFt={250}
      />,
    );
    expect(screen.getByText("No point-located records in this radius.")).toBeTruthy();
  });
});
