/* ── Gov-level taxonomy ─────────────────────── */

import type { ProgramLevel } from "./types";

export const LEVELS: ProgramLevel[] = [
  "Federal",
  "State",
  "County",
  "City",
  "Utility",
];

/** Display color per gov level. Used by LevelBadge and map legend chips. */
export const LEVEL_COLORS: Record<ProgramLevel, string> = {
  Federal: "#1d4ed8", // deep navy-blue
  State:   "#7c3aed", // IL purple
  County:  "#16a34a", // green
  City:    "#d97706", // accent amber
  Utility: "#0891b2", // teal
};

/** Short caption used in tooltips. */
export const LEVEL_DESCRIPTIONS: Record<ProgramLevel, string> = {
  Federal: "Administered by a U.S. federal agency (IRS, HUD, CDFI Fund, SBA, EDA, Treasury).",
  State:   "Administered by Illinois (DCEO, IDOR, IHDA) or another state agency.",
  County:  "Administered by Cook County (Assessor, Bureau of Economic Development, Land Bank).",
  City:    "Administered by the City of Chicago (DPD, DOH, delegate agencies).",
  Utility: "Administered by a regulated utility (ComEd, Peoples Gas) — not a government program.",
};

/* ── Zone metadata ─────────────────────────── */

export interface ZoneMeta {
  isPublic: boolean;
  defaultVisible: boolean;
  sortOrder: number;
  group: "city" | "state" | "federal" | "historic" | "census";
  /** Gov-level taxonomy (Phase 2). One zone layer may serve programs at multiple levels — `jurisdictions` lists them when so. */
  level: ProgramLevel;
  jurisdictions?: ProgramLevel[];
  /** Set when the boundary file is a proxy and should be flagged in the UI. */
  boundaryDisclaimer?: string;
}

export const ZONE_META: Record<string, ZoneMeta> = {
  tif:                 { isPublic: true, defaultVisible: true,  sortOrder: 1,  group: "city",     level: "City" },
  ssa:                 { isPublic: true, defaultVisible: true,  sortOrder: 2,  group: "city",     level: "City" },
  enterprise:          { isPublic: true, defaultVisible: true,  sortOrder: 3,  group: "state",    level: "State" },
  federalOZ:           { isPublic: true, defaultVisible: true,  sortOrder: 4,  group: "federal",  level: "Federal", jurisdictions: ["Federal", "State"] },
  stateIncentiveZones: { isPublic: true, defaultVisible: true,  sortOrder: 5,  group: "state",    level: "State", boundaryDisclaimer: "Proxy boundary — REV / EDGE / MICRO / Data Center programs are project-by-project, not zone-based. The polygon shown is a high-unemployment census-tract approximation." },
  nof:                 { isPublic: true, defaultVisible: false, sortOrder: 6,  group: "city",     level: "City" },
  highUnemployment:    { isPublic: true, defaultVisible: false, sortOrder: 7,  group: "federal",  level: "Federal" },
  industrialCorridors: { isPublic: true, defaultVisible: false, sortOrder: 8,  group: "city",     level: "City" },
  microMarketRecovery: { isPublic: true, defaultVisible: false, sortOrder: 9,  group: "city",     level: "City" },
  nmtcEligible:        { isPublic: true, defaultVisible: false, sortOrder: 10, group: "federal",  level: "Federal" },
  qct:                 { isPublic: true, defaultVisible: false, sortOrder: 11, group: "federal",  level: "Federal" },
  landmarkDistricts:   { isPublic: true, defaultVisible: false, sortOrder: 12, group: "historic", level: "City", jurisdictions: ["City", "County"] },
  nrhpDistricts:       { isPublic: true, defaultVisible: false, sortOrder: 13, group: "historic", level: "Federal" },
  ccsa:                { isPublic: true, defaultVisible: false, sortOrder: 14, group: "city",     level: "City" },
};

/** Zone keys sorted by display order. */
export const ZONE_KEYS_SORTED = Object.entries(ZONE_META)
  .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
  .map(([key]) => key);

export const ZONE_COLORS: Record<string, string> = {
  tif: "#2563eb",
  federalOZ: "#7c3aed",
  enterprise: "#059669",
  stateIncentiveZones: "#d97706",
  ssa: "#16a34a",
  highUnemployment: "#ea580c",
  ccsa: "#e11d48",
  industrialCorridors: "#64748b",
  microMarketRecovery: "#f59e0b",
  nof: "#10b981",
  nmtcEligible: "#8b5cf6",
  qct: "#ec4899",
  landmarkDistricts: "#a16207",
  nrhpDistricts: "#b45309",
};

export const ZONE_LABELS: Record<string, string> = {
  tif: "TIF District",
  federalOZ: "Opportunity Zone (Federal & State)",
  enterprise: "Enterprise Zone",
  stateIncentiveZones: "State Incentive Zone (EDGE/REV/MICRO/Data Center)",
  ssa: "Special Service Area",
  highUnemployment: "High Unemployment Zone",
  ccsa: "CCSA Commercial Corridor",
  industrialCorridors: "Industrial Corridor",
  microMarketRecovery: "Micro Market Recovery",
  nof: "Neighborhood Opportunity Fund",
  nmtcEligible: "NMTC Eligible Census Tract",
  qct: "Qualified Census Tract (HUD)",
  landmarkDistricts: "Chicago Landmark District",
  nrhpDistricts: "National Register Historic District",
};

export const ZONE_KEYS = Object.keys(ZONE_LABELS);

/** Short descriptions of what each zone/program means. */
export const ZONE_DESCRIPTIONS: Record<string, string> = {
  tif: "Tax Increment Financing redirects property-tax growth to fund public improvements in designated districts.",
  federalOZ: "Federal tax incentive that defers and reduces capital gains taxes for investments in low-income census tracts. Illinois supports OZ projects through DCEO grants and scoring preferences, not a separate state OZ income-tax deduction.",
  enterprise: "State-designated areas offering tax credits, sales tax exemptions, and utility tax exemptions for qualifying businesses.",
  stateIncentiveZones: "Census tracts eligible for Illinois EDGE (job creation credits), REV (EV/clean energy), MICRO (semiconductor), and Data Center tax incentives.",
  ssa: "Locally funded service areas where businesses self-tax to fund streetscaping, marketing, and security improvements.",
  highUnemployment: "Census tracts with unemployment rates significantly above the national average, triggering additional federal eligibility.",
  ccsa: "City corridor activation program that may provide reimbursable support for storefront improvements and technical assistance in selected commercial corridors. Application status and eligible corridors should be verified with Chicago DPD.",
  industrialCorridors: "City-designated corridors preserved for manufacturing, logistics, and industrial uses with zoning protections.",
  microMarketRecovery: "Department of Housing program focused on home purchase and rehab assistance in designated Micro Market Recovery areas.",
  nof: "City grants for commercial and industrial projects in underinvested neighborhoods on Chicago's South and West Sides.",
  nmtcEligible: "Census tracts eligible for New Markets Tax Credits, a federal program for investments in low-income communities.",
  qct: "HUD-designated census tracts where 50%+ of households earn below 60% of area median income, boosting LIHTC credits.",
  landmarkDistricts: "Chicago-designated historic districts where property owners may access local preservation tax incentives.",
  nrhpDistricts: "Federally recognized historic districts qualifying for the 20% federal Historic Tax Credit on certified rehab costs.",
};

/** Learn-more URLs for each zone type. */
export const ZONE_LEARN_MORE: Record<string, string> = {
  tif: "https://www.chicago.gov/city/en/depts/dcd/provdrs/tif.html",
  federalOZ: "https://www.irs.gov/credits-deductions/businesses/opportunity-zones",
  enterprise: "https://dceo.illinois.gov/expandrelocate/incentives/taxassistance/enterprisezone.html",
  stateIncentiveZones: "https://dceo.illinois.gov/expandrelocate/incentives/edge.html",
  ssa: "https://www.chicago.gov/city/en/depts/dcd/provdrs/sba.html",
  highUnemployment: "https://www.bls.gov/lau/",
  ccsa: "https://www.chicago.gov/city/en/depts/dcd/supp_info/ccsa.html",
  industrialCorridors: "https://www.chicago.gov/city/en/depts/dcd/supp_info/industrial-corridors.html",
  microMarketRecovery: "https://www.chicago.gov/city/en/depts/doh/provdrs/lenders/svcs/micro-market-recovery-program.html",
  nof: "https://www.chicago.gov/city/en/depts/dcd/provdrs/nof.html",
  nmtcEligible: "https://www.cdfifund.gov/programs-training/programs/new-markets-tax-credit",
  qct: "https://www.huduser.gov/portal/datasets/qct.html",
  landmarkDistricts: "https://www.chicago.gov/city/en/depts/dcd/provdrs/landmark.html",
  nrhpDistricts: "https://www.nps.gov/subjects/nationalregister/index.htm",
};

/* ── Chicago Zoning Code Reference ─────────── */
// Based on the Chicago Zoning Ordinance (Title 17).
// The number after the dash indicates density/intensity (higher = more dense).

export const ZONING_CATEGORIES = [
  { key: "residential",   label: "Residential",          prefixes: ["RS", "RT", "RM"], color: "#7ED321" },
  { key: "commercial",    label: "Business/Commercial",  prefixes: ["C", "B"],         color: "#4A90D9" },
  { key: "manufacturing", label: "Manufacturing",        prefixes: ["M"],              color: "#BD10E0" },
  { key: "pd",            label: "Planned Development",  prefixes: ["PD", "PMD"],      color: "#F5A623" },
  { key: "downtown",      label: "Downtown",             prefixes: ["DX", "DC", "DS"], color: "#D0021B" },
  { key: "parks",         label: "Parks & Open Space",   prefixes: ["POS"],            color: "#417505" },
  { key: "transport",     label: "Transportation",       prefixes: ["T"],              color: "#9B9B9B" },
] as const;

export const ZONING_CODE_DESCRIPTIONS: Record<string, string> = {
  // Residential
  "RS-1": "Residential Single-Unit (Detached House, 6,250+ sq ft lot)",
  "RS-2": "Residential Single-Unit (Detached House, 4,000 sq ft lot)",
  "RS-3": "Residential Single-Unit (Detached House, 2,500 sq ft lot)",
  "RT-3.5": "Residential Two-Flat, Townhouse & Multi-Unit (low density)",
  "RT-4": "Residential Two-Flat, Townhouse & Multi-Unit",
  "RM-4.5": "Residential Multi-Unit (low-medium density)",
  "RM-5": "Residential Multi-Unit (medium density)",
  "RM-5.5": "Residential Multi-Unit (medium-high density)",
  "RM-6": "Residential Multi-Unit (high density)",
  "RM-6.5": "Residential Multi-Unit (very high density)",
  // Business / Commercial
  "B1-1": "Neighborhood Shopping (low intensity)",
  "B1-1.5": "Neighborhood Shopping (low-medium intensity)",
  "B1-2": "Neighborhood Shopping (medium intensity)",
  "B1-3": "Neighborhood Shopping (high intensity)",
  "B1-5": "Neighborhood Shopping (very high intensity)",
  "B2-1": "Neighborhood Mixed-Use (low intensity)",
  "B2-2": "Neighborhood Mixed-Use (medium intensity)",
  "B2-3": "Neighborhood Mixed-Use (high intensity)",
  "B2-5": "Neighborhood Mixed-Use (very high intensity)",
  "B3-1": "Community Shopping (low intensity)",
  "B3-2": "Community Shopping (medium intensity)",
  "B3-3": "Community Shopping (high intensity)",
  "B3-5": "Community Shopping (very high intensity)",
  "C1-1": "Neighborhood Commercial (low intensity)",
  "C1-2": "Neighborhood Commercial (medium intensity)",
  "C1-3": "Neighborhood Commercial (high intensity)",
  "C1-5": "Neighborhood Commercial (very high intensity)",
  "C2-1": "Motor Vehicle-Related Commercial (low intensity)",
  "C2-2": "Motor Vehicle-Related Commercial (medium intensity)",
  "C2-3": "Motor Vehicle-Related Commercial (high intensity)",
  "C2-5": "Motor Vehicle-Related Commercial (very high intensity)",
  "C3-1": "Commercial, Manufacturing & Employment (low intensity)",
  "C3-2": "Commercial, Manufacturing & Employment (medium intensity)",
  "C3-3": "Commercial, Manufacturing & Employment (high intensity)",
  "C3-5": "Commercial, Manufacturing & Employment (very high intensity)",
  // Manufacturing
  "M1-1": "Limited Manufacturing/Business Park (low intensity)",
  "M1-2": "Limited Manufacturing/Business Park (medium intensity)",
  "M1-3": "Limited Manufacturing/Business Park (high intensity)",
  "M2-1": "Light Industry (low intensity)",
  "M2-2": "Light Industry (medium intensity)",
  "M2-3": "Light Industry (high intensity)",
  "M3-3": "Heavy Industry",
  // Downtown
  "DX-3": "Downtown Mixed-Use (low density)",
  "DX-5": "Downtown Mixed-Use (medium density)",
  "DX-7": "Downtown Mixed-Use (high density)",
  "DX-12": "Downtown Mixed-Use (very high density)",
  "DX-16": "Downtown Mixed-Use (highest density)",
  "DC-12": "Downtown Core (high density)",
  "DC-16": "Downtown Core (highest density)",
  "DS-3": "Downtown Service (low density)",
  "DS-5": "Downtown Service (medium density)",
  // Parks & Open Space
  "POS-1": "Parks & Open Space (regional/community park)",
  "POS-2": "Parks & Open Space (neighborhood park/playground)",
  // Transportation
  "T": "Transportation (rail, expressway, airports)",
};

/** Resolve a zone_class like "RS-3" or "PD 70" to a human-readable description. */
export function describeZoneClass(zoneClass: string): string {
  if (ZONING_CODE_DESCRIPTIONS[zoneClass]) return ZONING_CODE_DESCRIPTIONS[zoneClass];
  if (zoneClass.startsWith("PMD")) return `Planned Manufacturing District #${zoneClass.replace(/^PMD\s*/, "")}`;
  if (zoneClass.startsWith("PD")) return `Planned Development #${zoneClass.replace(/^PD\s*/, "")}`;
  for (const cat of ZONING_CATEGORIES) {
    for (const prefix of cat.prefixes) {
      if (zoneClass.startsWith(prefix)) return cat.label;
    }
  }
  return "Zoning District";
}

/* ── Vacant Property Layer Constants ─────── */

export const VACANT_COLORS: Record<string, string> = {
  vacantLand: "#DC2626",       // red
  vacantBuildings: "#EA580C",  // orange
};

export const VACANT_LABELS: Record<string, string> = {
  vacantLand: "City-Owned Vacant Land",
  vacantBuildings: "Vacant Buildings",
};

export const SSA50_BBOX = {
  minLon: -87.615,
  minLat: 41.718,
  maxLon: -87.540,
  maxLat: 41.770,
};

/**
 * Mapbox vector tileset IDs for city-wide zone layers.
 * Upload city-wide GeoJSON to Mapbox Studio → Tilesets, then add IDs here.
 * Format: "mapbox://username.tileset_id"
 * Leave empty string to fall back to raw GeoJSON source (SSA #50 only).
 */
export const ZONE_TILESET_IDS: Record<string, string> = {
  tif: "",
  federalOZ: "",
  enterprise: "",
  stateIncentiveZones: "",
  ssa: "",
  highUnemployment: "",
  ccsa: "",
  industrialCorridors: "",
  microMarketRecovery: "",
  nof: "",
  nmtcEligible: "",
  qct: "",
  landmarkDistricts: "",
  nrhpDistricts: "",
};
