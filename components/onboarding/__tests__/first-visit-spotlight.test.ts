import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIRST_VISIT_SPOTLIGHT_STEPS } from "@/lib/first-visit-guide";

const homepageSource = readFileSync(
  new URL("../../home/HomePageClient.tsx", import.meta.url),
  "utf8",
);

describe("first visit spotlight contract", () => {
  it("anchors every configured step to a stable homepage hook", () => {
    for (const step of FIRST_VISIT_SPOTLIGHT_STEPS) {
      expect(homepageSource).toContain(`data-tour="${step.key}"`);
    }
  });

  it("keeps the address search as the first actionable stop", () => {
    expect(FIRST_VISIT_SPOTLIGHT_STEPS[0]).toMatchObject({
      key: "address-search",
      selector: '[data-tour="address-search"]',
    });
  });
});
