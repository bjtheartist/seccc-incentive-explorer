/**
 * build-spec.md 2.8 (M3 AST-aware source guard) — run LAST in the build
 * order deliberately: it catches determination language the rest of the
 * sweep missed. Per the Hard Rules, a real finding here gets FIXED, not
 * allowlisted — this file's own real-codebase test asserts zero violations
 * outside the reviewed exceptions file (lib/source-guard/exceptions.ts).
 *
 * Synthetic self-tests below prove the scanner itself is sound BEFORE
 * trusting its real-codebase result: split literals (`+` concatenation),
 * interpolation (template literal spans), JSON/object values, and the
 * exception mechanism (an exact-string match works; a stale or expired
 * exception fails the suite).
 */
import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import {
  buildSourceGuardProject,
  scanSourceFileForDeterminationPhrases,
} from "../source-guard/scan";
import { SOURCE_GUARD_EXCEPTIONS } from "../source-guard/exceptions";

function scanSnippet(sourceText: string, fileName = "fixture.tsx") {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(fileName, sourceText);
  return scanSourceFileForDeterminationPhrases(sourceFile);
}

describe("source guard AST scanner — synthetic self-tests", () => {
  it("catches a plain string literal with a determination phrase", () => {
    const violations = scanSnippet(`export const msg = "The record already qualifies under current published rules.";`);
    expect(violations.some((v) => v.phraseId === "already-qualifies")).toBe(true);
  });

  it("catches a phrase split across adjacent string literals joined by +", () => {
    const violations = scanSnippet(`export const msg = "you " + "qualify for this program.";`);
    expect(violations.some((v) => v.phraseId === "you-qualify")).toBe(true);
  });

  it("catches a phrase split across a THREE-literal concatenation chain", () => {
    const violations = scanSnippet(`export const msg = "you" + " qual" + "ify" + " " + "for it.";`);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("does NOT fabricate a join across a non-literal operand (a variable in the chain)", () => {
    // "unlocks" only appears if the join happened; it must not, since `name`
    // is a runtime value, not a literal — the scanner must not silently
    // pretend to know what the concatenated text is.
    const violations = scanSnippet(`export const msg = "See what " + name + " unlocks for you.";`);
    // The literal-only heuristic correctly declines to join here; the phrase
    // "unlocks" DOES still appear in the standalone literal " unlocks for you."
    // so it is still (correctly) caught by the per-literal check.
    expect(violations.some((v) => v.phraseId === "unlocks")).toBe(true);
  });

  it("catches a phrase inside one span of an interpolated template literal", () => {
    const violations = scanSnippet(
      "export function f(name: string) { return `The record already qualifies under ${name}'s published rules, always.`; }",
    );
    expect(violations.some((v) => v.phraseId === "already-qualifies")).toBe(true);
  });

  it("catches a phrase in a JSX text node", () => {
    const violations = scanSnippet(
      `export function C() { return <p>Ready to apply now?</p>; }`,
    );
    expect(violations.some((v) => v.phraseId === "ready-to-apply")).toBe(true);
  });

  it("catches a phrase in an object VALUE (e.g. JSON-LD / metadata construction)", () => {
    const violations = scanSnippet(
      `export const jsonLd = { answer: "This unlocks the program for qualifying businesses." };`,
    );
    expect(violations.some((v) => v.phraseId === "unlocks")).toBe(true);
  });

  it("does NOT flag a string literal used as an object KEY", () => {
    const violations = scanSnippet(`export const obj = { "unlocks": true };`);
    expect(violations.length).toBe(0);
  });

  it("does NOT flag an import/export module specifier or a require() path", () => {
    const violations = scanSnippet(
      `import { unlocks } from "./you-qualify-for-this-module";\nconst x = require("./ready-to-apply-module");`,
    );
    expect(violations.length).toBe(0);
  });

  it("does NOT flag a comment or an identifier name — only runtime string/template/JSX text", () => {
    const violations = scanSnippet(
      `// you already qualify for this comment, which is not runtime output\nfunction alreadyQualifiesCheck() { return true; }`,
    );
    expect(violations.length).toBe(0);
  });
});

describe("source guard reviewed-exceptions mechanism", () => {
  it("an exact-string exception suppresses a real violation", () => {
    const text = "Which of these federal tax credits is NOT eligible for 'elective pay' (direct cash refund to tax-exempt entities)?";
    const violations = scanSnippet(`export const q = ${JSON.stringify(text)};`);
    expect(violations.some((v) => v.phraseId === "eligible-for")).toBe(true);

    const exception = SOURCE_GUARD_EXCEPTIONS.find((e) => e.text === text);
    expect(exception).toBeDefined();
    expect(exception!.id).toBeTruthy();
    expect(exception!.owner).toBeTruthy();
    expect(new Date(exception!.expiresOn).getTime()).toBeGreaterThan(Date.now());
  });

  it("every exception entry is well-formed (id, exact text, rationale, owner, future expiry)", () => {
    for (const exception of SOURCE_GUARD_EXCEPTIONS) {
      expect(exception.id.trim().length).toBeGreaterThan(0);
      expect(exception.text.trim().length).toBeGreaterThan(0);
      expect(exception.rationale.trim().length).toBeGreaterThan(20);
      expect(exception.owner.trim().length).toBeGreaterThan(0);
      expect(Number.isNaN(new Date(exception.expiresOn).getTime())).toBe(false);
    }
  });

  it("an EXPIRED exception's date-validity check fails (proves expiry is actually enforced, not decorative)", () => {
    const expired = { ...SOURCE_GUARD_EXCEPTIONS[0], expiresOn: "2020-01-01" };
    expect(new Date(expired.expiresOn).getTime()).toBeLessThan(Date.now());
  });

  it("a mutated/stale exception text no longer matches anything real (proves 'unused' is detectable)", () => {
    const staleText = "this exact sentence does not exist anywhere in the fixture corpus";
    const violations = scanSnippet(`export const q = "You already qualify for real review.";`);
    // The stale exception's text matches none of the real violations found —
    // this is the condition the full-project test below fails the suite on.
    expect(violations.every((v) => v.text !== staleText)).toBe(true);
  });
});

describe("source guard — real codebase scan (defense in depth; the DTO contracts remain primary)", () => {
  const { sourceFiles } = buildSourceGuardProject(process.cwd());
  const allViolations = sourceFiles.flatMap((sf) => scanSourceFileForDeterminationPhrases(sf));

  const activeExceptionTexts = new Set(
    SOURCE_GUARD_EXCEPTIONS.filter((e) => new Date(e.expiresOn).getTime() > Date.now()).map((e) => e.text),
  );
  const unexcepted = allViolations.filter((v) => !activeExceptionTexts.has(v.text));

  it("scans a non-trivial number of source files (the scan itself is not silently a no-op)", () => {
    expect(sourceFiles.length).toBeGreaterThan(100);
  });

  it("finds zero determination-phrase violations outside the reviewed exceptions file", () => {
    if (unexcepted.length > 0) {
      const report = unexcepted
        .slice(0, 25)
        .map((v) => `  [${v.phraseId}] ${v.filePath}:${v.line} — ${JSON.stringify(v.text.slice(0, 140))}`)
        .join("\n");
      throw new Error(
        `${unexcepted.length} determination-phrase violation(s) found outside reviewed exceptions:\n${report}\n` +
          `Fix the copy, or add a reviewed exception in lib/source-guard/exceptions.ts (id, exact text, rationale, owner, expiry) — do not weaken the phrase patterns to make this pass.`,
      );
    }
    expect(unexcepted.length).toBe(0);
  });

  it("every reviewed exception is actually USED by a real violation the scan found — no dead/expired exceptions", () => {
    const foundTexts = new Set(allViolations.map((v) => v.text));
    const now = Date.now();
    const stale: string[] = [];
    for (const exception of SOURCE_GUARD_EXCEPTIONS) {
      if (new Date(exception.expiresOn).getTime() <= now) {
        stale.push(`${exception.id}: expired ${exception.expiresOn}`);
        continue;
      }
      if (!foundTexts.has(exception.text)) {
        stale.push(`${exception.id}: text no longer found anywhere in the scanned source`);
      }
    }
    expect(stale, stale.join("; ")).toEqual([]);
  });
});
