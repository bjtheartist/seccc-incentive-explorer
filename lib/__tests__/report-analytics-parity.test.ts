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
 *    The second block pins the two renderer forks to one event set.
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

describe("both report-renderer forks fire the same event set", () => {
  const liveEvents = rendererEventTypes(get("app/report/page.tsx"));
  const workspaceEvents = rendererEventTypes(get("components/report/ReportDisplay.tsx"));

  it("finds a real event set in both forks (sanity: the scan located the renderers)", () => {
    expect(liveEvents.size).toBeGreaterThan(8);
    expect(workspaceEvents.size).toBeGreaterThan(8);
  });

  it.each(["report_pdf_downloaded", "share_link_copied", "program_link_clicked"])(
    "%s fires on BOTH forks (each was live-fork-only before RF2)",
    (eventType) => {
      expect(liveEvents.has(eventType)).toBe(true);
      expect(workspaceEvents.has(eventType)).toBe(true);
    },
  );

  it("neither fork fires an event the other does not", () => {
    const onlyLive = [...liveEvents].filter((event) => !workspaceEvents.has(event)).sort();
    const onlyWorkspace = [...workspaceEvents].filter((event) => !liveEvents.has(event)).sort();
    expect(
      { onlyLive, onlyWorkspace },
      "Instrumentation added to one report renderer must be mirrored into the " +
        "other in the same commit — the forks are two renderings of one report, " +
        "and an event on only one of them makes the funnel depend on which " +
        "surface the user happened to be on.",
    ).toEqual({ onlyLive: [], onlyWorkspace: [] });
  });
});
