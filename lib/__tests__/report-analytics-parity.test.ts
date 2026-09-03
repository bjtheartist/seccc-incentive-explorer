/**
 * Report analytics parity (RF2, first landing).
 *
 * Two shipped drifts motivated this file, both invisible on screen and
 * therefore invisible to every rendering test:
 *
 * 1. `analyticsReportKey` / `reportAnalyticsPayload` existed as three
 *    hand-copied local functions (app/report/page.tsx,
 *    components/report/ReportDisplay.tsx,
 *    components/report/VacancySpreadsheetSection.tsx) whose SHAPES had
 *    diverged — only page.tsx's payload carried zipCode / sectionCount /
 *    actionCount, so the same event arrived differently shaped depending
 *    on which renderer fired it. Both now live in
 *    lib/report-generated-event.ts, and the first block below keeps them
 *    there.
 * 2. `report_pdf_downloaded`, `share_link_copied` and
 *    `program_link_clicked` fired on the live fork only, so the same
 *    actions taken on a saved Workspace report were dark in the funnel.
 *    The second block pinned the two renderer forks to one event set.
 *
 * FORK-UNIFICATION ROUND. There is one renderer now:
 * app/report/page.tsx's private `ReportDisplay` was deleted and /report
 * renders components/report/ReportDisplay.tsx. Drift 2 is therefore
 * structurally impossible — one function cannot fire an event on one
 * surface and not the other — and "neither fork fires an event the other
 * does not" has nothing left to compare. What is NOT structurally
 * impossible is losing one of the three events that RF2 had to add, so the
 * second block below is kept as a presence check on the surviving renderer,
 * plus a guard against a second renderer reappearing. Drift 1 (local copies
 * of the helpers) is still perfectly possible in any of the callers, so the
 * first block is unchanged.
 */
import path from "node:path";
import { Node, Project, type SourceFile } from "ts-morph";
import { describe, expect, it } from "vitest";

const ROOT_DIR = path.resolve(__dirname, "../..");

/** Every file that fires report analytics and once owned a local copy. */
const ANALYTICS_CALLER_PATHS = [
  "app/report/page.tsx",
  "components/report/ReportDisplay.tsx",
  "components/report/VacancySpreadsheetSection.tsx",
] as const;

const SHARED_ANALYTICS_MODULE = "@/lib/report-generated-event";
const SHARED_ANALYTICS_HELPERS = ["analyticsReportKey", "reportAnalyticsPayload"] as const;

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: false },
});
const sourceFiles = new Map<string, SourceFile>(
  ANALYTICS_CALLER_PATHS.map((relPath) => [
    relPath,
    project.addSourceFileAtPath(`${ROOT_DIR}/${relPath}`),
  ]),
);

function get(relPath: string): SourceFile {
  const sourceFile = sourceFiles.get(relPath);
  if (!sourceFile) throw new Error(`Not loaded: ${relPath}`);
  return sourceFile;
}

/** Names this file declares itself, at any depth (not names it imports). */
function locallyDeclaredNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  sourceFile.forEachDescendant((node) => {
    if (Node.isFunctionDeclaration(node) || Node.isVariableDeclaration(node)) {
      const name = node.getName();
      if (name) names.add(name);
    }
  });
  return names;
}

/** Names imported from the shared analytics module. */
function importedFromShared(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== SHARED_ANALYTICS_MODULE) continue;
    for (const namedImport of declaration.getNamedImports()) {
      names.add(namedImport.getName());
    }
  }
  return names;
}

describe("report analytics helpers live in one module", () => {
  it.each(ANALYTICS_CALLER_PATHS)(
    "%s declares no local copy of the shared analytics helpers",
    (relPath) => {
      const declared = locallyDeclaredNames(get(relPath));
      for (const helper of SHARED_ANALYTICS_HELPERS) {
        expect(
          declared.has(helper),
          `${relPath} re-declares ${helper} locally. It is exported from ` +
            `${SHARED_ANALYTICS_MODULE}; import it instead. A local copy is how ` +
            `the payload shapes silently diverged before RF2.`,
        ).toBe(false);
      }
    },
  );

  it.each(ANALYTICS_CALLER_PATHS)("%s imports the helper(s) it actually uses", (relPath) => {
    const sourceFile = get(relPath);
    const imported = importedFromShared(sourceFile);
    const text = sourceFile.getFullText();
    for (const helper of SHARED_ANALYTICS_HELPERS) {
      // A file that never calls the helper need not import it; a file that
      // calls it must have gotten it from the shared module.
      if (!new RegExp(`\\b${helper}\\s*\\(`).test(text)) continue;
      expect(
        imported.has(helper),
        `${relPath} calls ${helper} but does not import it from ${SHARED_ANALYTICS_MODULE}.`,
      ).toBe(true);
    }
  });

  it("the shared payload keeps the RICHEST shape (the fields the forks had dropped)", () => {
    const shared = project.addSourceFileAtPath(`${ROOT_DIR}/lib/report-generated-event.ts`);
    const payload = shared.getFunctionOrThrow("reportAnalyticsPayload").getFullText();
    for (const field of ["zipCode", "sectionCount", "actionCount", "reportKey", "reportTitle"]) {
      expect(payload, `reportAnalyticsPayload dropped ${field}`).toContain(field);
    }
  });
});

/** The one renderer left. */
const REPORT_RENDERER_PATH = "components/report/ReportDisplay.tsx";

/** The trackEvent event-type literals fired inside one `ReportDisplay`. */
function rendererEventTypes(sourceFile: SourceFile): Set<string> {
  const renderer =
    sourceFile.getFunction("ReportDisplay") ??
    (() => {
      throw new Error(`No ReportDisplay function in ${sourceFile.getFilePath()}`);
    })();

  const events = new Set<string>();
  renderer.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    if (node.getExpression().getText() !== "trackEvent") return;
    const first = node.getArguments()[0];
    if (first && Node.isStringLiteral(first)) events.add(first.getLiteralText());
  });
  return events;
}

describe("the one report renderer fires the whole event set", () => {
  const rendererEvents = rendererEventTypes(get(REPORT_RENDERER_PATH));

  it("finds a real event set (sanity: the scan located the renderer)", () => {
    expect(rendererEvents.size).toBeGreaterThan(8);
  });

  it.each(["report_pdf_downloaded", "share_link_copied", "program_link_clicked"])(
    "%s still fires (each was live-fork-only before RF2, and mirroring them is what RF2 bought)",
    (eventType) => {
      expect(rendererEvents.has(eventType)).toBe(true);
    },
  );

  // Replaces "neither fork fires an event the other does not". That
  // assertion compared two renderers; with one renderer it is vacuously
  // true, and deleting it silently would leave nothing watching for the
  // condition that made it necessary. What it becomes is the structural
  // guarantee underneath it: exactly ONE component named ReportDisplay
  // exists, so no event can be surface-dependent in the first place.
  it("there is exactly one ReportDisplay renderer, so no event can be surface-dependent", () => {
    const renderers = ANALYTICS_CALLER_PATHS.filter((relPath) =>
      Boolean(get(relPath).getFunction("ReportDisplay")),
    );
    expect(
      renderers,
      "A second ReportDisplay has appeared. The two report renderers were " +
        "merged precisely because instrumentation added to one and not the " +
        "other made the funnel depend on which surface the user happened to " +
        "be on. Render the shared component with the props your surface " +
        "needs — see docs/report-renderer-unification.md — rather than " +
        "forking it again.",
    ).toEqual([REPORT_RENDERER_PATH]);
  });

  it("the live route reaches the renderer's instrumentation by RENDERING it, not by re-declaring events", () => {
    const page = get("app/report/page.tsx");
    expect(page.getFullText()).toContain(
      'import { ReportDisplay } from "@/components/report/ReportDisplay";',
    );
    expect(rendererEventTypes(get(REPORT_RENDERER_PATH)).size).toBeGreaterThan(8);
  });
});
