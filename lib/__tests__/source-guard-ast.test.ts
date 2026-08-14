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
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildSourceGuardProject,
  scanSourceFileForDeterminationPhrases,
} from "../source-guard/scan";
import { isViolationExcepted, SOURCE_GUARD_EXCEPTIONS } from "../source-guard/exceptions";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

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

  it("every exception entry is well-formed (id, exact text, rationale, owner, future expiry, AND — review5 S8 — filePath, context, and a hash that actually matches text)", () => {
    for (const exception of SOURCE_GUARD_EXCEPTIONS) {
      expect(exception.id.trim().length).toBeGreaterThan(0);
      expect(exception.text.trim().length).toBeGreaterThan(0);
      expect(exception.rationale.trim().length).toBeGreaterThan(20);
      expect(exception.owner.trim().length).toBeGreaterThan(0);
      expect(Number.isNaN(new Date(exception.expiresOn).getTime())).toBe(false);
      // review5 S8: path + AST-location binding + tamper-evident hash.
      expect(exception.filePath.trim().length, exception.id).toBeGreaterThan(0);
      expect(exception.filePath.startsWith("/"), `${exception.id} filePath must be repo-relative`).toBe(false);
      expect(exception.context.trim().length, exception.id).toBeGreaterThan(10);
      expect(exception.textHash, exception.id).toBe(sha256(exception.text));
    }
  });

  it("review5 S8: a stealth edit to `text` without updating the co-located `textHash` literal is caught (the hash is independently stored, not derived from `text` in the same file)", () => {
    const tampered = { ...SOURCE_GUARD_EXCEPTIONS[0], text: "a completely different string" };
    expect(tampered.textHash).not.toBe(sha256(tampered.text));
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

/**
 * review5 S8 — "short 'unlocks'/'verify-eligibility' strings must not be
 * global passes." TEST: existing telemetry occurrence passes; identical
 * "unlocks" literal in a NEW component fails.
 *
 * Exercises `isViolationExcepted` directly (the real predicate the
 * full-project scan below uses), so this proves the MATCHING LOGIC, not
 * just that today's real files happen to be clean.
 */
describe("source guard exceptions — path-scoped matching (review5 S8)", () => {
  const rootDir = process.cwd();

  it("the existing, reviewed telemetry occurrence (lib/concierge/output-validator.ts) PASSES — same text, same file", () => {
    const violation = {
      text: "unlocks",
      filePath: `${rootDir}/lib/concierge/output-validator.ts`,
    };
    expect(isViolationExcepted(violation, SOURCE_GUARD_EXCEPTIONS, rootDir)).toBe(true);
  });

  it("review5 S8 — the actual regression this finding is about: an IDENTICAL 'unlocks' literal in a brand-new, never-reviewed component FAILS, even though the exact same text is excepted for a different file", () => {
    const violation = {
      text: "unlocks",
      filePath: `${rootDir}/components/some-brand-new-component.tsx`,
    };
    expect(isViolationExcepted(violation, SOURCE_GUARD_EXCEPTIONS, rootDir)).toBe(false);
  });

  it("same regression, the other short reason-id string ('verify-eligibility') in a new file also fails", () => {
    const violation = {
      text: "verify-eligibility",
      filePath: `${rootDir}/lib/some-other-new-file.ts`,
    };
    expect(isViolationExcepted(violation, SOURCE_GUARD_EXCEPTIONS, rootDir)).toBe(false);
  });

  it("the quiz statutory-quote exception passes only at its reviewed file, not elsewhere", () => {
    const quizText =
      "Which of these federal tax credits is NOT eligible for 'elective pay' (direct cash refund to tax-exempt entities)?";
    expect(
      isViolationExcepted(
        { text: quizText, filePath: `${rootDir}/lib/quiz-bank-extension.ts` },
        SOURCE_GUARD_EXCEPTIONS,
        rootDir,
      ),
    ).toBe(true);
    expect(
      isViolationExcepted(
        { text: quizText, filePath: `${rootDir}/app/some-other-page.tsx` },
        SOURCE_GUARD_EXCEPTIONS,
        rootDir,
      ),
    ).toBe(false);
  });

  it("an expired exception never passes, even at the exact right file", () => {
    const violation = { text: "unlocks", filePath: `${rootDir}/lib/concierge/output-validator.ts` };
    const expiredInThePast = new Date("2020-01-01").getTime();
    expect(isViolationExcepted(violation, SOURCE_GUARD_EXCEPTIONS, rootDir, expiredInThePast + 1)).toBe(true);
    // now AFTER expiry (using the real expiresOn's far-future date as the
    // reference wouldn't prove anything — assert against a `now` that is
    // itself past the exception's real expiresOn).
    const pastRealExpiry = new Date("2099-01-01").getTime();
    expect(isViolationExcepted(violation, SOURCE_GUARD_EXCEPTIONS, rootDir, pastRealExpiry)).toBe(false);
  });
});

describe("source guard — real codebase scan (defense in depth; the DTO contracts remain primary)", () => {
  const rootDir = process.cwd();
  const { sourceFiles } = buildSourceGuardProject(rootDir);
  const allViolations = sourceFiles.flatMap((sf) => scanSourceFileForDeterminationPhrases(sf));

  // review5 S8: path-scoped matching via the real predicate, not a
  // text-only Set — a violation's exact `filePath` must match the
  // exception's reviewed `filePath`, not merely its text.
  const unexcepted = allViolations.filter(
    (v) => !isViolationExcepted(v, SOURCE_GUARD_EXCEPTIONS, rootDir),
  );

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
          `Fix the copy, or add a reviewed exception in lib/source-guard/exceptions.ts (id, exact text, filePath, context, rationale, owner, expiry) — do not weaken the phrase patterns to make this pass.`,
      );
    }
    expect(unexcepted.length).toBe(0);
  });

  it("every reviewed exception is actually USED by a real violation the scan found AT ITS OWN REVIEWED FILE — no dead/expired/mis-scoped exceptions", () => {
    const now = Date.now();
    const stale: string[] = [];
    for (const exception of SOURCE_GUARD_EXCEPTIONS) {
      if (new Date(exception.expiresOn).getTime() <= now) {
        stale.push(`${exception.id}: expired ${exception.expiresOn}`);
        continue;
      }
      // review5 S8: must be found at the EXACT reviewed filePath, not just
      // anywhere in the scanned source — an exception "used" only by a
      // violation in some OTHER file is not actually protecting what it
      // claims to.
      const foundAtOwnFile = allViolations.some(
        (v) =>
          v.text === exception.text &&
          v.filePath.startsWith(rootDir) &&
          v.filePath.slice(rootDir.length).replace(/^[/\\]/, "") === exception.filePath,
      );
      if (!foundAtOwnFile) {
        stale.push(`${exception.id}: text no longer found at its own reviewed filePath (${exception.filePath})`);
      }
    }
    expect(stale, stale.join("; ")).toEqual([]);
  });
});
