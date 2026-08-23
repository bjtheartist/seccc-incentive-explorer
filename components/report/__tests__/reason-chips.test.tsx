import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReasonChips } from "@/components/report/ReasonChips";

describe("ReasonChips (gate finding 11)", () => {
  it("renders nothing when there is no explanation or no reasons", () => {
    expect(renderToStaticMarkup(<ReasonChips />)).toBe("");
    expect(
      renderToStaticMarkup(
        <ReasonChips
          explanation={{
            whyItAppears: [],
            knownFromPublicData: [],
            basedOnUserAnswers: [],
            stillToConfirm: [],
            currentDocumentsToGather: [],
            confirmWith: [],
          }}
        />,
      ),
    ).toBe("");
  });

  it("renders each reason as a pill chip, in the SAME order the engine already produces them, under a 'Why this is shown' label", () => {
    const html = renderToStaticMarkup(
      <ReasonChips
        explanation={{
          whyItAppears: ["Address is inside SBIF-eligible TIF district", "Project goal matches published uses"],
          knownFromPublicData: [],
          basedOnUserAnswers: [],
          stillToConfirm: [],
          currentDocumentsToGather: [],
          confirmWith: [],
        }}
      />,
    );
    expect(html).toContain('data-testid="reason-chips"');
    // Gate round 2, BLOCKER 11: the real board label, not a generic one.
    expect(html).toContain("Why this is shown");
    const firstIndex = html.indexOf("Address is inside SBIF-eligible TIF district");
    const secondIndex = html.indexOf("Project goal matches published uses");
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });
});
