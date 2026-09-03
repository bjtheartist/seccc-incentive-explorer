/**
 * Fork parity: drawn-area surfaces are shared components only.
 *
 * Recurrence-prevention guard for the fork-unification hardening round
 * (see lib/source-guard/fork-parity.ts's header comment for the full
 * history). Both real-codebase checks below must be green on the actual
 * repo; the synthetic self-tests prove the scanner's mechanics in
 * isolation, independent of whatever the real files currently contain.
 */
import { Node, Project } from "ts-morph";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildForkParityProject,
  checkReportActionForkParity,
  checkForkFileParity,
  checkReportSurfaceActionCopy,
  collectDrawnAreaSignatures,
  collectReportSurfaceFilePaths,
  FORK_FILE_PATHS,
  REPORT_RENDERER_FILE_PATH,
  KNOWN_UNMIGRATED_ACTION_ROWS,
  REPORT_ACTION_COPY_OWNERS,
  REPORT_ACTION_POLICY_NAMES,
  REPORT_ACTION_RUNTIME_SIGNATURES,
  SHARED_DRAWN_AREA_MODULE_SPECIFIERS,
  SHARED_REPORT_ACTION_COMPONENT_NAME,
  SHARED_REPORT_ACTION_MODULE_SPECIFIER,
} from "../source-guard/fork-parity";

const ROOT_DIR = path.resolve(__dirname, "../..");

describe("fork parity: drawn-area surfaces are shared components only — real codebase", () => {
  const { forkSourceFiles, sharedSourceFiles } = buildForkParityProject(ROOT_DIR);
  const signatures = collectDrawnAreaSignatures(sharedSourceFiles);

  it("the shared component/hook actually yields a non-trivial signature set (sanity: the guard has something to check)", () => {
    expect(signatures.size).toBeGreaterThan(20);
  });

  it("the signature set covers the LEGACY mid-report vacancy-spreadsheet summary card (gate-review finding, 2026-08-29: this card predates commit 78ea06f and was originally missed by the fork-fence extraction — VacancySpreadsheetSummaryCard's own 'locale-level property spreadsheet' sentence must be a live signature, so pasting this card's copy back into a fork file turns the guard red)", () => {
    expect(
      [...signatures].some((s) =>
        s.includes("locale-level property spreadsheet"),
      ),
    ).toBe(true);
  });

  it.each(FORK_FILE_PATHS)("%s carries none of the shared drawn-area signature copy locally (and, if it is the renderer, imports every shared module)", (relPath) => {
    const sourceFile = forkSourceFiles.find((f) => f.getFilePath().endsWith(relPath));
    if (!sourceFile) throw new Error(`Fork file not found in project: ${relPath}`);
    // Fork-unification round: only the surviving renderer owes the shared
    // IMPORTS. app/report/page.tsx renders no report body any more; what it
    // still owes — and what this test still checks for it — is the copy
    // fence, which is what stops a second renderer being pasted back into it.
    const violations = checkForkFileParity(sourceFile, signatures, {
      requireSharedImports: relPath === REPORT_RENDERER_FILE_PATH,
    });
    if (violations.length > 0) {
      const report = violations
        .map((v) => `  [${v.kind}] ${v.filePath}\n    ${v.detail}`)
        .join("\n");
      throw new Error(
        `${relPath} violates fork parity:\n${report}\n` +
          "Drawn-area rendering must be imported from components/report/VacancySpreadsheetSection.tsx " +
          "and components/report/useVacancySpreadsheetSection.ts — never re-declared locally in a fork file. " +
          "See docs/persona-report-parity.md for the parity-by-construction ruling this guard enforces.",
      );
    }
    expect(violations).toEqual([]);
  });
});

describe("fork parity guard — synthetic self-tests (scanner mechanics, in-memory fixtures)", () => {
  function inMemoryProject() {
    return new Project({ useInMemoryFileSystem: true });
  }

  it("collectDrawnAreaSignatures pulls long JSX text and string/template literals from the shared file, and skips import specifiers and short strings", () => {
    const project = inMemoryProject();
    const shared = project.createSourceFile(
      "shared.tsx",
      [
        `import { X } from "@/components/report/SomeOtherLongModulePathThatIsNotASignature";`,
        `export function Shared() {`,
        `  const short = "Overview";`,
        `  const long = "This saved view does not turn public records into an availability determination.";`,
        `  return <div>{long}<p>Also long enough to count as a real signature here.</p></div>;`,
        `}`,
      ].join("\n"),
    );
    const signatures = collectDrawnAreaSignatures([shared]);
    expect(signatures.has("Overview")).toBe(false);
    expect(
      signatures.has(
        "This saved view does not turn public records into an availability determination.",
      ),
    ).toBe(true);
    expect(signatures.has("Also long enough to count as a real signature here.")).toBe(true);
    expect(
      [...signatures].some((s) =>
        s.includes("SomeOtherLongModulePathThatIsNotASignature"),
      ),
    ).toBe(false);
  });

  it("checkForkFileParity flags a fork file with no import of the shared module at all", () => {
    const project = inMemoryProject();
    const fork = project.createSourceFile(
      "fork.tsx",
      `export function Fork() { return <div>Nothing shared here.</div>; }`,
    );
    const violations = checkForkFileParity(fork, new Set(["irrelevant signature text over thirty chars long"]));
    expect(violations.some((v) => v.kind === "missing-shared-import")).toBe(true);
  });

  it("checkForkFileParity flags a fork file that imports the shared HOOK but dropped the shared RENDERER import (partial-import regression: a fork could stop rendering VacancySpreadsheetSection, keep the hook, and implement different JSX with no exact signature string carried over — an .some() check would miss this)", () => {
    const project = inMemoryProject();
    const fork = project.createSourceFile(
      "fork.tsx",
      [
        `import { useVacancySpreadsheetSection } from "@/components/report/useVacancySpreadsheetSection";`,
        `export function Fork() {`,
        `  const vacancy = useVacancySpreadsheetSection(report, wizardState, compact);`,
        `  return <div>{vacancy.vacancySpreadsheetLocale}</div>;`,
        `}`,
      ].join("\n"),
    );
    const violations = checkForkFileParity(fork, new Set(["irrelevant signature text over thirty chars long"]));
    expect(violations.some((v) => v.kind === "missing-shared-import")).toBe(true);
  });

  it("checkForkFileParity is GREEN for a fork file that imports EVERY shared module and carries none of the signature text", () => {
    const project = inMemoryProject();
    const fork = project.createSourceFile(
      "fork.tsx",
      [
        `import { VacancySpreadsheetSection } from "@/components/report/VacancySpreadsheetSection";`,
        `import { useVacancySpreadsheetSection } from "@/components/report/useVacancySpreadsheetSection";`,
        `export function Fork() {`,
        `  const vacancy = useVacancySpreadsheetSection(report, wizardState, compact);`,
        `  return <VacancySpreadsheetSection vacancy={vacancy} />;`,
        `}`,
      ].join("\n"),
    );
    const violations = checkForkFileParity(
      fork,
      new Set(["This saved view does not turn public records into an availability determination."]),
    );
    expect(violations).toEqual([]);
  });

  it("INJECTION: checkForkFileParity turns RED the moment a fork file pastes the shared component's own copy back in, even alongside a correct import", () => {
    const project = inMemoryProject();
    const fork = project.createSourceFile(
      "fork.tsx",
      [
        `import { VacancySpreadsheetSection } from "@/components/report/VacancySpreadsheetSection";`,
        `export function Fork() {`,
        `  return (`,
        `    <div>`,
        `      <VacancySpreadsheetSection />`,
        `      {/* someone pasted a block from the shared component back in here */}`,
        `      <p>This saved view does not turn public records into an availability determination.</p>`,
        `    </div>`,
        `  );`,
        `}`,
      ].join("\n"),
    );
    const violations = checkForkFileParity(
      fork,
      new Set(["This saved view does not turn public records into an availability determination."]),
    );
    expect(violations.some((v) => v.kind === "local-signature-text")).toBe(true);
  });

  it("SHARED_DRAWN_AREA_MODULE_SPECIFIERS matches what the real fork files actually import (regression: a rename of the shared module without updating this guard would silently stop checking anything)", () => {
    expect(SHARED_DRAWN_AREA_MODULE_SPECIFIERS).toContain(
      "@/components/report/VacancySpreadsheetSection",
    );
    expect(SHARED_DRAWN_AREA_MODULE_SPECIFIERS).toContain(
      "@/components/report/useVacancySpreadsheetSection",
    );
  });
});

describe("fork parity: generic report actions are shared by construction", () => {
  const { project, forkSourceFiles } = buildForkParityProject(ROOT_DIR);

  it.each(FORK_FILE_PATHS)("%s carries no local action copy or vacancy predicate (and, if it is the renderer, renders the shared action component)", (relPath) => {
    const sourceFile = forkSourceFiles.find((file) => file.getFilePath().endsWith(relPath));
    if (!sourceFile) throw new Error(`Fork file not found in project: ${relPath}`);

    expect(
      checkReportActionForkParity(sourceFile, {
        requireSharedRow: relPath === REPORT_RENDERER_FILE_PATH,
      }),
    ).toEqual([]);
  });

  it("the vacancy spreadsheet scope imports the neutral vacancy predicate instead of declaring another copy", () => {
    const sourceFile = project.addSourceFileAtPath(
      `${ROOT_DIR}/lib/vacancy-spreadsheet-scope.ts`,
    );
    const policyImport = sourceFile
      .getImportDeclarations()
      .find((declaration) => declaration.getModuleSpecifierValue() === "@/lib/report-action-policy");

    expect(
      policyImport?.getNamedImports().some((namedImport) => namedImport.getName() === "isVacancyReport"),
    ).toBe(true);
    expect(sourceFile.getFunction("isVacancyReport")).toBeUndefined();
    expect(
      sourceFile.getVariableDeclarations().some((declaration) => declaration.getName() === "isVacancyReport"),
    ).toBe(false);
  });

  it("turns red when a fork locally restores generic action copy or the vacancy predicate", () => {
    const syntheticProject = new Project({ useInMemoryFileSystem: true });
    const sourceFile = syntheticProject.createSourceFile(
      "fork.tsx",
      [
        `import { ${SHARED_REPORT_ACTION_COMPONENT_NAME} } from "${SHARED_REPORT_ACTION_MODULE_SPECIFIER}";`,
        `const isVacancyReport = report.title.includes("vacancy");`,
        `export function Fork() {`,
        `  return <><${SHARED_REPORT_ACTION_COMPONENT_NAME} /><button>${REPORT_ACTION_RUNTIME_SIGNATURES[1]}</button></>;`,
        `}`,
      ].join("\n"),
    );

    const violations = checkReportActionForkParity(sourceFile);
    expect(violations.some((violation) => violation.kind === "local-action-copy")).toBe(true);
    expect(violations.some((violation) => violation.kind === "local-vacancy-predicate")).toBe(true);
  });

  it("turns red when a fork drops the shared generic action component", () => {
    const syntheticProject = new Project({ useInMemoryFileSystem: true });
    const sourceFile = syntheticProject.createSourceFile(
      "fork.tsx",
      `export function Fork() { return <div>Unrelated report content</div>; }`,
    );

    const violations = checkReportActionForkParity(sourceFile);
    expect(violations.some((violation) => violation.kind === "missing-shared-action-import")).toBe(true);
    expect(violations.some((violation) => violation.kind === "missing-shared-action-render")).toBe(true);
  });
});

/**
 * R3: the audit's exact blind spot. The action sweep above only ever ran on
 * the two FORK files, so components/report/VacancySpreadsheetSection.tsx
 * could — and did — hand-rebuild the same action row twice, carrying all
 * seven forbidden copy strings and an inline re-implementation of the share
 * predicate that lib/report-action-policy.ts owns. Nothing was red.
 *
 * R3 follow-up (2026-09-02): the widened sweep was still `readdirSync` on
 * ONE directory, which is why components/map/MapPolygonPanel.tsx kept its
 * own hand-built Save / Email / Download row with nothing red. The sweep is
 * now recursive over `app/` and `components/`, and the one row it newly
 * finds is held on `KNOWN_UNMIGRATED_ACTION_ROWS` — a shrink-only list, not
 * an exemption.
 */
describe("report-action copy stays in the shared component across ALL report surfaces — real codebase", () => {
  const surfacePaths = collectReportSurfaceFilePaths(ROOT_DIR);
  const knownUnmigrated = new Set<string>(KNOWN_UNMIGRATED_ACTION_ROWS);
  const surfaceProject = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });

  it("sweeps a real, non-trivial set of report surfaces (sanity: the recursive scan found files)", () => {
    expect(surfacePaths.length).toBeGreaterThan(10);
    expect(surfacePaths).toContain("components/report/VacancySpreadsheetSection.tsx");
    // The sweep is recursive: files outside components/report — the exact
    // blind spot this follow-up closes — are in scope now.
    expect(surfacePaths).toContain("components/map/MapPolygonPanel.tsx");
    expect(surfacePaths).toContain("app/report/page.tsx");
    // The copy owners are excluded by construction, not by luck.
    for (const owner of REPORT_ACTION_COPY_OWNERS) {
      expect(surfacePaths).not.toContain(owner);
    }
  });

  it.each(collectReportSurfaceFilePaths(ROOT_DIR).filter((relPath) => !knownUnmigrated.has(relPath)))(
    "%s rebuilds neither the shared action copy nor the shared action policy",
    (relPath) => {
      const sourceFile = surfaceProject.addSourceFileAtPath(`${ROOT_DIR}/${relPath}`);
      const violations = checkReportSurfaceActionCopy(sourceFile);
      if (violations.length > 0) {
        const report = violations.map((v) => `  [${v.kind}] ${v.detail}`).join("\n");
        throw new Error(
          `${relPath} rebuilds the shared report action row:\n${report}\n` +
            `Render <${SHARED_REPORT_ACTION_COMPONENT_NAME} /> from ` +
            `${SHARED_REPORT_ACTION_MODULE_SPECIFIER} and take the labels and ` +
            `share gate from lib/report-action-policy.ts. If this file legitimately ` +
            `OWNS the copy (a modal heading, say), add it to REPORT_ACTION_COPY_OWNERS ` +
            `with a reason — do not delete the assertion.`,
        );
      }
      expect(violations).toEqual([]);
    },
  );

  /**
   * The known-unmigrated list is a ratchet in its own right. It may only
   * shrink, and every entry must still be a real violation — otherwise a
   * migrated row would stay listed and the next hand-built row could be
   * slipped in beside it.
   */
  it("holds exactly one known-unmigrated action row, and it may only shrink", () => {
    expect([...KNOWN_UNMIGRATED_ACTION_ROWS]).toEqual([
      "components/map/MapPolygonPanel.tsx",
    ]);
    for (const relPath of KNOWN_UNMIGRATED_ACTION_ROWS) {
      expect(surfacePaths).toContain(relPath);
    }
  });

  it.each(KNOWN_UNMIGRATED_ACTION_ROWS)(
    "%s is still an un-migrated row — remove it from KNOWN_UNMIGRATED_ACTION_ROWS once it is migrated",
    (relPath) => {
      const sourceFile = surfaceProject.addSourceFileAtPath(`${ROOT_DIR}/${relPath}`);
      const violations = checkReportSurfaceActionCopy(sourceFile);
      if (violations.length === 0) {
        throw new Error(
          `${relPath} no longer rebuilds the shared action row. Delete it from ` +
            `KNOWN_UNMIGRATED_ACTION_ROWS in lib/source-guard/fork-parity.ts in this ` +
            `same commit — a stale entry is a hole the next hand-built row can hide in.`,
        );
      }
      expect(violations.every((violation) => violation.kind === "local-action-copy")).toBe(true);
    },
  );

  it("VacancySpreadsheetSection renders the shared action component for both of its rows", () => {
    const sourceFile = surfaceProject.addSourceFileAtPath(
      `${ROOT_DIR}/components/report/VacancySpreadsheetSection.tsx`,
    );
    const renders = sourceFile
      .getDescendants()
      .filter(
        (node) =>
          Node.isJsxSelfClosingElement(node) &&
          node.getTagNameNode().getText() === SHARED_REPORT_ACTION_COMPONENT_NAME,
      );
    // Two action rows: the drawn-area workstation and the vacancy spreadsheet.
    expect(renders.length).toBe(2);
  });

  it("turns red when a report surface rebuilds the row's copy or the policy", () => {
    const syntheticProject = new Project({ useInMemoryFileSystem: true });
    const sourceFile = syntheticProject.createSourceFile(
      "surface.tsx",
      [
        `function ${REPORT_ACTION_POLICY_NAMES[0]}(report) { return report.title.includes("vacancy"); }`,
        `export function Surface() {`,
        `  return <button>${REPORT_ACTION_RUNTIME_SIGNATURES[0]}</button>;`,
        `}`,
      ].join("\n"),
    );

    const violations = checkReportSurfaceActionCopy(sourceFile);
    expect(violations.some((violation) => violation.kind === "local-action-copy")).toBe(true);
    expect(violations.some((violation) => violation.kind === "local-vacancy-predicate")).toBe(true);
  });

  it("stays quiet on a report surface that has nothing to do with the action row", () => {
    const syntheticProject = new Project({ useInMemoryFileSystem: true });
    const sourceFile = syntheticProject.createSourceFile(
      "surface.tsx",
      `export function Surface() { return <div>Neighborhood economic context</div>; }`,
    );
    expect(checkReportSurfaceActionCopy(sourceFile)).toEqual([]);
  });
});
