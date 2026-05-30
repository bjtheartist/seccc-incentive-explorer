export const MOBILE_MAP_PRESETS = [
  {
    id: "incentives",
    label: "Incentives",
    description: "Show core incentive zones and programs that may apply here.",
  },
  {
    id: "vacancy",
    label: "Vacancy",
    description: "Surface vacant buildings, lots, and parcel vacancy signals.",
  },
  {
    id: "zoning",
    label: "Zoning",
    description: "Focus the map on zoning categories and parcel context.",
  },
  {
    id: "community-assets",
    label: "Community Assets",
    description: "Highlight nearby transit, schools, libraries, and civic anchors.",
  },
] as const;

export type MobileMapPreset = (typeof MOBILE_MAP_PRESETS)[number];
export type MobileMapPresetId = MobileMapPreset["id"];
