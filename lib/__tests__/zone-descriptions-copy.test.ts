/**
 * build-spec.md 2.4 (consult item 12): ZONE_DESCRIPTIONS (rendered in the
 * map legend and reports) must not collapse a proxy/context boundary into a
 * direct eligibility claim.
 */
import { describe, expect, it } from "vitest";
import { ZONE_DESCRIPTIONS } from "../constants";

describe("ZONE_DESCRIPTIONS — boundary-description, not eligibility, framing", () => {
  it("stateIncentiveZones does not claim tracts are 'eligible for' EDGE/REV/MICRO/Data Center", () => {
    expect(ZONE_DESCRIPTIONS.stateIncentiveZones).not.toMatch(/eligible for/i);
    expect(ZONE_DESCRIPTIONS.stateIncentiveZones).toMatch(/proxy/i);
    expect(ZONE_DESCRIPTIONS.stateIncentiveZones).toMatch(/not zone-gated/i);
  });

  it("highUnemployment does not claim the overlay itself triggers eligibility", () => {
    expect(ZONE_DESCRIPTIONS.highUnemployment).not.toMatch(/triggering additional federal eligibility/i);
  });

  it("nrhpDistricts hedges the Historic Tax Credit claim with 'may qualify for review', not a bare qualification", () => {
    expect(ZONE_DESCRIPTIONS.nrhpDistricts).toMatch(/may qualify for review/i);
    // "eligible for" is a source-guard-flagged claim phrase (build-spec.md 2.8) — must not reappear here.
    expect(ZONE_DESCRIPTIONS.nrhpDistricts).not.toMatch(/eligible for/i);
  });
});
