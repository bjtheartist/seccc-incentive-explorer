/**
 * Per-program SEO title/description overrides for the demand-validated programs.
 *
 * Source: demand-validation fan-out (Google autocomplete, 2026-06-22) —
 * `~/Desktop/CIE-Product-Roadmap/03_demand_validation.md`. People search the
 * BARE program name (and the geo qualifier that actually validated), NOT a
 * uniform "[program] chicago" template. Key data-driven fixes:
 *   - C-PACE validates on "c-pace illinois", NOT "c-pace chicago".
 *   - Industrial Corridor validates on "industrial corridor chicago" — drop
 *     the dataset's "Protections" suffix from the title.
 *   - Enterprise Zone / Opportunity Zone / TIF front-load the searched phrasing.
 *
 * Programs without an override keep the default template in
 * app/programs/[slug]/page.tsx. The brand is appended by the layout title
 * template, so titles here omit "| Chicago Incentive Explorer".
 */

export interface ProgramSeoOverride {
  /** Full <title> for the page (keyword front-loaded). */
  title?: string;
  /** Meta description override (~150 chars). */
  description?: string;
}

export const PROGRAM_SEO_OVERRIDES: Record<string, ProgramSeoOverride> = {
  sbif: {
    title:
      "Small Business Improvement Fund (SBIF) Chicago: Eligibility & Address Lookup",
  },
  tif: {
    title: "Chicago TIF Districts: Map, Eligibility & Address Lookup",
  },
  nof: {
    title:
      "Neighborhood Opportunity Fund (NOF) Chicago: Eligible Areas & Grants",
  },
  ssa: {
    title: "Special Service Area (SSA) Chicago: Map & Address Lookup",
  },
  microMarketRecovery: {
    title:
      "Micro Market Recovery Program (MMRP): Eligibility & Address Lookup",
  },
  enterprise: {
    title: "Enterprise Zone Chicago: Eligibility, Map & Address Lookup",
  },
  federalOZ: {
    title: "Opportunity Zone Chicago (Federal): Map & Address Lookup",
  },
  illinoisOZ: {
    title: "Opportunity Zone Chicago (Illinois): Map & Address Lookup",
  },
  industrialCorridors: {
    title: "Industrial Corridors in Chicago: Map, Zoning & Address Lookup",
  },
  cpace: {
    title:
      "C-PACE Financing in Illinois (Cook County): Eligibility & Address Lookup",
  },
};

export function getProgramSeoOverride(
  programId: string,
): ProgramSeoOverride | undefined {
  return PROGRAM_SEO_OVERRIDES[programId];
}
