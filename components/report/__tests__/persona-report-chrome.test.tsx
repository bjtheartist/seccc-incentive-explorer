// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PersonaAlsoAtAddress } from "@/components/report/PersonaReportChrome";
import type { ReportItem } from "@/lib/report-engine";

afterEach(cleanup);

describe("PersonaAlsoAtAddress", () => {
  const collapsedItems: ReportItem[] = [
    {
      label: "SBIF Facade Grant",
      value: "Review published terms",
      programId: "sbif",
      detail: "Funds permanent building improvements.",
      matchExplanation: {
        whyItAppears: ["Mapped SBIF district"],
        knownFromPublicData: [],
        basedOnUserAnswers: [],
        stillToConfirm: [],
        currentDocumentsToGather: [],
        confirmWith: [],
      },
    },
    {
      label: "Enterprise Zones",
      value: "Review published terms",
      programId: "enterprise-zones",
      detail: "Offers state and local incentives in designated zones.",
      matchExplanation: {
        whyItAppears: ["Mapped enterprise zone"],
        knownFromPublicData: [],
        basedOnUserAnswers: [],
        stillToConfirm: [],
        currentDocumentsToGather: [],
        confirmWith: [],
      },
    },
  ];

  it("opens the address disclosure, then expands and closes each full program record independently", () => {
    render(<PersonaAlsoAtAddress items={collapsedItems} />);

    const disclosure = screen.getByTestId("persona-also-at-address") as HTMLDetailsElement;
    const summary = within(disclosure).getByText("Also at this address (2)");
    expect(disclosure.tagName).toBe("DETAILS");
    expect(disclosure.open).toBe(false);

    fireEvent.click(summary);
    expect(disclosure.open).toBe(true);
    const programMenus = screen.getAllByTestId("persona-also-program") as HTMLDetailsElement[];
    expect(programMenus).toHaveLength(2);
    expect(programMenus.every((menu) => menu.open === false)).toBe(true);

    fireEvent.click(within(programMenus[0]).getByText("SBIF Facade Grant"));
    expect(programMenus[0].open).toBe(true);
    expect(programMenus[1].open).toBe(false);
    expect(within(programMenus[0]).getByText("Funds permanent building improvements.")).toBeTruthy();
    expect(within(programMenus[0]).getByText("Mapped SBIF district")).toBeTruthy();

    fireEvent.click(within(programMenus[1]).getByText("Enterprise Zones"));
    expect(programMenus[0].open).toBe(true);
    expect(programMenus[1].open).toBe(true);
    expect(
      within(programMenus[1]).getByText("Offers state and local incentives in designated zones."),
    ).toBeTruthy();

    fireEvent.click(within(programMenus[0]).getByText("SBIF Facade Grant"));
    expect(programMenus[0].open).toBe(false);
    expect(programMenus[1].open).toBe(true);

    fireEvent.click(summary);
    expect(disclosure.open).toBe(false);
  });
});
