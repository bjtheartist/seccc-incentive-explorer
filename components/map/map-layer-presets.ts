export const MOBILE_MAP_PRESETS = [
  {
    id: "city",
    label: "City",
    description: "TIF, SSA, NOF, CCSA, industrial, and local corridor layers.",
  },
  {
    id: "state",
    label: "State",
    description: "Enterprise Zone, state incentive, and Illinois site layers.",
  },
  {
    id: "federal",
    label: "Federal",
    description: "OZ, NMTC, QCT, HUBZone, energy, and federal eligibility.",
  },
  {
    id: "environmental",
    label: "Environmental",
    description: "Brownfield, LUST, and energy-community context.",
  },
  {
    id: "zoning",
    label: "Zoning",
    description: "Zoning categories with parcel boundaries at close zoom.",
  },
  {
    id: "vacancy",
    label: "Vacancy",
    description: "Vacant buildings, lots, reports, and parcel context.",
  },
] as const;

export type MobileMapPreset = (typeof MOBILE_MAP_PRESETS)[number];
export type MobileMapPresetId = MobileMapPreset["id"];

/* ── Zone-layer preset groups (WP4) ─────────────────────────────
 *
 * The 20 configured zone layers in lib/constants.ts (ZONE_META / ZONE_LABELS)
 * are grouped into four client-approved toggles. Every zone key belongs to
 * EXACTLY ONE group — asserted in components/map/__tests__/map-regression.test.ts.
 *
 * These are distinct from MOBILE_MAP_PRESETS / MAP_PRESETS above: those are the
 * six sector quick-filters routed through MapView.applyPreset. The groups below
 * are applied by MapLegendPanel through the zone checkboxes it already owns
 * (onToggleZone), so no new MapView wiring and no new data reaches the client.
 */

/**
 * Zone layers that only exist nested under a parent layer in the legend.
 * components/map/MapView.tsx `toggleZone` refuses to raise the child while the
 * parent is hidden, so any group containing the child must also raise the
 * parent, and must do it in an earlier commit.
 */
export const NESTED_ZONE_PARENTS: Record<string, string> = {
  nofFundedProjects: "nof",
};

export const ZONE_LAYER_PRESETS = [
  {
    id: "grants-tax-increment",
    label: "Grants & Tax Increment",
    description:
      "TIF districts, Neighborhood Opportunity Fund, Special Service Areas, CCSA corridors, and Micro Market Recovery.",
    zones: ["tif", "nof", "ssa", "ccsa", "microMarketRecovery"],
    adminOnly: false,
  },
  {
    id: "tax-credits-opportunity-zones",
    label: "Tax Credits & Opportunity Zones",
    description:
      "Opportunity Zones, Enterprise Zones, state incentive zones, NMTC and QCT tracts, high unemployment, energy communities, and HUBZone.",
    zones: [
      "federalOZ",
      "enterprise",
      "stateIncentiveZones",
      "nmtcEligible",
      "qct",
      "highUnemployment",
      "energyCommunities",
      "hubzone",
    ],
    adminOnly: false,
  },
  {
    id: "real-estate-zoning-environmental",
    label: "Real Estate, Zoning & Environmental",
    description:
      "Industrial corridors, landmark and National Register districts, brownfields, leaking UST sites, and Cook County incentive parcels.",
    zones: [
      "industrialCorridors",
      "landmarkDistricts",
      "nrhpDistricts",
      "brownfields",
      "lustSites",
      "countyIncentiveParcels",
    ],
    adminOnly: false,
  },
  {
    /**
     * GOVERNANCE: this group never touches the Community Investment capital
     * layer or the public-capital overlays — those stay gated on
     * adminSessionActive exactly as they are today. Because the current UI
     * shows capital layers to admins only, the group itself does not render
     * for anonymous visitors. Past Grant Winners remains individually
     * reachable for everyone through its checkbox nested under NOF.
     */
    id: "public-capital-past-awards",
    label: "Public Capital & Past Awards",
    description: "Projects that already won Neighborhood Opportunity Fund dollars.",
    zones: ["nofFundedProjects"],
    adminOnly: true,
  },
] as const;

export type ZoneLayerPreset = (typeof ZONE_LAYER_PRESETS)[number];
export type ZoneLayerPresetId = ZoneLayerPreset["id"];

/** Structural shape the helpers below accept, so they stay usable in tests. */
export interface ZoneLayerPresetShape {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly zones: readonly string[];
  readonly adminOnly: boolean;
}

/**
 * Zone keys that must end up visible for a group: its own members plus the
 * parent of any nested member.
 */
export function zoneLayerPresetTargets(preset: ZoneLayerPresetShape): string[] {
  const targets: string[] = [];
  for (const key of preset.zones) {
    const parent = NESTED_ZONE_PARENTS[key];
    if (parent && !targets.includes(parent)) targets.push(parent);
    if (!targets.includes(key)) targets.push(key);
  }
  return targets;
}

export interface ZoneLayerPresetTogglePlan {
  /** Keys to hand to `onToggleZone` immediately. */
  now: string[];
  /**
   * Nested child keys that can only be raised once their parent is visible —
   * applied on the next commit, after `now` has landed in `zoneVisible`.
   */
  deferred: string[];
}

/**
 * Exclusive select: plan the `onToggleZone` calls that move `current` to the
 * group's selection with every other zone layer off. Pure so it can be unit
 * tested without a map or a DOM.
 */
export function planZoneLayerPresetToggles(
  preset: ZoneLayerPresetShape,
  current: Record<string, boolean>,
  zoneKeys: readonly string[]
): ZoneLayerPresetTogglePlan {
  const target = new Set(zoneLayerPresetTargets(preset));
  const nested = zoneKeys.filter((key) => NESTED_ZONE_PARENTS[key]);
  const standalone = zoneKeys.filter((key) => !NESTED_ZONE_PARENTS[key]);

  const now: string[] = [];
  const deferred: string[] = [];

  // Lower nested children before their parents, so a parent's cascade never
  // fights the plan.
  for (const key of nested) {
    if (Boolean(current[key]) && !target.has(key)) now.push(key);
  }
  for (const key of standalone) {
    if (Boolean(current[key]) !== target.has(key)) now.push(key);
  }
  for (const key of nested) {
    if (!current[key] && target.has(key)) deferred.push(key);
  }

  return { now, deferred };
}

/**
 * The group whose selection `current` exactly matches, if any. Derived rather
 * than stored, so using an individual checkbox clears the highlight on its own.
 */
export function activeZoneLayerPreset(
  current: Record<string, boolean>,
  zoneKeys: readonly string[]
): ZoneLayerPresetId | null {
  for (const preset of ZONE_LAYER_PRESETS) {
    const target = new Set(zoneLayerPresetTargets(preset));
    if (zoneKeys.every((key) => Boolean(current[key]) === target.has(key))) {
      return preset.id;
    }
  }
  return null;
}
