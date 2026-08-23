import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  BRIEF_PRIORITY_OPTIONS,
  BRIEF_STAGE_OPTIONS,
  briefSeekingLine,
  briefStageLabel,
  buildBriefData,
  isBriefPriority,
  isBriefStage,
} from "@/lib/report-brief";
import { CONFIRMED_PROGRAMS_SECTION_TITLE } from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";
import { SUPPORT_ORGANIZATIONS_SECTION_TITLE } from "@/lib/support-organization-copy";

function reportFixture(): GeneratedReport {
  return {
    title: "Test",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: new Date().toISOString(),
    summary: "",
    sections: [
      {
        title: "Site Facts",
        description: "",
        items: [
          { label: "PIN", value: "20-27-104-018-0000" },
          { label: "Building Classification", value: "517 — 1-story commercial" },
        ],
      },
      {
        title: CONFIRMED_PROGRAMS_SECTION_TITLE,
        description: "",
        items: [
          { label: "SBIF", value: "", programId: "sbif" },
          { label: "TIF", value: "", programId: "tif" },
          { label: "Federal OZ", value: "", programId: "federalOZ" },
          { label: "NOF", value: "", programId: "nof" },
        ],
      },
      {
        title: SUPPORT_ORGANIZATIONS_SECTION_TITLE,
        description: "",
        items: [
          { label: "Local Support in Chatham", value: "3 organizations" },
          { label: "Greater Chatham Initiative", value: "SSA #51 provider", detail: "corridor place-based" },
        ],
      },
    ],
    recommendedActions: [],
    metadata: {
      address: "7939 S Cottage Grove Ave",
      projectGoals: ["rehab"],
      zoneClass: "B3-2",
      zoneType: "Community Shopping",
    },
  };
}

describe("BRIEF_STAGE_OPTIONS / BRIEF_PRIORITY_OPTIONS", () => {
  it("validates real ids and labels the seeking line from priority", () => {
    expect(isBriefStage("launch-ready")).toBe(true);
    expect(isBriefStage("nonsense")).toBe(false);
    expect(isBriefPriority("renovation")).toBe(true);
    expect(isBriefPriority("nonsense")).toBe(false);
    expect(briefStageLabel("launch-ready")).toBe("Getting launch-ready");
    expect(briefSeekingLine("renovation")).toBe("build-out financing");
  });

  it("has exactly 4 stage options and 4 priority options, matching R5StageAsk", () => {
    expect(BRIEF_STAGE_OPTIONS).toHaveLength(4);
    expect(BRIEF_PRIORITY_OPTIONS).toHaveLength(4);
  });
});

describe("buildBriefData", () => {
  it("caps programs at 3 and reports the real overflow count — omission over compression", () => {
    const brief = buildBriefData(reportFixture(), "developer", "launch-ready", "renovation");
    expect(brief.programs).toHaveLength(3);
    expect(brief.overflowCount).toBe(1);
    expect(brief.programs.map((p) => p.programId)).toEqual(["sbif", "tif", "federalOZ"]);
  });

  it("caps contacts at 3, reusing the SAME lane-ranked contact-sheet builder — no separate relevance logic", () => {
    const brief = buildBriefData(reportFixture(), "supporter", "operating", "financing");
    expect(brief.contacts.length).toBeLessThanOrEqual(3);
  });

  it("reads address/goal/zoning/site-facts straight off the lensed report — never invents them", () => {
    const brief = buildBriefData(reportFixture(), "growing", "growing", "space");
    expect(brief.address).toBe("7939 S Cottage Grove Ave");
    expect(brief.zoneClass).toBe("B3-2");
    expect(brief.zoneType).toBe("Community Shopping");
    expect(brief.siteFacts.some((f) => f.label === "PIN")).toBe(true);
  });

  it("leaves preparedVia null (derivable-only) when the report carries no facilitated-source signal", () => {
    const brief = buildBriefData(reportFixture(), "growing", "growing", "space");
    expect(brief.preparedVia).toBeNull();
  });

  it("carries the two-question answers straight through, never re-deriving them", () => {
    const brief = buildBriefData(reportFixture(), "growing", "exploring", "navigating");
    expect(brief.stage).toBe("exploring");
    expect(brief.priority).toBe("navigating");
  });

  // Gate finding 14 (regression, real bug this fixes): dataVerifiedMonth
  // used to read `new Date()` (today) — a Brief built from a stale report
  // would falsely claim today's data vintage. It must read the REPORT's
  // own generatedAt.
  it("derives dataVerifiedMonth from the report's REAL generatedAt, never today's date", () => {
    const stale: GeneratedReport = { ...reportFixture(), generatedAt: "2025-03-14T00:00:00.000Z" };
    const brief = buildBriefData(stale, "growing", "growing", "space");
    expect(brief.dataVerifiedMonth).toBe("Mar 2025");
    expect(brief.dataVerifiedMonth).not.toBe(
      new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
    );
  });

  it("leaves dataVerifiedMonth null (never a guess) when the report carries no parseable generatedAt", () => {
    const bad: GeneratedReport = { ...reportFixture(), generatedAt: "" };
    const brief = buildBriefData(bad, "growing", "growing", "space");
    expect(brief.dataVerifiedMonth).toBeNull();
  });
});

describe("sm_ params wiring (structural — no DOM environment for the effect itself)", () => {
  it("app/report/page.tsx reads sm_stage/sm_priority through the real validators and writes them back via replaceState on brief-complete", () => {
    const source = readFileSync(join(process.cwd(), "app/report/page.tsx"), "utf8");
    expect(source).toContain('params.get("sm_stage")');
    expect(source).toContain('params.get("sm_priority")');
    expect(source).toContain("isBriefStage(stageParam) && isBriefPriority(priorityParam)");
    expect(source).toContain('url.searchParams.set("sm_stage", stage)');
    expect(source).toContain('url.searchParams.set("sm_priority", priority)');
    expect(source).toContain("window.history.replaceState(");
  });
});
