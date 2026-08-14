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
import { createHash } from "node:crypto";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { findDeterminationPhraseMatch } from "./determination-phrases";

export interface SourceGuardViolation {
  filePath: string;
  line: number;
  text: string;
  phraseId: string;
  /**
   * review6 S15 (MEDIUM): a stable AST-location fingerprint for the
   * VIOLATING NODE ITSELF — see `computeAstContextFingerprint` below.
   * Two occurrences of the identical `text` at two different AST
   * positions in the SAME file (different object property, different
   * array index, a different enclosing declaration) produce different
   * fingerprints. `lib/source-guard/exceptions.ts`'s
   * `isViolationExcepted` requires this to match an exception's own
   * `context` field exactly, in addition to `text`/`filePath` — a
   * reviewed exception for one specific literal-at-one-specific-location
   * no longer silently also covers the SAME literal appearing somewhere
   * else in that same file.
   */
  context: string;
  /**
   * review6 S15 (MEDIUM): `sha256(text)` hex digest, computed HERE by the
   * scanner from the actual violating text — independent of
   * `exceptions.ts`'s own separately-stored `textHash` literal (tamper-
   * evidence: the two must agree, but neither is derived from the
   * other in the same file). `isViolationExcepted` requires this to
   * match the exception's `textHash` too.
   */
  textHash: string;
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

/**
 * review6 S15 (MEDIUM) — builds a stable AST-location fingerprint for a
 * violating node by walking its ancestor chain and recording each
 * IDENTIFYING step (object property name, array index, JSX attribute
 * name, enclosing JSX tag, the nearest named declaration) until it
 * reaches a stopping point. Two occurrences of the identical literal
 * TEXT at two different positions in the same file take different paths
 * through the tree — different property name, different array index, a
 * different enclosing declaration — so they produce different
 * fingerprints. That's the exact property this finding needs: an
 * exception reviewed for one specific literal-at-one-specific-AST-
 * position must not silently also cover the same literal recurring
 * somewhere else in that file.
 *
 * Deliberately NOT a byte-offset or line/column position — those shift
 * on every unrelated edit above the node (adding a blank line, a new
 * import), which would make an exception spuriously expire on a totally
 * unrelated change. A property/index/declaration PATH is stable across
 * those edits and only changes when the violation's own structural
 * position actually changes — which is exactly when a fresh review is
 * warranted anyway.
 */
function computeAstContextFingerprint(node: Node): string {
  const steps: string[] = [];
  let current: Node = node;

  for (;;) {
    const parent = current.getParent();
    if (!parent) break;

    if (Node.isPropertyAssignment(parent) && parent.getInitializer() === current) {
      steps.unshift(`.${parent.getName()}`);
    } else if (Node.isShorthandPropertyAssignment(parent)) {
      steps.unshift(`.${parent.getName()}`);
    } else if (Node.isArrayLiteralExpression(parent)) {
      const idx = parent.getElements().findIndex((el) => el === current);
      steps.unshift(`[${idx}]`);
    } else if (Node.isCallExpression(parent) && parent.getArguments().some((a) => a === current)) {
      const argIdx = parent.getArguments().findIndex((a) => a === current);
      steps.unshift(`${parent.getExpression().getText()}(arg${argIdx})`);
    } else if (Node.isJsxAttribute(parent)) {
      steps.unshift(`@${parent.getNameNode().getText()}`);
    } else if (Node.isJsxExpression(parent)) {
      // A `{expr}` wrapper inside JSX — transparent, keep climbing past it
      // without recording a step (the JSX element/attribute above it is
      // the meaningful boundary).
    } else if (Node.isJsxElement(parent) || Node.isJsxSelfClosingElement(parent)) {
      const tagName = Node.isJsxElement(parent)
        ? parent.getOpeningElement().getTagNameNode().getText()
        : parent.getTagNameNode().getText();
      steps.unshift(`<${tagName}>`);
    } else if (Node.isVariableDeclaration(parent)) {
      steps.unshift(parent.getName());
      break;
    } else if (Node.isFunctionDeclaration(parent) && parent.getName()) {
      steps.unshift(`${parent.getName()}()`);
      break;
    } else if (Node.isPropertyDeclaration(parent) || Node.isMethodDeclaration(parent)) {
      steps.unshift(`${parent.getName()}()`);
      break;
    }

    if (Node.isSourceFile(parent)) break;
    current = parent;
  }

  return steps.join("") || "<root>";
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
      context: computeAstContextFingerprint(node),
      textHash: createHash("sha256").update(text, "utf8").digest("hex"),
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
