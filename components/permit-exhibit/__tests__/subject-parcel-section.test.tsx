// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { PERMIT_EXHIBIT_COST_LABEL, PERMIT_EXHIBIT_PROXIMITY_SUBSECTION_TITLE } from "@/lib/permit-exhibit";
import {
  FIXTURE_PERMIT_EXHIBIT_MIXED,
  fixturePermitExhibitEmptySubject,
  fixturePermitExhibitProximityOnly,
} from "@/lib/permit-exhibit-fixtures";
import { SubjectParcelSection } from "../SubjectParcelSection";

/**
 * S1 pinning tests. The one hard rule this section exists to enforce: a
 * `proximity` row must NEVER present as a parcel match — it renders ONLY
 * inside the "Nearby, not matched to this parcel" subsection, never in the
 * main pin_parcel/address_exact table.
 */
afterEach(() => {
  cleanup();
});

describe("SubjectParcelSection — S1", () => {
  it("renders pin_parcel and address_exact rows in the main table, chronologically", () => {
    render(<SubjectParcelSection subject={FIXTURE_PERMIT_EXHIBIT_MIXED.subject} />);
    const mainTable = screen.getByText("Every permit linked to this parcel").closest("section")!;
    const rows = within(mainTable).getAllByRole("row").slice(1); // drop header row
    // Mixed fixture: 3 non-proximity rows (pin_parcel x2, address_exact x1),
    // oldest first — 100234567 (2011) before 100561234 (2016) before
    // 100987654 (2022).
    const permitCells = rows
      .filter((row) => !row.closest('[data-testid="proximity-subsection"]'))
      .map((row) => within(row).queryByText(/^\d{9}$/)?.textContent)
      .filter(Boolean);
    expect(permitCells).toEqual(["100234567", "100561234", "100987654"]);
  });

  it("NEVER shows a proximity row's permit number in the main table — only inside the proximity subsection", () => {
    render(<SubjectParcelSection subject={FIXTURE_PERMIT_EXHIBIT_MIXED.subject} />);
    const proximitySection = screen.getByTestId("proximity-subsection");
    // The proximity row (100345678, matchMethod "proximity") must appear
    // inside the proximity subsection...
    expect(within(proximitySection).getByText("100345678")).toBeTruthy();
    // ...and every occurrence of that permit number on the page must be
    // inside the proximity subsection — none in the main table.
    const allOccurrences = screen.getAllByText("100345678");
    for (const node of allOccurrences) {
      expect(node.closest('[data-testid="proximity-subsection"]')).not.toBeNull();
    }
  });

  it("titles the proximity subsection with the spine's exact verbatim copy", () => {
    render(<SubjectParcelSection subject={FIXTURE_PERMIT_EXHIBIT_MIXED.subject} />);
    expect(screen.getByText(PERMIT_EXHIBIT_PROXIMITY_SUBSECTION_TITLE)).toBeTruthy();
  });

  it("labels the cost column with the exact pinned label", () => {
    render(<SubjectParcelSection subject={FIXTURE_PERMIT_EXHIBIT_MIXED.subject} />);
    expect(screen.getAllByText(PERMIT_EXHIBIT_COST_LABEL).length).toBeGreaterThan(0);
  });

  it("renders an honest zero state (never a false unavailable message) for an empty subject", () => {
    render(<SubjectParcelSection subject={fixturePermitExhibitEmptySubject().subject} />);
    expect(screen.getByText(/No permits matched this parcel/)).toBeTruthy();
  });

  it("renders ONLY the proximity subsection (no main table) when every subject row is proximity", () => {
    render(<SubjectParcelSection subject={fixturePermitExhibitProximityOnly().subject} />);
    expect(screen.getByText(/No permits matched this parcel/)).toBeTruthy();
    expect(screen.getByTestId("proximity-subsection")).toBeTruthy();
    expect(screen.getAllByText(/^100\d{6}$/).length).toBe(3);
  });

  it("never renders a summed or averaged cost figure — only per-row values under the pinned label", () => {
    const subject = FIXTURE_PERMIT_EXHIBIT_MIXED.subject;
    const sum = subject.reduce((total, row) => total + (row.estimatedCostSelfReported ?? 0), 0);
    const { container } = render(<SubjectParcelSection subject={subject} />);
    const sumString = `$${sum.toLocaleString("en-US")}`;
    expect(container.textContent).not.toContain(sumString);
    expect(container.textContent).not.toMatch(/total.{0,20}\$/i);
    expect(container.textContent).not.toMatch(/average.{0,20}\$/i);
  });
});
