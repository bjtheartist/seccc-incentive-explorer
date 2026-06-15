import { describe, expect, it } from "vitest";
import { MAP_PRESETS } from "../map-helpers";
import { MOBILE_MAP_PRESETS } from "../map-layer-presets";

describe("map filter regression guardrails", () => {
  it("keeps the desktop quick presets aligned to the sector-style filters", () => {
    expect(MAP_PRESETS.map((preset) => preset.label)).toEqual([
      "City",
      "State",
      "Federal",
      "Environmental",
      "Zoning",
      "Vacancy",
    ]);

    expect(MAP_PRESETS.map((preset) => preset.label)).not.toContain("What Applies Here");
    expect(MAP_PRESETS.map((preset) => preset.label)).not.toContain("Common Incentives");
    expect(MAP_PRESETS.map((preset) => preset.label)).not.toContain("Developer Stack");
    expect(MAP_PRESETS.map((preset) => preset.label)).not.toContain("All Layers");
  });

  it("keeps mobile quick filters in sync with desktop presets", () => {
    expect(MOBILE_MAP_PRESETS.map((preset) => preset.id)).toEqual(
      MAP_PRESETS.map((preset) => preset.id),
    );
    expect(MOBILE_MAP_PRESETS.map((preset) => preset.label)).toEqual(
      MAP_PRESETS.map((preset) => preset.label),
    );
  });

  it("keeps NOF past winners contextual instead of standalone", () => {
    for (const preset of MAP_PRESETS) {
      expect(preset.zones).not.toBe("all");
      expect(preset.zones ?? []).not.toContain("nofFundedProjects");
    }

    expect(MAP_PRESETS.find((preset) => preset.id === "city")?.zones).toContain("nof");
  });

  it("keeps restored federal and environmental layers reachable from filters", () => {
    expect(MAP_PRESETS.find((preset) => preset.id === "federal")?.zones).toEqual(
      expect.arrayContaining(["hubzone", "energyCommunities", "brownfields"]),
    );
    expect(MAP_PRESETS.find((preset) => preset.id === "environmental")?.zones).toEqual(
      expect.arrayContaining(["brownfields", "lustSites", "countyIncentiveParcels"]),
    );
  });
});
