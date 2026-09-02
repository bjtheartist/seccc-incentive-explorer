/**
 * lib/source-guard/fork-parity.ts — fork parity: duplicated report concerns
 * are shared components only.
 *
 * Doctrine (persona spec v2, binding, re-affirmed by the fork-unification
 * hardening round): app/report/page.tsx's local `ReportDisplay` and the
 * exported components/report/ReportDisplay.tsx are two independently
 * rendered forks of the same report UI. Historically, drawn-area rendering
 * JSX was pasted into ONE fork (78ea06f added an identical 309-line block
 * to BOTH, but a later commit — aa387b1 — added ~1,021 more lines, the
 * "area analysis workstation," to ONE fork only, silently diverging them
 * again). The fix moved every drawn-area / vacancy-spreadsheet rendering
 * concern into components/report/VacancySpreadsheetSection.tsx (JSX) and
 * components/report/useVacancySpreadsheetSection.ts (state/effects), with
 * both forks importing and calling them instead of declaring their own
 * copies.
 *
 * This module is the recurrence guard, not a one-time migration check: it
 * asserts BOTH fork files import the shared module(s), and neither fork
 * file's own source locally re-declares any of the shared component's
 * distinctive rendered copy. The signature set is read live from the
 * shared component file itself (never hand-maintained as a parallel list),
 * so it can't go stale — if the shared component's copy changes, the
 * signatures the guard checks for change with it automatically. The generic
 * Download / Save / Email / Share controls use the same doctrine below: both
 * forks must render one shared component and may not restore the old local
 * action copy or vacancy predicate.
 */
import { readdirSync } from "node:fs";
import { Node, Project, type SourceFile } from "ts-morph";

/** Fork files this guard protects — relative to the repo root. */
export const FORK_FILE_PATHS = [
  "app/report/page.tsx",
  "components/report/ReportDisplay.tsx",
] as const;

/**
 * The shared modules every fork must import drawn-area rendering FROM,
 * and whose own rendered/error copy is the signature set fork files must
 * never locally re-declare.
 */
export const SHARED_DRAWN_AREA_MODULE_PATHS = [
  "components/report/VacancySpreadsheetSection.tsx",
  "components/report/useVacancySpreadsheetSection.ts",
] as const;

/** Module specifiers (as they appear in fork files' own import statements). */
export const SHARED_DRAWN_AREA_MODULE_SPECIFIERS = [
  "@/components/report/VacancySpreadsheetSection",
  "@/components/report/useVacancySpreadsheetSection",
] as const;

/** Generic report actions both report-renderer forks must render through. */
export const SHARED_REPORT_ACTION_MODULE_SPECIFIER =
  "@/components/report/ReportActionButtons";
export const SHARED_REPORT_ACTION_COMPONENT_NAME = "ReportActionButtons";

/**
 * R3: the action sweep above ran on the two FORK files only, which was the
 * audit's exact blind spot — components/report/VacancySpreadsheetSection.tsx
 * hand-rebuilt the same action row twice, with all seven copy strings and an
 * inline re-implementation of the share predicate, and no guard looked at
 * it because it is not a fork file. The sweep was widened to every component
 * under `components/report`.
 *
 * R3 follow-up (2026-09-02): one directory was still not enough. The review
 * of PR #251 found components/map/MapPolygonPanel.tsx hand-building the same
 * Save / Email / Download row — in a file that same PR edited — outside every
 * guard, because `readdirSync` on ONE directory is not a sweep. The roots
 * below are scanned RECURSIVELY, so a rebuild of the row lands red wherever
 * in the app or the component tree it is written.
 */
export const REPORT_SURFACE_ROOTS = ["app", "components"] as const;

/** Directory names never swept: tests may legitimately assert on the copy. */
export const REPORT_SURFACE_SKIPPED_DIRS = ["__tests__", "__snapshots__", "node_modules"] as const;

/**
 * Files under `REPORT_SURFACE_ROOTS` that legitimately contain action copy
 * and are therefore not swept. Kept deliberately tiny and explicit: each
 * entry is a module that OWNS its copy rather than borrowing the row's.
 */
export const REPORT_ACTION_COPY_OWNERS = [
  // The shared row itself — the single place this copy is allowed to live.
  "components/report/ReportActionButtons.tsx",
  // The modals the row OPENS. "Email Report" is this modal's own heading
  // and "Download PDF" its own confirm button; they are the destination of
  // an action, not a second copy of the control that triggers it.
  "components/report/ReportModals.tsx",
  // The save modal the row OPENS, on the same rule: "Save to Workspace" is
  // this modal's own eyebrow heading and "Save Report" its own confirm
  // button. It renders no action ROW — it is where one of the row's buttons
  // lands.
  "components/workspace/SaveReportModal.tsx",
] as const;

/**
 * Action rows that predate the shared component and have NOT been migrated.
 *
 * A debt ratchet, not an exemption: each entry must still actually violate
 * (the paired test fails if an entry has been cleaned up but left listed, so
 * the list cannot go stale), and the test fails if the list GROWS. The only
 * allowed edit is removal, in the commit that migrates the row.
 *
 * components/map/MapPolygonPanel.tsx — the drawn-area export row. Not a
 * clean drop-in for `ReportActionButtons`: it is a four-up grid of compact
 * buttons (`min-h-11`, `text-[9px]`, `px-3 py-2.5`) rather than the row's
 * full-size flex controls, every button carries `disabled` and `aria-busy`
 * bound to the vacancy/permit lookups (the shared component models neither),
 * its order leads with Save and ends with the CSV export, its Download
 * control swaps to "Retry PDF" after a failure, and it renders no Share
 * button at all — where the shared policy's `canShare` would add one.
 * Migrating it as-is would drop the `aria-busy`/`disabled` states or force a
 * className/variant escape hatch into the shared component that would let
 * any caller re-skin the row into a new fork. Recorded here so the row is
 * visible to the guard rather than invisible to it.
 */
export const KNOWN_UNMIGRATED_ACTION_ROWS = ["components/map/MapPolygonPanel.tsx"] as const;

/**
 * Names owned by lib/report-action-policy.ts. A report surface that
 * declares one of these locally has re-implemented the share gate or the
 * vacancy category instead of asking the policy.
 */
export const REPORT_ACTION_POLICY_NAMES = ["isVacancyReport", "getReportActionPolicy"] as const;

/** Runtime copy that belongs only in the shared generic action component. */
export const REPORT_ACTION_RUNTIME_SIGNATURES = [
  "Download PDF",
  "Save Report",
  "Save to Workspace",
  "Email This to Me",
  "Email Report",
  "Link Copied!",
  "Share Report",
] as const;

/**
 * Below this length a string is too generic to be a reliable drawn-area
 * signature on its own (e.g. a table-header word like "Records" or
 * "Overview" could legitimately appear in either fork file for an
 * unrelated reason and would false-positive the guard). The shared
 * component's actual rendered/error copy is verbose prose, so this
 * threshold still yields a large signature set in practice.
 */
const MIN_SIGNATURE_LENGTH = 30;

function isModuleSpecifierString(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;
  if (Node.isImportDeclaration(parent) || Node.isExportDeclaration(parent)) {
    return parent.getModuleSpecifier() === node;
  }
  if (Node.isCallExpression(parent)) {
    const expr = parent.getExpression();
    if (Node.isIdentifier(expr) && expr.getText() === "require") {
      return parent.getArguments()[0] === node;
    }
  }
  return false;
}

function isObjectPropertyKey(node: Node): boolean {
  const parent = node.getParent();
  return Boolean(parent && Node.isPropertyAssignment(parent) && parent.getNameNode() === node);
}

/**
 * A string literal used as a JSX ATTRIBUTE value — most commonly
 * `className="..."`. Tailwind utility strings like
 * `"font-mono-bureau text-[8px] uppercase tracking-[0.2em] ..."` are
 * design-system styling, not authored drawn-area copy, and the SAME long
 * utility string legitimately recurs across many unrelated elements in
 * both fork files (every report surface shares one visual language) — so
 * treating them as signatures makes the guard false-positive on ordinary,
 * unrelated JSX elsewhere in either fork file. Excluding all JSX attribute
 * values (not just className) keeps the signature set to genuine rendered
 * content: JSX text, template-literal prose, and standalone string
 * literals (error/CSV/filename copy).
 */
function isJsxAttributeValue(node: Node): boolean {
  const parent = node.getParent();
  return Boolean(parent && Node.isJsxAttribute(parent) && parent.getInitializer() === node);
}

/**
 * Every string/template-literal and JSX-text node's runtime text in a
 * source file — the same node-kind coverage as
 * lib/source-guard/scan.ts's determination-phrase scanner, minus that
 * scanner's `+`-concatenation handling (not needed here: a pasted-back
 * block would carry the ORIGINAL literals verbatim, not a hand-rebuilt
 * concatenation of them).
 */
function collectRuntimeStrings(sourceFile: SourceFile): string[] {
  const texts: string[] = [];
  sourceFile.forEachDescendant((node) => {
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
      if (
        isModuleSpecifierString(node) ||
        isObjectPropertyKey(node) ||
        isJsxAttributeValue(node)
      ) {
        return;
      }
      texts.push(node.getLiteralText());
      return;
    }
    if (Node.isTemplateExpression(node)) {
      texts.push(node.getHead().getLiteralText());
      for (const span of node.getTemplateSpans()) {
        texts.push(span.getLiteral().getLiteralText());
      }
      return;
    }
    if (Node.isJsxText(node)) {
      const text = node.getText().trim();
      if (text) texts.push(text);
    }
  });
  return texts;
}

/**
 * The shared component/hook's own distinctive copy — read live from its
 * source, never hand-maintained. Long enough (`MIN_SIGNATURE_LENGTH`) that
 * a match in a fork file is real evidence of a re-pasted block, not
 * coincidence.
 */
export function collectDrawnAreaSignatures(sharedSourceFiles: SourceFile[]): Set<string> {
  const signatures = new Set<string>();
  for (const sourceFile of sharedSourceFiles) {
    for (const text of collectRuntimeStrings(sourceFile)) {
      if (text.length >= MIN_SIGNATURE_LENGTH) signatures.add(text);
    }
  }
  return signatures;
}

export interface ForkParityViolation {
  filePath: string;
  kind: "missing-shared-import" | "local-signature-text";
  detail: string;
}

export interface ReportActionForkParityViolation {
  filePath: string;
  kind:
    | "missing-shared-action-import"
    | "missing-shared-action-render"
    | "local-action-copy"
    | "local-vacancy-predicate";
  detail: string;
}

/**
 * Does this fork file import EVERY shared drawn-area module — not just
 * one? A fork could drop the renderer import while keeping the hook (stop
 * calling `VacancySpreadsheetSection`, implement different JSX with no
 * exact signature string carried over) and still pass an `.some()` check;
 * only requiring every entry closes that loophole (Codex review finding on
 * the first version of this guard).
 */
function importsAllSharedDrawnAreaModules(sourceFile: SourceFile): boolean {
  const imported = new Set(
    sourceFile.getImportDeclarations().map((decl) => decl.getModuleSpecifierValue()),
  );
  return SHARED_DRAWN_AREA_MODULE_SPECIFIERS.every((specifier) => imported.has(specifier));
}

/**
 * Check one fork file: it must import the shared module(s), and must not
 * locally contain any of the shared component's own signature copy (a
 * paste-back would carry that text along with it).
 */
export function checkForkFileParity(
  forkSourceFile: SourceFile,
  signatures: Set<string>,
): ForkParityViolation[] {
  const violations: ForkParityViolation[] = [];
  const filePath = forkSourceFile.getFilePath();

  if (!importsAllSharedDrawnAreaModules(forkSourceFile)) {
    violations.push({
      filePath,
      kind: "missing-shared-import",
      detail:
        "Fork file does not import every shared drawn-area module " +
        `(${SHARED_DRAWN_AREA_MODULE_SPECIFIERS.join(", ")}).`,
    });
  }

  const localTexts = collectRuntimeStrings(forkSourceFile);
  for (const text of localTexts) {
    if (signatures.has(text)) {
      violations.push({
        filePath,
        kind: "local-signature-text",
        detail: `Fork file locally declares shared-component copy verbatim: ${JSON.stringify(text.slice(0, 80))}`,
      });
    }
  }

  return violations;
}

function importsSharedReportActionComponent(sourceFile: SourceFile): boolean {
  return sourceFile.getImportDeclarations().some((declaration) => {
    if (declaration.getModuleSpecifierValue() !== SHARED_REPORT_ACTION_MODULE_SPECIFIER) {
      return false;
    }
    return declaration
      .getNamedImports()
      .some((namedImport) => namedImport.getName() === SHARED_REPORT_ACTION_COMPONENT_NAME);
  });
}

function rendersSharedReportActionComponent(sourceFile: SourceFile): boolean {
  return sourceFile.getDescendants().some((node) => {
    if (Node.isJsxElement(node)) {
      return node.getOpeningElement().getTagNameNode().getText() === SHARED_REPORT_ACTION_COMPONENT_NAME;
    }
    return (
      Node.isJsxSelfClosingElement(node) &&
      node.getTagNameNode().getText() === SHARED_REPORT_ACTION_COMPONENT_NAME
    );
  });
}

function locallyDeclaredPolicyNames(sourceFile: SourceFile): string[] {
  const declared = new Set<string>();
  sourceFile.forEachDescendant((node) => {
    if (Node.isVariableDeclaration(node) || Node.isFunctionDeclaration(node)) {
      const name = node.getName();
      if (name && (REPORT_ACTION_POLICY_NAMES as readonly string[]).includes(name)) {
        declared.add(name);
      }
    }
  });
  return [...declared];
}

/**
 * Generic report action recurrence guard. The live/shared and saved forks must
 * delegate the complete action-label and share-gating contract to one shared
 * component instead of locally rebuilding any part of it.
 */
export function checkReportActionForkParity(
  forkSourceFile: SourceFile,
): ReportActionForkParityViolation[] {
  const violations: ReportActionForkParityViolation[] = [];
  const filePath = forkSourceFile.getFilePath();

  if (!importsSharedReportActionComponent(forkSourceFile)) {
    violations.push({
      filePath,
      kind: "missing-shared-action-import",
      detail: `Fork file does not import ${SHARED_REPORT_ACTION_COMPONENT_NAME} from ${SHARED_REPORT_ACTION_MODULE_SPECIFIER}.`,
    });
  }

  if (!rendersSharedReportActionComponent(forkSourceFile)) {
    violations.push({
      filePath,
      kind: "missing-shared-action-render",
      detail: `Fork file does not render <${SHARED_REPORT_ACTION_COMPONENT_NAME} />.`,
    });
  }

  const runtimeStrings = new Set(collectRuntimeStrings(forkSourceFile));
  for (const signature of REPORT_ACTION_RUNTIME_SIGNATURES) {
    if (runtimeStrings.has(signature)) {
      violations.push({
        filePath,
        kind: "local-action-copy",
        detail: `Fork file locally declares shared report-action copy: ${JSON.stringify(signature)}.`,
      });
    }
  }

  for (const name of locallyDeclaredPolicyNames(forkSourceFile)) {
    violations.push({
      filePath,
      kind: "local-vacancy-predicate",
      detail: `Fork file locally declares ${name} instead of using the shared action policy.`,
    });
  }

  return violations;
}

/**
 * The same action-copy and policy-redeclaration sweep, applied to a report
 * surface component that is NOT one of the two forks.
 *
 * Deliberately weaker than `checkReportActionForkParity` in one direction:
 * most components under components/report/ render no action row at all, so
 * this does not demand the shared import/render — only that nothing here
 * REBUILDS the row's copy or the policy it delegates to.
 */
export function checkReportSurfaceActionCopy(
  sourceFile: SourceFile,
): ReportActionForkParityViolation[] {
  const violations: ReportActionForkParityViolation[] = [];
  const filePath = sourceFile.getFilePath();

  const runtimeStrings = new Set(collectRuntimeStrings(sourceFile));
  for (const signature of REPORT_ACTION_RUNTIME_SIGNATURES) {
    if (runtimeStrings.has(signature)) {
      violations.push({
        filePath,
        kind: "local-action-copy",
        detail:
          `Report surface locally declares shared report-action copy: ${JSON.stringify(signature)}. ` +
          `Render <${SHARED_REPORT_ACTION_COMPONENT_NAME} /> instead of rebuilding the row.`,
      });
    }
  }

  for (const name of locallyDeclaredPolicyNames(sourceFile)) {
    violations.push({
      filePath,
      kind: "local-vacancy-predicate",
      detail: `Report surface locally declares ${name} instead of importing it from @/lib/report-action-policy.`,
    });
  }

  return violations;
}

/**
 * Every swept report surface: every `.tsx` under `REPORT_SURFACE_ROOTS`,
 * RECURSIVELY, minus the copy owners and minus tests (a test may
 * legitimately assert on the copy).
 *
 * Recursive and content-addressed rather than one directory: the row can be
 * rebuilt anywhere a button can be rendered, and the previous single-
 * directory scan missed components/map/MapPolygonPanel.tsx for exactly that
 * reason. Known-unmigrated rows are still RETURNED here — they are swept,
 * and the paired test holds them on a shrink-only list rather than hiding
 * them from the scan.
 */
export function collectReportSurfaceFilePaths(rootDir: string): string[] {
  const owners = new Set<string>(REPORT_ACTION_COPY_OWNERS);
  const skipped = new Set<string>(REPORT_SURFACE_SKIPPED_DIRS);
  const found: string[] = [];

  const walk = (relDir: string): void => {
    for (const entry of readdirSync(`${rootDir}/${relDir}`, { withFileTypes: true })) {
      const relPath = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!skipped.has(entry.name)) walk(relPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".tsx") && !owners.has(relPath)) {
        found.push(relPath);
      }
    }
  };

  for (const root of REPORT_SURFACE_ROOTS) walk(root);

  return found.sort();
}

export function buildForkParityProject(rootDir: string): {
  project: Project;
  forkSourceFiles: SourceFile[];
  sharedSourceFiles: SourceFile[];
} {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });

  const forkSourceFiles = FORK_FILE_PATHS.map((relPath) =>
    project.addSourceFileAtPath(`${rootDir}/${relPath}`),
  );
  const sharedSourceFiles = SHARED_DRAWN_AREA_MODULE_PATHS.map((relPath) =>
    project.addSourceFileAtPath(`${rootDir}/${relPath}`),
  );

  return { project, forkSourceFiles, sharedSourceFiles };
}
