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
