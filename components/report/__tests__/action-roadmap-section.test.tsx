import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionRoadmapSection } from "@/components/report/ActionRoadmapSection";
import type { ActionRoadmapItem } from "@/lib/report-engine";

const items: ActionRoadmapItem[] = [
  {
    tier: "do-this-week",
    label: "Call the SSA program manager",
    description: "Confirm storefront eligibility before applying.",
    programId: "ssa5",
    programName: "SSA #5",
    contact: {
      role: "Program Manager",
      agency: "SSA #5 Commission",
      phone: "312-555-0100",
      email: "manager@example.org",
    },
    callScript: "Hi, I run a business at 9101 S Commercial Ave…",
  },
  {
    tier: "worth-exploring",
    label: "Explore NOF",
    description: "Larger build-outs may qualify.",
    programId: "nof",
    programName: "Neighborhood Opportunity Fund",
    contact: { agency: "DPD", phone: "312-555-0199" },
  },
];

describe("ActionRoadmapSection", () => {
  it("renders both tiers with contact details and call script", () => {
    const html = renderToStaticMarkup(<ActionRoadmapSection items={items} />);
    expect(html).toContain("Your Next Steps");
    expect(html).toContain("Do This Week");
    expect(html).toContain("Worth Exploring");
    expect(html).toContain("Call the SSA program manager");
    expect(html).toContain("tel:312-555-0100");
    expect(html).toContain("mailto:manager@example.org");
    expect(html).toContain("What to say");
    expect(html).toContain("Neighborhood Opportunity Fund");
    expect(html).toContain("tel:312-555-0199");
  });

  it("renders identically with and without the analytics callback", () => {
    const withoutCallback = renderToStaticMarkup(
      <ActionRoadmapSection items={items} />,
    );
    const withCallback = renderToStaticMarkup(
      <ActionRoadmapSection items={items} onContactClick={() => {}} />,
    );
    expect(withCallback).toBe(withoutCallback);
  });

  it("omits an empty tier entirely", () => {
    const html = renderToStaticMarkup(
      <ActionRoadmapSection items={items.filter((i) => i.tier === "do-this-week")} />,
    );
    expect(html).toContain("Do This Week");
    expect(html).not.toContain("Worth Exploring");
  });
});
