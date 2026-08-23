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
  ];

  it("is a real one-gesture disclosure that opens and closes the collapsed program record", () => {
    render(<PersonaAlsoAtAddress items={collapsedItems} />);

    const disclosure = screen.getByTestId("persona-also-at-address") as HTMLDetailsElement;
    const summary = within(disclosure).getByText("Also at this address (1)");
    expect(disclosure.tagName).toBe("DETAILS");
    expect(disclosure.open).toBe(false);

    fireEvent.click(summary);
    expect(disclosure.open).toBe(true);
    expect(within(disclosure).getByText("SBIF Facade Grant")).toBeTruthy();
    expect(within(disclosure).getByText("Funds permanent building improvements.")).toBeTruthy();
    expect(within(disclosure).getByText("Mapped SBIF district")).toBeTruthy();

    fireEvent.click(summary);
    expect(disclosure.open).toBe(false);
  });
});
