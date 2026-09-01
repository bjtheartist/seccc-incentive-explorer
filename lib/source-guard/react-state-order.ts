/**
 * lib/source-guard/react-state-order.ts — derive a component's `useState`
 * call order from source.
 *
 * app/report/__tests__/report-page-live-renderer.test.tsx renders the live
 * /report route with `react`'s `useState` patched to a shared module-level
 * counter, seeding each call from a pre-ordered array. That works — the
 * repo has no DOM environment, so effects never run and there is no other
 * way to force a rendered report into view — but the seed array is
 * HAND-MAINTAINED, and the harness's own comment admits the failure mode:
 * an added, removed, or reordered `useState` anywhere in the render path
 * desyncs every slot after it, and a same-shape swap (two adjacent
 * `useState(false)` calls trading places) desyncs SILENTLY. Eight of the
 * seeded slots do not even live in page.tsx — they are inside the shared
 * `useVacancySpreadsheetSection` hook, so an edit to a file the harness
 * never mentions can break it.
 *
 * This module reads the real call order out of the real source, so the
 * hand-maintained array can be checked against it. That converts the silent
 * desync into a loud, specific failure that names the harness and prints the
 * order it should hold.
 *
 * It reads TEXTUAL order inside each component body, which is exactly the
 * call order at render: the rules of hooks forbid a `useState` behind a
 * condition, a loop, or a nested closure, so top-level body order IS
 * execution order. A custom hook call is expanded in place — that is where
 * its own `useState` calls land in the shared counter.
 */
import { Node, Project, type FunctionDeclaration, type SourceFile } from "ts-morph";

/** A custom hook to expand in place, and the file that declares it. */
export interface ExpandableHook {
  /** Hook function name, as called (e.g. "useVacancySpreadsheetSection"). */
  name: string;
  /** Path of the declaring file, relative to the repo root. */
  filePath: string;
}

export interface StateOrderTarget {
  /** Path of the file declaring the component, relative to the repo root. */
  filePath: string;
  /** Component (or hook) function name whose body is walked. */
  functionName: string;
}

/**
 * The name bound by one `useState` call — the FIRST element of the array
 * destructure (`const [linkCopied, setLinkCopied] = useState(false)`).
 * A `useState` whose result is not array-destructured is reported by its
 * whole binding name, which is still a stable, readable slot label.
 */
function stateNameFromDeclaration(declaration: Node): string | null {
  if (!Node.isVariableDeclaration(declaration)) return null;
  const initializer = declaration.getInitializer();
  if (!initializer || !Node.isCallExpression(initializer)) return null;
  const callee = initializer.getExpression().getText();
  if (callee !== "useState" && !callee.endsWith(".useState")) return null;

  const nameNode = declaration.getNameNode();
  if (Node.isArrayBindingPattern(nameNode)) {
    const first = nameNode.getElements()[0];
    if (first && Node.isBindingElement(first)) return first.getName();
    return "(unnamed state slot)";
  }
  return nameNode.getText();
}

/** Is this statement a call to one of the hooks we expand in place? */
function expandedHookName(declaration: Node, hooks: ExpandableHook[]): string | null {
  if (!Node.isVariableDeclaration(declaration) && !Node.isExpressionStatement(declaration)) {
    return null;
  }
  const expression = Node.isVariableDeclaration(declaration)
    ? declaration.getInitializer()
    : declaration.getExpression();
  if (!expression || !Node.isCallExpression(expression)) return null;
  const callee = expression.getExpression().getText();
  return hooks.some((hook) => hook.name === callee) ? callee : null;
}

function findFunction(sourceFile: SourceFile, functionName: string): FunctionDeclaration {
  const declaration = sourceFile.getFunction(functionName);
  if (!declaration) {
    throw new Error(
      `No function named ${functionName} in ${sourceFile.getFilePath()} — ` +
        "the state-order derivation is looking at the wrong file or the " +
        "component was renamed.",
    );
  }
  return declaration;
}

/**
 * `useState` slot names in call order for one function body, expanding any
 * listed custom hook at its call site.
 *
 * Only TOP-LEVEL statements of the body are walked. A `useState` nested in a
 * callback would be a rules-of-hooks violation, and skipping nested closures
 * is what keeps unrelated inline handlers out of the slot list.
 */
function walkFunctionBody(
  declaration: FunctionDeclaration,
  hooks: ExpandableHook[],
  project: Project,
  rootDir: string,
  seen: Set<string>,
): string[] {
  const order: string[] = [];
  for (const statement of declaration.getStatements()) {
    if (Node.isVariableStatement(statement)) {
      for (const variableDeclaration of statement.getDeclarations()) {
        const stateName = stateNameFromDeclaration(variableDeclaration);
        if (stateName) {
          order.push(stateName);
          continue;
        }
        const hookName = expandedHookName(variableDeclaration, hooks);
        if (hookName) {
          order.push(...expandHook(hookName, hooks, project, rootDir, seen));
        }
      }
      continue;
    }
    if (Node.isExpressionStatement(statement)) {
      const hookName = expandedHookName(statement, hooks);
      if (hookName) {
        order.push(...expandHook(hookName, hooks, project, rootDir, seen));
      }
    }
  }
  return order;
}

function expandHook(
  hookName: string,
  hooks: ExpandableHook[],
  project: Project,
  rootDir: string,
  seen: Set<string>,
): string[] {
  if (seen.has(hookName)) {
    throw new Error(`Recursive hook expansion for ${hookName}.`);
  }
  const hook = hooks.find((candidate) => candidate.name === hookName);
  if (!hook) return [];
  const nextSeen = new Set(seen);
  nextSeen.add(hookName);
  const sourceFile = project.addSourceFileAtPath(`${rootDir}/${hook.filePath}`);
  return walkFunctionBody(
    findFunction(sourceFile, hookName),
    hooks,
    project,
    rootDir,
    nextSeen,
  );
}

/**
 * The full `useState` slot order across a render path, in the order the
 * shared counter sees them: each target's body in turn, custom hooks
 * expanded in place.
 */
export function deriveStateSlotOrder(
  rootDir: string,
  targets: readonly StateOrderTarget[],
  hooks: readonly ExpandableHook[] = [],
): string[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });
  const hookList = [...hooks];

  const order: string[] = [];
  for (const target of targets) {
    const sourceFile = project.addSourceFileAtPath(`${rootDir}/${target.filePath}`);
    order.push(
      ...walkFunctionBody(
        findFunction(sourceFile, target.functionName),
        hookList,
        project,
        rootDir,
        new Set(),
      ),
    );
  }
  return order;
}
