/**
 * lib/source-guard/scan.ts — build-spec.md 2.8 (M3 AST-aware source guard).
 *
 * AST-based scan for determination phrases in RUNTIME STRING POSITIONS
 * only: string literals, template literals (including per-span text so an
 * interpolated template like `You already qualify for ${x}` is caught),
 * JSX text, and string-only `+` concatenation chains (so a phrase split
 * across adjacent literals, e.g. `"you " + "qualify for this"`, cannot
 * evade a per-literal check). Comments and identifiers are never visited —
 * ts-morph's AST does not expose comment text as string/template/JSX
 * nodes, so excluding those node kinds is sufficient; no separate
 * "strip comments" step is needed the way build-spec.md 2.6's own
 * belt-and-suspenders source check does for a plain-text regex sweep.
 *
 * Explicitly NOT runtime content, and skipped: import/export module
 * specifiers, bare `require("...")` arguments, and object-literal
 * PROPERTY KEYS (a StringLiteral used as `{"foo": ...}`'s key, not its
 * value) — none of these are ever rendered or serialized as a claim.
 */
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { findDeterminationPhraseMatch } from "./determination-phrases";

export interface SourceGuardViolation {
  filePath: string;
  line: number;
  text: string;
  phraseId: string;
}

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
  if (!parent) return false;
  if (Node.isPropertyAssignment(parent)) {
    return parent.getNameNode() === node;
  }
  return false;
}

/** Flatten a `+`-only chain of string/template literals into its joined
 *  literal text, or null if any operand isn't a plain literal (a variable
 *  or function-call operand makes the resulting text non-static, so it's
 *  left to the individual-node checks instead of a fabricated join). */
function flattenLiteralConcatenation(node: Node): string | null {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
    const left = flattenLiteralConcatenation(node.getLeft());
    const right = flattenLiteralConcatenation(node.getRight());
    if (left === null || right === null) return null;
    return left + right;
  }
  return null;
}

function pushIfViolation(
  violations: SourceGuardViolation[],
  filePath: string,
  node: Node,
  text: string,
): void {
  const match = findDeterminationPhraseMatch(text);
  if (match) {
    violations.push({
      filePath,
      line: node.getStartLineNumber(),
      text,
      phraseId: match.id,
    });
  }
}

/** Scan one already-parsed source file for determination-phrase violations. */
export function scanSourceFileForDeterminationPhrases(sourceFile: SourceFile): SourceGuardViolation[] {
  const violations: SourceGuardViolation[] = [];
  const filePath = sourceFile.getFilePath();
  const seenBinaryRoots = new Set<Node>();

  sourceFile.forEachDescendant((node) => {
    if (Node.isStringLiteral(node)) {
      if (isModuleSpecifierString(node) || isObjectPropertyKey(node)) return;
      pushIfViolation(violations, filePath, node, node.getLiteralText());
      return;
    }

    if (Node.isNoSubstitutionTemplateLiteral(node)) {
      pushIfViolation(violations, filePath, node, node.getLiteralText());
      return;
    }

    if (Node.isTemplateExpression(node)) {
      // Each literal SPAN individually — catches a phrase sitting whole
      // inside one span of an interpolated template, e.g.
      // `You already qualify for ${program.name}.`
      pushIfViolation(violations, filePath, node, node.getHead().getLiteralText());
      for (const span of node.getTemplateSpans()) {
        pushIfViolation(violations, filePath, span, span.getLiteral().getLiteralText());
      }
      return;
    }

    if (Node.isJsxText(node)) {
      const text = node.getText().trim();
      if (text) pushIfViolation(violations, filePath, node, text);
      return;
    }

    if (
      Node.isBinaryExpression(node) &&
      node.getOperatorToken().getKind() === SyntaxKind.PlusToken &&
      !seenBinaryRoots.has(node.getParent() as Node)
    ) {
      // Only evaluate at the OUTERMOST binary `+` of a chain, so a 3-literal
      // concatenation isn't checked three times (once per nested node) —
      // walk up while the parent is still a `+` BinaryExpression.
      const parent = node.getParent();
      const parentIsPlusChain =
        parent && Node.isBinaryExpression(parent) && parent.getOperatorToken().getKind() === SyntaxKind.PlusToken;
      if (!parentIsPlusChain) {
        const joined = flattenLiteralConcatenation(node);
        if (joined !== null) {
          seenBinaryRoots.add(node);
          pushIfViolation(violations, filePath, node, joined);
        }
      }
    }
  });

  return violations;
}

const DEFAULT_SCAN_ROOTS = ["app", "components", "lib"];

/** Real-project source files under app/, components/, lib/ — .ts/.tsx only,
 *  excluding test files themselves (the guard protects what SHIPS, not the
 *  test suite that checks it) and this module's own directory (a phrase
 *  list necessarily CONTAINS the phrases it's matching against). */
export function buildSourceGuardProject(rootDir: string): { project: Project; sourceFiles: SourceFile[] } {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });

  for (const root of DEFAULT_SCAN_ROOTS) {
    project.addSourceFilesAtPaths([
      `${rootDir}/${root}/**/*.ts`,
      `${rootDir}/${root}/**/*.tsx`,
      `!${rootDir}/${root}/**/__tests__/**`,
      `!${rootDir}/${root}/**/*.test.ts`,
      `!${rootDir}/${root}/**/*.test.tsx`,
      `!${rootDir}/lib/source-guard/**`,
    ]);
  }

  return { project, sourceFiles: project.getSourceFiles() };
}
