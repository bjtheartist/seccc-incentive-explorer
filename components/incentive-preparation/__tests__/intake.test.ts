import { describe, expect, it } from "vitest";
import {
  EMPTY_PREPARATION_INTAKE,
  buildFoundationPayload,
  buildPreparationPayload,
  normalizeGoalType,
  validateBusinessFileIntake,
  validatePreparationIntake,
} from "../intake";
import type { PreparationContext } from "../report-context";

describe("preparation intake", () => {
  it("maps report language to canonical workspace goals", () => {
    expect(normalizeGoalType("Improve storefront")).toBe("improve-storefront");
    expect(normalizeGoalType("Hire or retain employees")).toBe("hire-staff");
    expect(normalizeGoalType("buy-equipment")).toBe("buy-equipment");
    expect(normalizeGoalType("Something unrelated")).toBe("");
  });

  it("builds the packet API payload with top-level project context", () => {
    const context: PreparationContext = {
      projectId: "project-1",
      address: "9000 S Commercial Ave, Chicago, IL 60617",
      projectGoal: "Improve storefront",
      industry: "Retail",
      programs: [{ programId: "sbif", label: "Small Business Improvement Fund" }],
    };
    const draft = {
      ...EMPTY_PREPARATION_INTAKE,
      legalBusinessName: "South Shore Supply LLC",
      physicalAddress: context.address,
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
      formationDate: "2021-03-15",
      employeeCount: "8",
      primaryGoal: "improve-storefront",
      selectedProgramId: "sbif",
      selectedProgramLabel: "Small Business Improvement Fund",
    };

    expect(buildPreparationPayload(draft, "", context)).toMatchObject({
      goalType: "improve-storefront",
      programId: "sbif",
      programName: "Small Business Improvement Fund",
      projectId: "project-1",
      projectAddress: context.address,
      profile: {
        legalName: "South Shore Supply LLC",
        formationDate: "2021-03-15",
        employeeCount: 8,
      },
    });
  });

  it("requires the low-friction foundation and a valid email", () => {
    const errors = validatePreparationIntake({
      ...EMPTY_PREPARATION_INTAKE,
      contactEmail: "not-an-email",
    });

    expect(errors).toMatchObject({
      legalBusinessName: expect.any(String),
      physicalAddress: expect.any(String),
      contactName: expect.any(String),
      contactEmail: "Enter a valid contact email.",
      primaryGoal: expect.any(String),
      selectedProgramLabel: expect.any(String),
    });
  });

  it("validates a foundation-first Business File without a goal or program", () => {
    const validErrors = validateBusinessFileIntake({
      ...EMPTY_PREPARATION_INTAKE,
      legalBusinessName: "South Shore Supply LLC",
      physicalAddress: "9000 S Commercial Ave",
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
    });
    expect(validErrors).toEqual({});

    const missing = validateBusinessFileIntake({ ...EMPTY_PREPARATION_INTAKE });
    expect(missing).toMatchObject({
      legalBusinessName: expect.any(String),
      physicalAddress: expect.any(String),
      contactName: expect.any(String),
      contactEmail: expect.any(String),
    });
    // No goal or program is required for the foundation-first path.
    expect(missing.primaryGoal).toBeUndefined();
    expect(missing.selectedProgramLabel).toBeUndefined();
  });

  it("builds a foundation-only payload with no goal or program fields", () => {
    const draft = {
      ...EMPTY_PREPARATION_INTAKE,
      legalBusinessName: "South Shore Supply LLC",
      physicalAddress: "9000 S Commercial Ave",
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
    };

    const inlinePayload = buildFoundationPayload(draft, "", null);
    expect(inlinePayload).not.toHaveProperty("goalType");
    expect(inlinePayload).not.toHaveProperty("programName");
    expect(inlinePayload).toMatchObject({ profile: { legalName: "South Shore Supply LLC" } });

    const savedProfilePayload = buildFoundationPayload(draft, "profile-1", null);
    expect(savedProfilePayload).toMatchObject({ profileId: "profile-1" });
    expect(savedProfilePayload).not.toHaveProperty("profile");
  });
});
