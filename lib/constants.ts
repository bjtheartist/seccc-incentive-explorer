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
  group: "city" | "county" | "state" | "federal" | "historic" | "census" | "environmental";
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
  brownfields:         { isPublic: true, defaultVisible: false, sortOrder: 15, group: "environmental", level: "Federal" },
  energyCommunities:   { isPublic: true, defaultVisible: false, sortOrder: 16, group: "federal",  level: "Federal" },
  hubzone:             { isPublic: true, defaultVisible: false, sortOrder: 17, group: "federal",  level: "Federal" },
  lustSites:           { isPublic: true, defaultVisible: false, sortOrder: 18, group: "environmental", level: "State" },
  nofFundedProjects:   { isPublic: true, defaultVisible: false, sortOrder: 19, group: "city",     level: "City" },
  countyIncentiveParcels: { isPublic: true, defaultVisible: false, sortOrder: 20, group: "county", level: "County" },
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
  brownfields: "#78350f",
  energyCommunities: "#0d9488",
  hubzone: "#0e7490",
  lustSites: "#991b1b",
  nofFundedProjects: "#047857",
  countyIncentiveParcels: "#4f46e5",
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
  brownfields: "Brownfield Site (EPA ACRES)",
  energyCommunities: "IRA Energy Community",
  hubzone: "SBA HUBZone",
  lustSites: "Leaking UST Site (Illinois EPA)",
  nofFundedProjects: "Past Grant Winners",
  countyIncentiveParcels: "Cook County Incentive Parcel",
};

export const ZONE_KEYS = Object.keys(ZONE_LABELS);

export const POINT_DATA_ZONE_KEYS = [
  "brownfields",
  "lustSites",
  "nofFundedProjects",
  "countyIncentiveParcels",
];

export const CHECKABLE_ZONE_KEYS = ZONE_KEYS.filter(
  (key) => !POINT_DATA_ZONE_KEYS.includes(key)
);

/** Short descriptions of what each zone/program means. */
export const ZONE_DESCRIPTIONS: Record<string, string> = {
  tif: "Tax Increment Financing redirects property-tax growth to fund public improvements in designated districts.",
  federalOZ: "Federal tax incentive that defers and reduces capital gains taxes for investments in low-income census tracts. Illinois supports OZ projects through DCEO grants and scoring preferences, not a separate state OZ income-tax deduction.",
  enterprise: "State-designated areas offering tax credits, sales tax exemptions, and utility tax exemptions for qualifying businesses.",
  // consult item 12 (build-spec.md 2.4): this boundary is a proxy — REV,
  // EDGE, MICRO, and Data Center are negotiated, project-by-project state
  // programs, not zone-gated. The polygon is a high-unemployment-tract
  // approximation the Explorer uses to surface those programs for review,
  // not a boundary the programs themselves are gated by.
  stateIncentiveZones: "A high-unemployment-tract proxy boundary the Explorer uses to surface Illinois EDGE, REV, MICRO, and Data Center incentives for review. These are negotiated, project-by-project state programs, not zone-gated — being inside this boundary does not by itself determine eligibility.",
  ssa: "Locally funded service areas where businesses self-tax to fund streetscaping, marketing, and security improvements.",
  // consult item 12: an information overlay, not itself an eligibility
  // trigger — WOTC's Empowerment-Zone-residency category is one of several
  // non-geographic target groups, and the credit's authorizing statute has
  // lapsed as of this catalog's last verification.
  highUnemployment: "Census tracts with unemployment rates significantly above the national average — an information overlay used by some federal programs' target-group criteria, not itself an eligibility trigger.",
  ccsa: "City corridor activation program that may provide reimbursable support for storefront improvements and technical assistance in selected commercial corridors. Application status and eligible corridors should be verified with Chicago DPD.",
  industrialCorridors: "City-designated corridors preserved for manufacturing, logistics, and industrial uses with zoning protections.",
  microMarketRecovery: "Department of Housing program focused on home purchase and rehab assistance in designated Micro Market Recovery areas.",
  nof: "City reimbursement grants for qualifying commercial projects on NOF eligible and priority corridors on Chicago's South, Southwest, and West Sides.",
  nmtcEligible: "Census tracts designated for New Markets Tax Credits, a federal program for investments in low-income communities.",
  qct: "HUD-designated census tracts where 50%+ of households earn below 60% of area median income, boosting LIHTC credits.",
  landmarkDistricts: "Chicago-designated historic districts where property owners may access local preservation tax incentives.",
  nrhpDistricts: "Federally recognized historic districts. A property here may qualify for review under the 20% federal Historic Tax Credit on certified rehabilitation costs, subject to Secretary of the Interior's Standards review and the building being income-producing.",
  brownfields: "Former industrial or commercial properties tracked in EPA's brownfields program (ACRES). Redevelopment may qualify for EPA assessment/cleanup grants and Illinois Site Remediation Program tax credits.",
  energyCommunities: "Clean energy projects located in an IRA energy community can receive a 10 percentage point bonus on the federal Investment Tax Credit or a 10% Production Tax Credit boost, subject to IRS rules and project eligibility.",
  hubzone: "Small businesses with a principal office in a HUBZone, and at least 35% of employees living in one, can compete for federal contract set-asides and receive a 10% price preference in full and open bidding.",
  lustSites: "Leaking underground storage tank incidents reported to the Illinois EPA, a key environmental due-diligence flag when buying or leasing property. Open incidents may mean unresolved contamination; closed sites have received a No Further Remediation letter.",
  nofFundedProjects: "Businesses that already won Neighborhood Opportunity Fund grants, with award amounts and addresses. Funded projects near your location show the program has paid out in the corridor.",
  countyIncentiveParcels: "Parcels holding a Cook County Assessor incentive classification, such as Class 6b, 7a, 7b, 8, 9, or Class C, that can reduce assessed value for eligible projects.",
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
  nof: "https://www.chicago.gov/city/en/sites/neighborhood-opportunity-fund/home.html",
  nmtcEligible: "https://www.cdfifund.gov/programs-training/programs/new-markets-tax-credit",
  qct: "https://www.huduser.gov/portal/datasets/qct.html",
  landmarkDistricts: "https://www.chicago.gov/city/en/depts/dcd/provdrs/landmark.html",
  nrhpDistricts: "https://www.nps.gov/subjects/nationalregister/index.htm",
  brownfields: "https://www.epa.gov/brownfields",
  energyCommunities: "https://energycommunities.gov/energy-community-tax-credit-bonus/",
  hubzone: "https://www.sba.gov/federal-contracting/contracting-assistance-programs/hubzone-program",
  lustSites: "https://epa.illinois.gov/topics/cleanup-programs/lust.html",
  nofFundedProjects: "https://www.chicago.gov/city/en/sites/neighborhood-opportunity-fund/home.html",
  countyIncentiveParcels: "https://www.cookcountyassessoril.gov/incentives-special-properties",
};

/* ── Chicago Zoning Code Reference ─────────── */
// Based on the Chicago Zoning Ordinance (Title 17).
// The number after the dash indicates density/intensity (higher = more dense).

export const ZONING_CATEGORIES = [
  { key: "residential",   label: "Residential",          prefixes: ["RS", "RT", "RM"], color: "#7ED321" },
  { key: "commercial",    label: "Business/Commercial",  prefixes: ["C", "B"],         color: "#4A90D9" },
  { key: "manufacturing", label: "Manufacturing",        prefixes: ["M"],              color: "#BD10E0" },
  { key: "pd",            label: "Planned Development",  prefixes: ["PD", "PMD"],      color: "#F5A623" },
  // "DR" (Downtown Residential) belongs with the other Title 17-4 downtown
  // districts. It was missing, so every DR-* parcel fell through to the "Other"
  // colour and appeared under no heading in the legend's code reference.
  { key: "downtown",      label: "Downtown",             prefixes: ["DX", "DC", "DS", "DR"], color: "#D0021B" },
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
  // DR-3/5/7/10 are the Downtown Residential classes carried in
  // data/curated/zoning/zoning-map-snapshot.json; without them the legend's
  // "What do the codes mean?" reference could not explain a DR parcel at all.
  "DR-3": "Downtown Residential (low density)",
  "DR-5": "Downtown Residential (medium density)",
  "DR-7": "Downtown Residential (high density)",
  "DR-10": "Downtown Residential (very high density)",
  // Parks & Open Space
  "POS-1": "Parks & Open Space (regional/community park)",
  "POS-2": "Parks & Open Space (neighborhood park/playground)",
  // Transportation
  "T": "Transportation (rail, expressway, airports)",
};

// describeZoneClass() was removed here. Its last caller (the report zoning-map
// hover tooltip) now prints the City's published zone_class verbatim, and the
// helper's final fallthrough returned the contentless label "Zoning District"
// for any code it did not know — a confident-sounding answer to a lookup that
// had in fact failed. Leaving it exported invited the next caller to reprint
// that. Surfaces needing a gloss should read ZONING_CODE_DESCRIPTIONS directly
// and render nothing when the code is absent.

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
  brownfields: "",
  energyCommunities: "",
  hubzone: "",
  lustSites: "",
  nofFundedProjects: "",
  countyIncentiveParcels: "",
};
