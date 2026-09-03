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

// Fork-unification round: this block asserted each string TWICE — once
// against app/report/page.tsx's private ReportDisplay and once against
// components/report/ReportDisplay.tsx. That private copy is gone; /report
// renders the one exported component. Every assertion below is kept,
// applied once, against the renderer that survived.
describe("shared-link recipient — the framed-link notice", () => {
  const root = process.cwd();
  const renderer = readFileSync(
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
  // source-greps below. They used to check something a single-fork render
  // test could not — that BOTH forks carried the same wiring. There is one
  // renderer now, so what they still buy is cheap coverage of a surface no
  // render test in this file exercises; they are not a substitute for a
  // real render.

  it("the renderer renders the framed-persona-link notice with a one-tap escape to 'All'", () => {
    expect(renderer).toContain('data-testid="framed-persona-notice"');
    expect(renderer).toContain("Switch to All for everything");
    expect(renderer).toContain("isFramedPersonaLink");
  });

  it("the notice never renders on 'all' itself (no escape hatch to offer)", () => {
    expect(renderer).toContain("isFramedPersonaLink && persona !== DEFAULT_PERSONA");
  });
});
