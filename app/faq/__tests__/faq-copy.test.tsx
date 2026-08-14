/**
 * build-spec.md 2.2/2.4 (audit F3/F6/F11): FAQ answers must not (a) claim
 * incentive stacking is proven by boundary overlap, (b) assert a lapsed
 * program's benefit "applies whenever you hire", (c) use "eligibility
 * gate" framing or name a lapsed program as a "still available" example,
 * or (d) describe the renamed/repurposed CNRP program by its old
 * storefront-grant framing. Answers only render into the DOM once their
 * accordion row is expanded, so this asserts directly against the exported
 * FAQ_ITEMS content array rather than driving the accordion.
 */
import { describe, expect, it } from "vitest";
import { FAQ_ITEMS } from "../faq-items";

const allAnswers = FAQ_ITEMS.map((item) => item.a).join("\n");

describe("/faq FAQ_ITEMS — catalog-derived, drift-resistant answers", () => {
  it("uses the binding stacking-overlap copy (F11), not the old 'Yes, this is stacking' claim", () => {
    expect(allAnswers).toContain(
      "Overlap shortens the comparison list; it does not show that benefits can be combined.",
    );
    expect(allAnswers).not.toMatch(/Yes\.\s*This is often called incentive stacking/i);
  });

  it("never claims High Unemployment Zone hiring incentives apply 'whenever you hire' (F6 — WOTC lapsed)", () => {
    expect(allAnswers).not.toContain(
      "hiring incentives in High Unemployment Zones apply whenever you hire",
    );
  });

  it("never uses 'eligibility gate' framing, and never cites a lapsed program as a still-available example (F3/F6)", () => {
    expect(allAnswers.toLowerCase()).not.toContain("first eligibility gate");
    expect(allAnswers).not.toContain("Cook County's Catalyst Grant, are available county-wide");
  });

  it("describes CNRP (formerly MMRP) accurately instead of the stale storefront-grant framing (F6)", () => {
    expect(allAnswers).toContain("CNRP");
    expect(allAnswers).not.toContain(
      "targets high-vacancy commercial corridors with storefront improvement grants",
    );
  });
});
