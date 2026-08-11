import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SPOTLIGHT_HOME_STEPS,
  SPOTLIGHT_REPORT_STEPS,
  SPOTLIGHT_TOTAL_STEPS,
} from "@/lib/first-visit-guide";

const homepageSource = readFileSync(
  new URL("../../home/HomePageClient.tsx", import.meta.url),
  "utf8",
);
const reportPageSource = readFileSync(
  new URL("../../../app/report/page.tsx", import.meta.url),
  "utf8",
);
const refinePanelSource = readFileSync(
  new URL("../../report/RefineValuePanel.tsx", import.meta.url),
  "utf8",
);

describe("first visit spotlight contract", () => {
  it("anchors every home-leg step to a stable homepage hook", () => {
    for (const step of SPOTLIGHT_HOME_STEPS) {
      expect(homepageSource).toContain(`data-tour="${step.key}"`);
    }
  });

  it("anchors every report-leg step to a stable report surface", () => {
    const reportSources = reportPageSource + refinePanelSource;
    for (const step of SPOTLIGHT_REPORT_STEPS) {
      const anchor = step.selector.startsWith("#")
        ? `id="${step.selector.slice(1)}"`
        : `data-tour="${step.selector.replace('[data-tour="', "").replace('"]', "")}"`;
      expect(reportSources).toContain(anchor);
    }
  });

  it("keeps the address search as the first actionable stop", () => {
    expect(SPOTLIGHT_HOME_STEPS[0]).toMatchObject({
      key: "address-search",
      selector: '[data-tour="address-search"]',
    });
  });

  it("hands off to the sample report and ends at the visitor's own address", () => {
    expect(SPOTLIGHT_HOME_STEPS[SPOTLIGHT_HOME_STEPS.length - 1].nextBtnText).toBe(
      "Open the sample report",
    );
    expect(SPOTLIGHT_TOTAL_STEPS).toBe(
      SPOTLIGHT_HOME_STEPS.length + SPOTLIGHT_REPORT_STEPS.length,
    );
  });
});
