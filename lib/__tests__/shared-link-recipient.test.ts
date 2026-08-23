import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { projectGoalsAreComplete } from "@/lib/report-wizard-config";

// ─── Spec v2 deliverable 7: shared-link recipient experience ────────────
// A framed link's decoded wizard state (`pg=`) can already carry a
// complete goal selection — recipients of those links must never be
// re-blocked by the same gate the sender already cleared.

describe("projectGoalsAreComplete", () => {
  it("is false with no goals", () => {
    expect(projectGoalsAreComplete({})).toBe(false);
    expect(projectGoalsAreComplete({ projectGoals: [] })).toBe(false);
  });

  it("is true once at least one real goal is present", () => {
    expect(projectGoalsAreComplete({ projectGoals: ["hiring"] })).toBe(true);
    expect(projectGoalsAreComplete({ projectType: "hiring" })).toBe(true);
  });

  it("requires a written custom goal when 'other' is selected", () => {
    expect(projectGoalsAreComplete({ projectGoals: ["other"] })).toBe(false);
    expect(
      projectGoalsAreComplete({ projectGoals: ["other"], customGoal: "  " }),
    ).toBe(false);
    expect(
      projectGoalsAreComplete({ projectGoals: ["other"], customGoal: "Something specific" }),
    ).toBe(true);
  });
});

describe("shared-link recipient — fork parity", () => {
  const root = process.cwd();
  const liveFork = readFileSync(join(root, "app/report/page.tsx"), "utf8");
  const workspaceFork = readFileSync(
    join(root, "components/report/ReportDisplay.tsx"),
    "utf8",
  );

  it("the live route skips the email gate for a share-mode link with a complete decoded goal set", () => {
    expect(liveFork).toContain(
      "const shareLinkGoalsComplete = isShareMode && projectGoalsAreComplete(wizardState);",
    );
    expect(liveFork).toContain("&& !shareLinkGoalsComplete;");
  });

  it("both forks render the framed-persona-link notice with a one-tap escape to 'All'", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain('data-testid="framed-persona-notice"');
      expect(fork).toContain("Switch to All for everything");
      expect(fork).toContain("isFramedPersonaLink");
    }
  });

  it("the notice never renders on 'all' itself (no escape hatch to offer)", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain("isFramedPersonaLink && persona !== DEFAULT_PERSONA");
    }
  });
});
