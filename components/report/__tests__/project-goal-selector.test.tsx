// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProjectGoalSelector } from "@/components/report/ProjectGoalSelector";

afterEach(() => {
  cleanup();
});

describe("ProjectGoalSelector — display read (gate review round 3, R3-6, pinning NEW-3's site)", () => {
  it("shows all 5 goals checked for a gate-produced 5-goal report — not truncated to 3", () => {
    render(
      <ProjectGoalSelector
        goals={["expansion", "equipment", "mixed-use", "affordable-housing", "rehab"]}
        customGoal=""
        onChange={vi.fn()}
      />,
    );
    for (const label of [
      "Expand current operations",
      "Buy equipment",
      "Mixed-use development",
      "Affordable housing",
      "Remodel or renovate",
    ]) {
      expect((screen.getByRole("checkbox", { name: label }) as HTMLInputElement).checked, label).toBe(
        true,
      );
    }
  });

  it("kills the reviewer's exact injection (.slice(0, 3) instead of MAX_ENGINE_GOALS) — a 4th goal must render checked", () => {
    render(
      <ProjectGoalSelector
        goals={["expansion", "equipment", "mixed-use", "affordable-housing"]}
        customGoal=""
        onChange={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("checkbox", { name: "Affordable housing" }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe("ProjectGoalSelector — counter and at-limit copy (gate review round 3, R3-2)", () => {
  it("normal case (≤3 goals): counter reads 'X/3' and the at-limit message says '3 goals selected.'", () => {
    render(
      <ProjectGoalSelector goals={["rehab", "hiring", "energy"]} customGoal="" onChange={vi.fn()} />,
    );
    expect(screen.getByText("3/3")).toBeTruthy();
    expect(screen.getByText("3 goals selected. Remove one to choose another.")).toBeTruthy();
  });

  it("a 4-goal seed never renders the nonsensical '4/3' — shows '4/4' instead", () => {
    render(
      <ProjectGoalSelector
        goals={["expansion", "equipment", "mixed-use", "affordable-housing"]}
        customGoal=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("4/3")).toBeNull();
    expect(screen.getByText("4/4")).toBeTruthy();
  });

  it("a 4-goal seed never renders the false 'Three goals selected.' — shows the real count instead", () => {
    render(
      <ProjectGoalSelector
        goals={["expansion", "equipment", "mixed-use", "affordable-housing"]}
        customGoal=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Three goals selected. Remove one to choose another.")).toBeNull();
    expect(screen.getByText("4 goals selected. Remove one to choose another.")).toBeTruthy();
  });

  it("a 5-goal seed shows '5/5' and '5 goals selected.'", () => {
    render(
      <ProjectGoalSelector
        goals={["expansion", "equipment", "mixed-use", "affordable-housing", "rehab"]}
        customGoal=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("5/5")).toBeTruthy();
    expect(screen.getByText("5 goals selected. Remove one to choose another.")).toBeTruthy();
  });

  it("fewer than 3 goals: no at-limit message at all, counter reads against the normal 3-goal cap", () => {
    render(<ProjectGoalSelector goals={["rehab"]} customGoal="" onChange={vi.fn()} />);
    expect(screen.getByText("1/3")).toBeTruthy();
    expect(screen.queryByText(/selected\. Remove one/)).toBeNull();
  });
});
