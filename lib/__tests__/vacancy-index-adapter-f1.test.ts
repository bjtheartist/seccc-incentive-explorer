/**
 * build-spec.md 2.4 — F1 binding replacement copy (audit's clearest
 * prohibited determination, explicitly packaged as partner-safe PDF copy).
 * "already qualifies for programs" must never appear; the exact binding
 * frame must.
 */
import { describe, expect, it } from "vitest";
import { buildDecisions } from "../vacancy-index-adapter";
import type { VacancyIndexEdition } from "../vacancy-index";

function makeEdition(overrides: Partial<VacancyIndexEdition["headline"]> = {}): VacancyIndexEdition {
  return {
    zip: "60617",
    neighborhood: "South Chicago",
    secondaryAreas: [],
    editionNumber: 1,
    headline: {
      vacantPropertyCount: 10,
      vacantLandCount: 4,
      vacantBuildingCount: 6,
      cityOwnedCount: 0,
      inIncentiveZoneCount: 8,
      ...overrides,
    },
    ownership: {
      vacantLandParcelsByOwnerType: null,
      vacantLandParcelTotal: null,
      trackedInventoryByOwnerType: [],
      reconciledVacantLandByOwnerType: null,
      reconciliation: null,
      structureBreakdown: null,
    },
    distress: null,
    exemptionAnomalies: null,
    sitePoints: [],
    sitePointsTruncated: false,
    siteIndex: [],
    landPoints: null,
  } as unknown as VacancyIndexEdition;
}

describe("buildDecisions — F1 binding copy", () => {
  it("never asserts a location 'already qualifies for programs'", () => {
    const decisions = buildDecisions(makeEdition({ cityOwnedCount: 0, vacantBuildingCount: 0 }), "2026-08-13T00:00:00.000Z");
    const text = decisions.map((d) => d.body).join("\n");
    expect(text).not.toMatch(/already qualifies for/i);
  });

  it("uses the exact F1 binding frame when leading with incentive context", () => {
    const decisions = buildDecisions(makeEdition({ cityOwnedCount: 0, vacantBuildingCount: 0 }), "2026-08-13T00:00:00.000Z");
    const incentiveDecision = decisions.find((d) => d.title === "Lead with the incentive context");
    expect(incentiveDecision).toBeDefined();
    expect(incentiveDecision!.body).toContain("tracked site points intersect at least one boundary in the Explorer dataset");
    expect(incentiveDecision!.body).toContain("do not establish eligibility, current intake, or an award");
    expect(incentiveDecision!.body).toContain("(revision 2026-08-13)");
  });

  it("omits the revision parenthetical rather than fabricating a date when none is supplied", () => {
    const decisions = buildDecisions(makeEdition({ cityOwnedCount: 0, vacantBuildingCount: 0 }));
    const incentiveDecision = decisions.find((d) => d.title === "Lead with the incentive context");
    expect(incentiveDecision!.body).not.toMatch(/\(revision/);
  });
});
