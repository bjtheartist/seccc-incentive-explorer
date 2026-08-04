import { describe, expect, it } from "vitest";
import { MAP_PRESETS } from "../map-helpers";
import {
  MOBILE_MAP_PRESETS,
  NESTED_ZONE_PARENTS,
  ZONE_LAYER_PRESETS,
  activeZoneLayerPreset,
  planZoneLayerPresetToggles,
  zoneLayerPresetTargets,
} from "../map-layer-presets";
import { ZONE_KEYS } from "@/lib/constants";

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

/* ── WP4: zone-layer groups ─────────────────────────────────── */

const allZonesOff = (): Record<string, boolean> =>
  Object.fromEntries(ZONE_KEYS.map((key) => [key, false]));

describe("zone layer preset groups", () => {
  it("partitions every configured zone layer into exactly one group", () => {
    const seen = new Map<string, string[]>();
    for (const preset of ZONE_LAYER_PRESETS) {
      for (const key of preset.zones) {
        seen.set(key, [...(seen.get(key) ?? []), preset.id]);
      }
    }

    // Every zone key in lib/constants.ts is covered...
    for (const key of ZONE_KEYS) {
      expect(seen.get(key), `${key} belongs to no layer group`).toBeDefined();
    }
    // ...exactly once...
    for (const [key, presetIds] of seen) {
      expect(presetIds, `${key} belongs to more than one layer group`).toHaveLength(1);
    }
    // ...and no group names a key that does not exist.
    expect([...seen.keys()].sort()).toEqual([...ZONE_KEYS].sort());

    const memberCount = ZONE_LAYER_PRESETS.reduce((sum, p) => sum + p.zones.length, 0);
    expect(memberCount).toBe(ZONE_KEYS.length);
    expect(ZONE_KEYS).toHaveLength(20);
  });

  it("keeps the client-approved four groups and their membership verbatim", () => {
    expect(ZONE_LAYER_PRESETS.map((preset) => preset.label)).toEqual([
      "Grants & Tax Increment",
      "Tax Credits & Opportunity Zones",
      "Real Estate, Zoning & Environmental",
      "Public Capital & Past Awards",
    ]);

    const zonesFor = (id: string) =>
      ZONE_LAYER_PRESETS.find((preset) => preset.id === id)?.zones;

    expect(zonesFor("grants-tax-increment")).toEqual([
      "tif",
      "nof",
      "ssa",
      "ccsa",
      "microMarketRecovery",
    ]);
    expect(zonesFor("tax-credits-opportunity-zones")).toEqual([
      "federalOZ",
      "enterprise",
      "stateIncentiveZones",
      "nmtcEligible",
      "qct",
      "highUnemployment",
      "energyCommunities",
      "hubzone",
    ]);
    expect(zonesFor("real-estate-zoning-environmental")).toEqual([
      "industrialCorridors",
      "landmarkDistricts",
      "nrhpDistricts",
      "brownfields",
      "lustSites",
      "countyIncentiveParcels",
    ]);
    expect(zonesFor("public-capital-past-awards")).toEqual(["nofFundedProjects"]);
  });

  it("gates only the past-awards group, and keeps its ids clear of the sector filters", () => {
    expect(
      ZONE_LAYER_PRESETS.filter((preset) => preset.adminOnly).map((preset) => preset.id),
    ).toEqual(["public-capital-past-awards"]);

    const sectorIds = MAP_PRESETS.map((preset) => preset.id);
    for (const preset of ZONE_LAYER_PRESETS) {
      expect(sectorIds).not.toContain(preset.id);
    }
  });

  it("raises the NOF parent alongside the nested past-winners layer", () => {
    expect(NESTED_ZONE_PARENTS.nofFundedProjects).toBe("nof");

    const pastAwards = ZONE_LAYER_PRESETS.find(
      (preset) => preset.id === "public-capital-past-awards",
    )!;
    expect(zoneLayerPresetTargets(pastAwards)).toEqual(["nof", "nofFundedProjects"]);

    // The nested child is never raised in the same batch as its parent —
    // components/map/MapView.tsx toggleZone refuses while the parent is hidden.
    const plan = planZoneLayerPresetToggles(pastAwards, allZonesOff(), ZONE_KEYS);
    expect(plan.now).toEqual(["nof"]);
    expect(plan.deferred).toEqual(["nofFundedProjects"]);
  });

  it("selects a group exclusively, clearing every non-member layer", () => {
    const current: Record<string, boolean> = {
      ...allZonesOff(),
      tif: true,
      qct: true,
      hubzone: true,
    };
    const taxCredits = ZONE_LAYER_PRESETS.find(
      (preset) => preset.id === "tax-credits-opportunity-zones",
    )!;
    const members: readonly string[] = taxCredits.zones;

    const plan = planZoneLayerPresetToggles(taxCredits, current, ZONE_KEYS);
    expect(plan.deferred).toEqual([]);
    // tif is off-target and on, so it flips off; qct/hubzone are already on and stay.
    expect(plan.now).toContain("tif");
    expect(plan.now).not.toContain("qct");
    expect(plan.now).not.toContain("hubzone");

    const next: Record<string, boolean> = { ...current };
    for (const key of plan.now) next[key] = !next[key];
    for (const key of ZONE_KEYS) {
      expect(Boolean(next[key]), key).toBe(members.includes(key));
    }
  });

  it("lowers a nested child before its parent when switching away", () => {
    const current = { ...allZonesOff(), nof: true, nofFundedProjects: true };
    const realEstate = ZONE_LAYER_PRESETS.find(
      (preset) => preset.id === "real-estate-zoning-environmental",
    )!;

    const plan = planZoneLayerPresetToggles(realEstate, current, ZONE_KEYS);
    expect(plan.deferred).toEqual([]);
    expect(plan.now.indexOf("nofFundedProjects")).toBeLessThan(plan.now.indexOf("nof"));
  });

  it("derives the active group from layer visibility alone", () => {
    expect(activeZoneLayerPreset(allZonesOff(), ZONE_KEYS)).toBeNull();

    const grants = ZONE_LAYER_PRESETS[0];
    const grantsOn = { ...allZonesOff() };
    for (const key of grants.zones) grantsOn[key] = true;
    expect(activeZoneLayerPreset(grantsOn, ZONE_KEYS)).toBe("grants-tax-increment");

    // One extra layer on by hand and the group is no longer active.
    expect(activeZoneLayerPreset({ ...grantsOn, qct: true }, ZONE_KEYS)).toBeNull();

    // Past awards matches only with its NOF parent raised too.
    expect(
      activeZoneLayerPreset({ ...allZonesOff(), nofFundedProjects: true }, ZONE_KEYS),
    ).toBeNull();
    expect(
      activeZoneLayerPreset(
        { ...allZonesOff(), nof: true, nofFundedProjects: true },
        ZONE_KEYS,
      ),
    ).toBe("public-capital-past-awards");
  });
});
