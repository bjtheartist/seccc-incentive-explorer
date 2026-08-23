import { describe, expect, it } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { resolve } from "node:path";

// ─── Call-site fence for handlePrepareGatedReport (gate review round 3, ──
// MAJOR finding R3-A — the THIRD round flagging this exact gap).
//
// Rounds 1 and 2 both unit-tested `resolveGatePrepareGoals` in isolation
// and assumed that proved the real handler. It didn't: `onPrepareReport`
// is a `vi.fn()` in every `ReportEmailGate` test, so
// `app/report/page.tsx`'s `handlePrepareGatedReport` never actually
// executes in any test in this repo. The reviewer's round-3 injection
// (swap the `resolveGatePrepareGoals` call at line ~1803 for
// `selectedProjectGoals({ projectGoals })` + an inline JSON compare) left
// 3822 tests green.
//
// This test parses the REAL source file on disk with ts-morph (the same
// library `lib/public-claim-surfaces-verify.ts` already uses for
// executable AST checks in this repo) — not a copy, not a string
// heuristic — and asserts `handlePrepareGatedReport`'s actual function
// body calls `resolveGatePrepareGoals` and never calls
// `selectedProjectGoals` itself. A revert exactly like the reviewer's
// injection changes what identifiers appear in that body, so this test
// goes red on it.
//
// This is explicitly the FALLBACK the ruling allows ("if executing the
// real handler in jsdom is genuinely impossible") — see
// gate-prepare-engine-integration.test.tsx for the primary fix, which
// actually renders the real report page, clicks the real gate, and
// inspects the real outgoing request body.

const PAGE_FILE = resolve(__dirname, "../page.tsx");

function loadHandlerBodyText(): string {
  // No tsConfigFilePath: syntax-only parse, no full-program cost — but
  // page.tsx is JSX, so the parser needs jsx enabled or it mis-parses.
  const project = new Project({ compilerOptions: { jsx: 2 /* React */ } });
  const sourceFile = project.addSourceFileAtPath(PAGE_FILE);
  // `getVariableDeclarationOrThrow(name)` only finds MODULE-scope
  // declarations — `handlePrepareGatedReport` is declared inside the
  // (deeply nested) report-page component function body, so it has to be
  // found by walking every descendant declaration instead.
  const varDecl = sourceFile
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .find((decl) => decl.getName() === "handlePrepareGatedReport");
  if (!varDecl) {
    throw new Error(
      "handlePrepareGatedReport variable declaration not found in app/report/page.tsx",
    );
  }
  const initializer = varDecl.getInitializerOrThrow();
  const useCallbackCall = initializer.asKindOrThrow(SyntaxKind.CallExpression);
  expect(useCallbackCall.getExpression().getText()).toBe("useCallback");
  const [handlerArrowFn] = useCallbackCall.getArguments();
  if (!handlerArrowFn) throw new Error("useCallback() call has no arguments");
  return handlerArrowFn.getText();
}

function callExpressionNames(bodyText: string): string[] {
  const project = new Project();
  // Wrap the extracted arrow function in a throwaway statement so it can
  // be parsed standalone and its call expressions walked.
  const scratch = project.createSourceFile(
    "scratch.ts",
    `const __scratchHandler = ${bodyText};`,
  );
  return scratch
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .map((call) => call.getExpression().getText());
}

describe("app/report/page.tsx: handlePrepareGatedReport call-site fence (R3-A)", () => {
  it("the real source file still defines handlePrepareGatedReport as a useCallback", () => {
    expect(() => loadHandlerBodyText()).not.toThrow();
  });

  it("its body calls resolveGatePrepareGoals — the extracted, uncapped goal-resolve function", () => {
    const names = callExpressionNames(loadHandlerBodyText());
    expect(names).toContain("resolveGatePrepareGoals");
  });

  it("its body NEVER calls selectedProjectGoals directly (the capped wizard reader — this is the reviewer's exact injection target)", () => {
    const names = callExpressionNames(loadHandlerBodyText());
    expect(names).not.toContain("selectedProjectGoals");
  });

  it("its body does not reimplement the comparison inline via a raw JSON.stringify equality check (the reviewer's exact inline-compare fallback)", () => {
    const bodyText = loadHandlerBodyText();
    // A legitimate call to resolveGatePrepareGoals never needs its own
    // JSON.stringify anywhere in the calling body — that logic lives
    // entirely inside the extracted function now.
    expect(bodyText).not.toContain("JSON.stringify");
  });
});
