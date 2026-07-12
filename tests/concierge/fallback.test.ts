import { describe, expect, it } from "vitest";
import { buildDeterministicConciergeResponse } from "@/lib/concierge/fallback";

const pageContext = { route: "/report" };

describe("deterministic concierge", () => {
  it("returns sourced program guidance for a common business goal", async () => {
    const response = await buildDeterministicConciergeResponse({
      userText: "I want to improve my storefront and hire employees.",
      pageContext,
      signedIn: false,
    });

    expect(response).toContain("may be worth exploring");
    expect(response).toContain("Official details");
    expect(response).toContain("not an eligibility or award decision");
  });

  it("refuses internal scores without exposing any value", async () => {
    const response = await buildDeterministicConciergeResponse({
      userText: "What is my corridor score and internal ranking?",
      pageContext,
      signedIn: false,
    });

    expect(response).toContain("can't expose internal scores");
    expect(response).not.toMatch(/\b\d+(?:\.\d+)?\b/);
  });

  it("refuses a top-line incentive-dollar rollup", async () => {
    const response = await buildDeterministicConciergeResponse({
      userText: "Add up every grant and give me one top-line dollar budget.",
      pageContext,
      signedIn: false,
    });

    expect(response).toContain("can't turn program figures into one");
    expect(response).not.toMatch(/\$\s?\d/);
  });

  it("leaves signed-in saved-record changes to approval-gated tools", async () => {
    const response = await buildDeterministicConciergeResponse({
      userText: "Update my business profile contact email.",
      pageContext,
      signedIn: true,
    });

    expect(response).toBeNull();
  });

  it("recognizes natural profile-field updates and workspace continuations", async () => {
    const fieldUpdate = await buildDeterministicConciergeResponse({
      userText: "Set my employee count to 12.",
      pageContext,
      signedIn: true,
    });
    const continuation = await buildDeterministicConciergeResponse({
      userText: "Save that.",
      pageContext: { route: "/workspace/business-file" },
      signedIn: true,
    });

    expect(fieldUpdate).toBeNull();
    expect(continuation).toBeNull();
  });
});
