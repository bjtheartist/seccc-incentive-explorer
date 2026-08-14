import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SurveyResults } from "../SurveyResults";
import type { SurveyResult } from "@/lib/types";

const results: SurveyResult = {
  matches: [
    {
      programId: "sample",
      program: {
        name: "Sample Improvement Program",
        short: "Sample",
        level: "City",
      },
      status: { intakeStatus: "open", label: "Open" },
      explanation: {
        whyItAppears: ["Your project details overlap with the published program focus."],
        knownFromPublicData: ["Program information was last reviewed on 2026-07-10."],
        basedOnUserAnswers: ["Building renovations"],
        stillToConfirm: ["Program location and boundary requirements"],
        currentDocumentsToGather: ["Project plan"],
        confirmWith: [
          {
            agency: "Department of Example Programs",
            role: "Program administrator",
            phone: "(312) 555-0100",
          },
        ],
        officialSource: {
          label: "Official Sample Improvement Program source",
          url: "https://example.gov/program",
        },
        lastVerifiedAt: "2026-07-10",
      },
    },
  ],
  universal: [],
  usedAnswers: ["activities:renovations"],
  unusedAnswers: [],
};

describe("survey results transparency", () => {
  const html = renderToStaticMarkup(
    <SurveyResults results={results} onRetake={vi.fn()} />,
  );

  it("renders the conservative explanation and handoff fields", () => {
    expect(html).toContain("Why it appears");
    expect(html).toContain("Known from public data");
    expect(html).toContain("Based on your answers");
    expect(html).toContain("Still to confirm");
    expect(html).toContain("Documents to gather");
    expect(html).toContain("Confirm with");
    expect(html).toContain("Department of Example Programs");
    expect(html).toContain("https://example.gov/program");
  });

  it("shows one unranked review list without qualification claims or scores", () => {
    expect(html).toContain('data-testid="survey-program-review-list"');
    expect(html).not.toMatch(/pre-qualif|you may qualify|\beligible\b|high match|medium match/i);
    expect(html).not.toMatch(/confidence|score ring|of 17/i);
    expect(html).not.toContain("stroke-dasharray");
  });
});
