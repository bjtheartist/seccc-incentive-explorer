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

  // Gate finding 16(f): the source-grep this test used to be here — reading
  // app/report/page.tsx's raw text and asserting the shareLinkGoalsComplete
  // line exists — proved the right LINE OF CODE was present, never that it
  // actually did anything at render time. Replaced by a real render-level
  // test: app/report/__tests__/report-page-live-renderer.test.tsx's
  // "Floor suite (gate finding 16)" describe block, test "(f) a shared-
  // link recipient with a complete decoded goal set is NOT re-blocked by
  // the email gate" — it simulates a real `?<encoded wizard state>` share
  // URL (via a scoped next/navigation mock) and asserts the ACTUAL
  // rendered output never shows the email-gate stub, with a CONTROL test
  // proving the same assertion fails without a resolved share link (so the
  // positive assertion isn't vacuous). This file keeps the remaining
  // fork-parity source-greps below — they check something a single-fork
  // render test can't (that BOTH forks carry the same wiring), which is a
  // legitimate use of a source check, not a substitute for a real render.

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
