import { describe, expect, it } from "vitest";
import { inferPersonaFromIntake } from "@/lib/persona-inference";

describe("inferPersonaFromIntake", () => {
  it("industry=realEstate infers developer", () => {
    expect(inferPersonaFromIntake({ industry: "realEstate" })).toBe("developer");
  });

  it("a development-shaped goal infers developer even without the industry signal", () => {
    for (const goal of ["new-construction", "mixed-use", "affordable-housing", "vacant-acquisition"]) {
      expect(inferPersonaFromIntake({ projectGoals: [goal] })).toBe("developer");
    }
  });

  it("dev-feasibility / corridor-intelligence report types infer supporter, unless a stronger developer signal wins first", () => {
    expect(inferPersonaFromIntake({ reportType: "dev-feasibility" })).toBe("supporter");
    expect(inferPersonaFromIntake({ reportType: "corridor-intelligence" })).toBe("supporter");
    expect(
      inferPersonaFromIntake({ reportType: "dev-feasibility", industry: "realEstate" }),
    ).toBe("developer");
  });

  it("a relocation goal infers starting", () => {
    expect(inferPersonaFromIntake({ projectGoals: ["relocation"] })).toBe("starting");
  });

  it("defaults to growing when a real (if otherwise-unmatched) goal was actually answered", () => {
    expect(inferPersonaFromIntake({ reportType: "site-incentives", projectGoals: ["hiring"] })).toBe("growing");
  });

  // Gate finding 9/10: genuinely empty input (no industry, no goal, no
  // reportType) used to default to "growing" — a bare guess with no real
  // signal behind it. It now infers "looking": this repo's intake wizard
  // has no explicit "just looking" option (verified against
  // SITE_PROJECT_TYPE_OPTIONS — none exists), but its own goal-selection
  // step already invites skipping ("skip ahead if you are still
  // exploring"), so a visitor who answered nothing genuinely IS that case.
  it("infers 'looking' for genuinely empty intake — no industry, no goal, no reportType", () => {
    expect(inferPersonaFromIntake({})).toBe("looking");
    expect(inferPersonaFromIntake({ industry: null, projectGoals: null, projectType: null, reportType: null })).toBe(
      "looking",
    );
  });

  it("projectType is treated the same as a single-element projectGoals entry", () => {
    expect(inferPersonaFromIntake({ projectType: "new-construction" })).toBe("developer");
    expect(inferPersonaFromIntake({ projectType: "relocation" })).toBe("starting");
  });
});
