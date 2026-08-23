import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Owner rulings A2/A3 (build-spec.md) + late amendment: every persona view
 * gets the district-family + ZBA-authority line next to the published
 * zoning code (never zoneClass without its detail), the full activity
 * questionnaire is excluded from every persona lens (present only on
 * "all"), and its one-pager handoff button never renders on a persona
 * view. Structural-only assertions (no DOM environment in this repo — see
 * report-page-live-renderer.test.tsx's own note on that constraint):
 * both forks import and mount the shared ZoningStarterHandoff
 * unconditionally alongside the zoneClass check, and gate
 * ZoningReviewQuestions (which alone carries StageHandoffButton) on
 * `!showPersonaLens || persona === DEFAULT_PERSONA`.
 */
describe("zoning starter handoff — fork parity (A2/A3)", () => {
  const root = process.cwd();
  const liveFork = readFileSync(join(root, "app/report/page.tsx"), "utf8");
  const workspaceFork = readFileSync(
    join(root, "components/report/ReportDisplay.tsx"),
    "utf8",
  );

  it("both forks mount ZoningStarterHandoff unconditionally whenever zoneClass is present (never bare zoneClass)", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain("import { ZoningStarterHandoff }");
      expect(fork).toMatch(
        /report\.metadata\?\.zoneClass && \(\s*<>\s*\{\/\*[^]*?<ZoningStarterHandoff/,
      );
    }
  });

  it("both forks gate ZoningReviewQuestions (and its StageHandoffButton) to the 'all' lens only", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain("(!showPersonaLens || persona === DEFAULT_PERSONA) && (");
    }
  });

  it("ZoningStarterHandoff itself never renders StageHandoffButton (that stays inside ZoningReviewQuestions, 'all'-only)", () => {
    const component = readFileSync(
      join(root, "components/zoning/ZoningStarterHandoff.tsx"),
      "utf8",
    );
    expect(component).not.toContain("StageHandoffButton");
  });
});
