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

  it("asks about project stage when someone wants local support", async () => {
    const response = await buildDeterministicConciergeResponse({
      userText: "Help me get connected to local support.",
      pageContext,
      signedIn: false,
    });

    expect(response).toContain("don't need to have every detail figured out");
    expect(response).toContain("where does the project stand");
    expect(response).toContain("not an eligibility, viability, or readiness score");
  });

  it("routes a signed-in introduction request to approval-gated tools", async () => {
    const response = await buildDeterministicConciergeResponse({
      userText: "Please request an introduction to the local support organization.",
      pageContext,
      signedIn: true,
    });

    expect(response).toBeNull();
  });

  it("keeps signed-out introduction requests unsent and points to sign-in", async () => {
    const response = await buildDeterministicConciergeResponse({
      userText: "Please introduce me to the organization in my report.",
      pageContext,
      signedIn: false,
    });

    expect(response).toContain("sign in to your workspace");
    expect(response).toContain("Nothing has been shared");
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

  it("immediately refuses saved-record changes for a signed-out visitor", async () => {
    const response = await buildDeterministicConciergeResponse({
      userText: "Update my profile contact email to owner@example.com.",
      pageContext,
      signedIn: false,
    });

    expect(response).toContain("while you're signed out");
    expect(response).toContain("Nothing was changed");
    expect(response).toContain("/login?callbackUrl=/workspace");
  });

  it("leaves nuanced questions to the model while keeping greetings deterministic", async () => {
    const nuanced = await buildDeterministicConciergeResponse({
      userText: "Help me turn a vague project idea into useful questions.",
      pageContext,
      signedIn: false,
    });
    const greeting = await buildDeterministicConciergeResponse({
      userText: "Hello!",
      pageContext,
      signedIn: false,
    });

    expect(nuanced).toBeNull();
    expect(greeting).toContain("Chicago business incentives");
  });

  it("keeps stakeholder sequencing advisory and free of invented requirements", async () => {
    const response = await buildDeterministicConciergeResponse({
      userText:
        "How should I sequence conversations with an alderman, a lender, and a local chamber?",
      pageContext,
      signedIn: false,
    });

    expect(response).toContain("optional coordination plan");
    expect(response).toContain("official instructions");
    expect(response).not.toMatch(/\bcontrols?\b|\bgatekeepers?\b/i);
    expect(response).not.toContain("https://");
  });
});
