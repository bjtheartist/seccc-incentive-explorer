/**
 * build-spec.md 2.2/2.4 (audit F7/F8/F11): Answers SEO content must not
 * (a) describe the closed Catalyst Grant round as currently usable for
 * salaries, (b) reduce eligibility to "check your address"/"eligibility is
 * geographic" framing, or (c) claim boundary overlap proves programs can be
 * combined.
 */
import { describe, expect, it } from "vitest";
import { ANSWER_PAGES } from "../answers-data";

const allText = ANSWER_PAGES.flatMap((a) => [a.answer, ...(a.bullets ?? [])]).join("\n");

describe("answers-data — catalog-honest content (F7/F8/F11)", () => {
  it("never claims the Catalyst Grant currently funds salaries without a closed-round qualifier", () => {
    expect(allText).not.toContain("Catalyst Grant can fund new-hire salaries");
    expect(allText).not.toContain("The Catalyst Grant (up to $100,000) can cover salaries and recruitment for growing Cook County firms.");
    expect(allText).toMatch(/no current round is open or anticipated in 2026–27/);
  });

  it("never uses 'Eligibility is geographic' framing", () => {
    expect(allText).not.toMatch(/Eligibility is geographic/i);
  });

  it("HUBZone copy does not tell the reader to 'check your address to confirm' eligibility outright", () => {
    expect(allText).not.toContain("Many South and West Side Chicago corridors qualify — check your address to confirm.");
  });

  it("uses the F11 binding overlap copy, not a 'zones are the eligibility gate' claim", () => {
    expect(allText).toContain(
      "Overlap shortens the comparison list; it does not show that benefits can be combined.",
    );
    expect(allText.toLowerCase()).not.toContain("zones are the eligibility gate");
  });
});
