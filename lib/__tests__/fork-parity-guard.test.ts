/**
 * Fork parity: drawn-area surfaces are shared components only.
 *
 * Recurrence-prevention guard for the fork-unification hardening round
 * (see lib/source-guard/fork-parity.ts's header comment for the full
 * history). Both real-codebase checks below must be green on the actual
 * repo; the synthetic self-tests prove the scanner's mechanics in
 * isolation, independent of whatever the real files currently contain.
 */
import { Project } from "ts-morph";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildForkParityProject,
  checkForkFileParity,
  collectDrawnAreaSignatures,
  FORK_FILE_PATHS,
  SHARED_DRAWN_AREA_MODULE_SPECIFIERS,
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

  it.each(FORK_FILE_PATHS)("%s imports the shared drawn-area module(s) and carries none of their signature copy locally", (relPath) => {
    const sourceFile = forkSourceFiles.find((f) => f.getFilePath().endsWith(relPath));
    if (!sourceFile) throw new Error(`Fork file not found in project: ${relPath}`);
    const violations = checkForkFileParity(sourceFile, signatures);
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
