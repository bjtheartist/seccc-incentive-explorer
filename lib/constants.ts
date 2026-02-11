export const ZONE_COLORS: Record<string, string> = {
  tif: "#2563eb",
  federalOZ: "#7c3aed",
  illinoisOZ: "#9333ea",
  enterprise: "#059669",
  edge: "#d97706",
  rev: "#dc2626",
  micro: "#0891b2",
  dataCenter: "#4f46e5",
  ssa: "#16a34a",
  tripleBenefit: "#be185d",
  highUnemployment: "#ea580c",
};

export const ZONE_LABELS: Record<string, string> = {
  tif: "TIF District",
  federalOZ: "Federal Opportunity Zone",
  illinoisOZ: "Illinois Opportunity Zone",
  enterprise: "Enterprise Zone",
  edge: "EDGE 100% Zone",
  rev: "REV Illinois Bonus",
  micro: "MICRO 100% Zone",
  dataCenter: "Data Center Bonus",
  ssa: "Special Service Area",
  tripleBenefit: "Triple Benefit Zone",
  highUnemployment: "High Unemployment Zone",
};

export const ZONE_KEYS = Object.keys(ZONE_LABELS);

export const SSA50_BBOX = {
  minLon: -87.615,
  minLat: 41.718,
  maxLon: -87.540,
  maxLat: 41.770,
};
