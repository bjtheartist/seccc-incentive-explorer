import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ExecutiveSummarySection,
  MatchExplanationDetails,
  VerdictCard,
} from "@/components/report/ExecutiveSummarySection";
import type { ExecutiveSummary, PublicMatchExplanation } from "@/lib/types";

describe("VerdictCard", () => {
  it("renders headline, subheadline, and reasons", () => {
    const html = renderToStaticMarkup(
      <VerdictCard
        verdict={{
          headline: "Strong incentive coverage",
          subheadline: "This address sits in several zones.",
          topReasons: ["Inside SSA #5", "Inside a TIF district"],
        }}
      />,
    );
    expect(html).toContain("Location findings");
    expect(html).toContain("Strong incentive coverage");
    expect(html).toContain("Inside SSA #5");
    expect(html).toContain("Inside a TIF district");
  });
});

describe("MatchExplanationDetails", () => {
  const explanation: PublicMatchExplanation = {
    whyItAppears: ["Address is inside the SSA #5 boundary"],
    knownFromPublicData: ["Zone membership from city GIS"],
    basedOnUserAnswers: [],
    stillToConfirm: ["Storefront-facing frontage"],
    currentDocumentsToGather: ["Photo of the facade"],
    confirmWith: [
      {
        agency: "SSA #5 Commission",
        phone: "312-555-0100",
        url: "https://example.org/ssa5",
      },
    ],
    officialSource: { label: "City of Chicago SSA page", url: "https://example.org/official" },
    lastVerifiedAt: "July 2026",
  };

  it("renders nothing without an explanation", () => {
    expect(renderToStaticMarkup(<MatchExplanationDetails />)).toBe("");
  });

  it("renders populated groups and skips empty ones", () => {
    const html = renderToStaticMarkup(
      <MatchExplanationDetails explanation={explanation} />,
    );
    expect(html).toContain("Why it appears");
    expect(html).toContain("Still to confirm");
    expect(html).not.toContain("Based on your answers");
    expect(html).toContain("Confirm with");
    expect(html).toContain("https://example.org/ssa5");
    expect(html).toContain("City of Chicago SSA page");
    expect(html).toContain("Information reviewed July 2026");
  });
});

describe("ExecutiveSummarySection", () => {
  const summary: ExecutiveSummary = {
    topPrograms: [
      {
        programId: "ssa5",
        name: "SSA #5",
        explanation: {
          whyItAppears: ["Inside the SSA boundary"],
          knownFromPublicData: [],
          basedOnUserAnswers: [],
          stillToConfirm: [],
          currentDocumentsToGather: [],
          confirmWith: [],
        },
      },
    ],
    topActions: [
      { type: "call", label: "Call the program manager", programId: "ssa5" },
      { type: "book", label: "Book a consult", programId: "ssa5" },
    ],
    whyTheseMatter: "These programs reduce build-out costs.",
    zoneCount: 3,
  };

  it("renders programs, actions, and the summary paragraph", () => {
    const html = renderToStaticMarkup(
      <ExecutiveSummarySection
        summary={summary}
        isEditing={false}
        editedText=""
        onToggleEdit={() => {}}
        onTextChange={() => {}}
      />,
    );
    expect(html).toContain("Executive Summary");
    expect(html).toContain("SSA #5");
    expect(html).toContain("Inside the SSA boundary");
    expect(html).toContain("Best Next Steps");
    expect(html).toContain("Call the program manager");
    expect(html).toContain("These programs reduce build-out costs.");
    expect(html).toContain(">Edit<");
  });

  it("switches to a textarea when editing", () => {
    const html = renderToStaticMarkup(
      <ExecutiveSummarySection
        summary={summary}
        isEditing
        editedText="Custom text"
        onToggleEdit={() => {}}
        onTextChange={() => {}}
      />,
    );
    expect(html).toContain("<textarea");
    expect(html).toContain("Custom text");
    expect(html).toContain(">Done<");
  });

  it("prefers edited text over the generated summary when present", () => {
    const html = renderToStaticMarkup(
      <ExecutiveSummarySection
        summary={summary}
        isEditing={false}
        editedText="Owner-edited framing"
        onToggleEdit={() => {}}
        onTextChange={() => {}}
      />,
    );
    expect(html).toContain("Owner-edited framing");
    expect(html).not.toContain("These programs reduce build-out costs.");
  });
});
