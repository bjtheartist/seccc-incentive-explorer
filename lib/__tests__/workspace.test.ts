import { describe, expect, it } from "vitest";
import {
  buildChecklist,
  goalLabel,
  GOAL_OPTIONS,
  isGoalType,
  normalizeChecklist,
} from "../workspace";

describe("workspace goals", () => {
  it("defines all MVP goal options", () => {
    expect(GOAL_OPTIONS.map((goal) => goal.id)).toEqual([
      "improve-storefront",
      "buy-equipment",
      "hire-staff",
      "expand-location",
      "open-relocate",
      "acquire-vacant-property",
      "development-feasibility",
    ]);
  });

  it("builds a default checklist for every goal", () => {
    for (const goal of GOAL_OPTIONS) {
      const checklist = buildChecklist(goal.id);
      expect(checklist.length).toBeGreaterThan(0);
      expect(checklist.every((item) => item.completed === false)).toBe(true);
      expect(goalLabel(goal.id)).toBe(goal.label);
    }
  });

  it("validates goal types", () => {
    expect(isGoalType("buy-equipment")).toBe(true);
    expect(isGoalType("not-a-goal")).toBe(false);
  });

  it("normalizes persisted checklist items", () => {
    expect(
      normalizeChecklist([
        { id: "a", label: "Collect bids", completed: true },
        { label: "Call partner" },
        { id: "bad" },
        null,
      ])
    ).toEqual([
      { id: "a", label: "Collect bids", completed: true },
      { id: "item-2", label: "Call partner", completed: false },
    ]);
  });
});
