/**
 * build-spec.md 2.2 (audit F9): quiz facts had drifted from the catalog —
 * §48D was quizzed as 25% (catalog: 35%, and 35% wasn't even a choice), EDA
 * Build to Scale invented a specific "late summer 2026" NOFO date the
 * catalog explicitly says is not announced, and MMRP/CNRP's down-payment
 * figure was quizzed as $30K (catalog: $15,000).
 *
 * review5 S6: this file only ever checked hand-picked IDs (`find(22)`), so
 * a SECOND, independent §48D-rate-drift at id 92 sat undetected as long as
 * this file existed — the exact "not selected IDs" gap the coordinator
 * named. Kept as-is (still a real, still-passing regression guard for
 * these three specific facts), but the actual "no drift anywhere" property
 * is now covered by lib/__tests__/quiz-and-answers-scan.test.ts, which
 * scans EVERY item in the full QUIZ_QUESTIONS bank, not selected IDs.
 */
import { describe, expect, it } from "vitest";
import { QUIZ_QUESTIONS_EXTENSION } from "../quiz-bank-extension";
import { programFact } from "../program-fact";

function find(id: number) {
  const q = QUIZ_QUESTIONS_EXTENSION.find((item) => item.id === id);
  if (!q) throw new Error(`quiz question id ${id} not found`);
  return q;
}

describe("quiz-bank-extension — catalog-matched facts (F9)", () => {
  it("§48D credit rate matches the catalog (35%), and 35% is an actual choice", () => {
    const catalogRate = programFact("chips48d", (p) => p.benefit.summary);
    expect(catalogRate).toContain("35%");
    const q = find(22);
    expect(q.choices).toContain("35%");
    expect(q.choices[q.correctIndex]).toBe("35%");
    expect(q.explanation).toContain("35%");
  });

  it("EDA Build to Scale explanation does not invent an announced NOFO date the catalog says doesn't exist", () => {
    const nextWindow = programFact("edaBuildToScale", (p) => p.intake.nextWindow);
    expect(nextWindow?.expected).toBeNull();
    const q = QUIZ_QUESTIONS_EXTENSION.find((item) =>
      item.question.includes("EDA Build to Scale grants"),
    );
    expect(q).toBeDefined();
    expect(q!.explanation).not.toMatch(/expected late summer 2026/i);
  });

  it("MMRP/CNRP down-payment figure matches the catalog ($15,000), not the stale $30K", () => {
    const catalogRange = programFact("microMarketRecovery", (p) => p.benefit.summary);
    expect(catalogRange).toContain("$15,000");
    const mmrpQuestions = QUIZ_QUESTIONS_EXTENSION.filter((q) =>
      q.explanation.includes("MMRP") || q.explanation.includes("Micro Market Recovery"),
    );
    expect(mmrpQuestions.length).toBeGreaterThan(0);
    for (const q of mmrpQuestions) {
      expect(q.explanation).not.toContain("$30K down-payment");
    }
  });
});
