/**
 * build-spec.md 2.2 (audit F9): quiz facts had drifted from the catalog —
 * §48D was quizzed as 25% (catalog: 35%, and 35% wasn't even a choice), EDA
 * Build to Scale invented a specific "late summer 2026" NOFO date the
 * catalog explicitly says is not announced, and MMRP/CNRP's down-payment
 * figure was quizzed as $30K (catalog: $15,000).
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
    const catalogRate = programFact("chips48d", (p) => p.benefitRange);
    expect(catalogRate).toContain("35%");
    const q = find(22);
    expect(q.choices).toContain("35%");
    expect(q.choices[q.correctIndex]).toBe("35%");
    expect(q.explanation).toContain("35%");
  });

  it("EDA Build to Scale explanation does not invent an announced NOFO date the catalog says doesn't exist", () => {
    const nextWindow = programFact("edaBuildToScale", (p) => p.nextWindow);
    expect(nextWindow?.expected).toBeNull();
    const q = QUIZ_QUESTIONS_EXTENSION.find((item) =>
      item.question.includes("EDA Build to Scale grants"),
    );
    expect(q).toBeDefined();
    expect(q!.explanation).not.toMatch(/expected late summer 2026/i);
  });

  it("MMRP/CNRP down-payment figure matches the catalog ($15,000), not the stale $30K", () => {
    const catalogRange = programFact("microMarketRecovery", (p) => p.benefitRange);
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
