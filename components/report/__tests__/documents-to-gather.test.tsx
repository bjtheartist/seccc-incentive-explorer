// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DocumentsToGather } from "@/components/report/DocumentsToGather";
import {
  CONFIRMED_PROGRAMS_SECTION_ID,
  type GeneratedReport,
} from "@/lib/report-engine";

afterEach(cleanup);

describe("DocumentsToGather", () => {
  it("shows why each document appears and names the surfaced program that published it", () => {
    const report = {
      title: "Location report",
      subtitle: "",
      reportType: "site-incentives",
      generatedAt: "2026-08-23T00:00:00.000Z",
      summary: "",
      sections: [
        {
          id: CONFIRMED_PROGRAMS_SECTION_ID,
          title: "Programs for your goal",
          description: "",
          items: [
            {
              label: "SBIF Facade Grant",
              value: "",
              programId: "sbif",
              matchExplanation: {
                whyItAppears: ["Mapped SBIF district"],
                knownFromPublicData: [],
                basedOnUserAnswers: [],
                stillToConfirm: [],
                currentDocumentsToGather: ["Two contractor bids"],
                confirmWith: [],
              },
            },
          ],
        },
      ],
      recommendedActions: [],
      metadata: { address: "100 E Test St" },
    } as GeneratedReport;

    render(<DocumentsToGather report={report} sectionNumber="07" />);

    expect(screen.getByText("Two contractor bids")).toBeTruthy();
    const connection = screen.getByTestId("document-program-connection");
    expect(within(connection).getByText("Why this is here")).toBeTruthy();
    expect(within(connection).getByText("SBIF Facade Grant")).toBeTruthy();
    expect(within(connection).getByText(/published program record/i)).toBeTruthy();
  });
});
