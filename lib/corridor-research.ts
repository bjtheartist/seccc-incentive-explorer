/** Draft street scopes supplied for the September 24, 2026 research brief.
 * Endpoint names are preserved; these are not approved GIS boundaries.
 * Never allocate a ZIP total to one of these street segments.
 */
export const CORRIDOR_SCOPE_VERSION = "2026-09-24-draft-1";

export interface CorridorResearchScope {
  id: string;
  name: string;
  extent: string;
  boundaryQuestion: string;
}

export const CORRIDOR_RESEARCH_SCOPES: readonly CorridorResearchScope[] = [
  {
    id: "79th-street",
    name: "79th Street",
    extent: "Greenwood–Paxton",
    boundaryQuestion: "The request labels Greenwood eastern and Paxton western. Confirm direction, both street sides, and frontage depth.",
  },
  {
    id: "south-chicago-avenue",
    name: "South Chicago Avenue",
    extent: "72nd–87th",
    boundaryQuestion: "Follow the avenue; confirm frontage depth and intersection parcels.",
  },
  {
    id: "87th-street",
    name: "87th Street",
    extent: "Ingleside–South Chicago",
    boundaryQuestion: "Confirm the request’s east/west labels and endpoint intersection.",
  },
  {
    id: "95th-street",
    name: "95th Street",
    extent: "Woodlawn–Jeffery",
    boundaryQuestion: "Confirm the request’s east/west labels and frontage depth.",
  },
  {
    id: "stony-island-avenue",
    name: "Stony Island Avenue",
    extent: "79th–95th",
    boundaryQuestion: "Confirm both street sides and overlap with cross-street corridors.",
  },
  {
    id: "commercial-avenue",
    name: "Commercial Avenue",
    extent: "83rd–95th, including 2–3 blocks east/west where commercially zoned",
    boundaryQuestion: "Confirm the zoning footprint and exact side-street extent before drawing the polygon.",
  },
  {
    id: "ewing-avenue",
    name: "Ewing Avenue",
    extent: "101st–107th",
    boundaryQuestion: "Confirm frontage depth and intersection parcels.",
  },
  {
    id: "106th-street",
    name: "106th Street",
    extent: "Buffalo–Avenue H",
    boundaryQuestion: "Confirm east/west labels and overlap with Ewing Avenue.",
  },
];

export const CORRIDOR_RESEARCH_MEASURES = [
  { name: "Operating businesses and change", evidence: "Distinct operating locations, with openings and closures verified locally. License starts alone do not establish openings." },
  { name: "Storefront occupancy", evidence: "Occupied and vacant storefront units from a dated inventory. Show unknown status and survey coverage; vacant-class parcels are a separate measure." },
  { name: "Businesses assisted", evidence: "Unique businesses receiving substantive one-to-one help, with dated service records and completed referrals tracked separately." },
  { name: "Capital accessed", evidence: "Confirmed grant and loan disbursements to assisted businesses. Keep dollars, recipients, and transactions separate." },
  { name: "Assisted-business retention", evidence: "Verified operating status at 6 and 12 months for a fixed assistance cohort. Keep closed and unknown cases visible." },
  { name: "Physical reinvestment", evidence: "Commercial permits and reported costs, with verified completed improvement projects counted separately." },
] as const;
