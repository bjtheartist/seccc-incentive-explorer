/**
 * lib/source-guard/fork-parity.ts — fork parity: drawn-area surfaces are
 * shared components only.
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
 * signatures the guard checks for change with it automatically.
 */
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

/** Does this fork file import at least one of the shared drawn-area modules? */
function importsSharedDrawnAreaModule(sourceFile: SourceFile): boolean {
  return sourceFile.getImportDeclarations().some((decl) => {
    const specifier = decl.getModuleSpecifierValue();
    return (SHARED_DRAWN_AREA_MODULE_SPECIFIERS as readonly string[]).includes(specifier);
  });
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

  if (!importsSharedDrawnAreaModule(forkSourceFile)) {
    violations.push({
      filePath,
      kind: "missing-shared-import",
      detail:
        "Fork file does not import any of the shared drawn-area modules " +
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
