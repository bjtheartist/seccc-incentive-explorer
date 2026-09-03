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
 * report-page-live-renderer.test.tsx's own note on that constraint): the
 * renderer imports and mounts the shared ZoningStarterHandoff
 * unconditionally alongside the zoneClass check, and gates
 * ZoningReviewQuestions (which alone carries StageHandoffButton) on
 * `!showPersonaLens || persona === DEFAULT_PERSONA`.
 *
 * Fork-unification round: these were two-fork parity greps, run against
 * app/report/page.tsx's private ReportDisplay and the exported component.
 * The private copy is gone — /report renders the exported one — so each
 * assertion is kept and applied once, to the renderer that survived.
 */
describe("zoning starter handoff (A2/A3)", () => {
  const root = process.cwd();
  const renderer = readFileSync(
    join(root, "components/report/ReportDisplay.tsx"),
    "utf8",
  );

  it("the renderer mounts ZoningStarterHandoff unconditionally whenever zoneClass is present (never bare zoneClass)", () => {
    expect(renderer).toContain("import { ZoningStarterHandoff }");
    expect(renderer).toMatch(
      /report\.metadata\?\.zoneClass && \(\s*<>\s*\{\/\*[^]*?<ZoningStarterHandoff/,
    );
  });

  it("the renderer gates ZoningReviewQuestions (and its StageHandoffButton) to the 'all' lens only", () => {
    expect(renderer).toContain("(!showPersonaLens || persona === DEFAULT_PERSONA) && (");
  });

  it("ZoningStarterHandoff itself never renders StageHandoffButton (that stays inside ZoningReviewQuestions, 'all'-only)", () => {
    const component = readFileSync(
      join(root, "components/zoning/ZoningStarterHandoff.tsx"),
      "utf8",
    );
    expect(component).not.toContain("StageHandoffButton");
  });
});
