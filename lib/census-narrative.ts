/**
 * Census Narrative Utility
 *
 * Transforms raw census numbers into interpreted, contextual narrative.
 * Explains what the numbers mean for business decisions and program eligibility.
 */

import type { CensusData } from "./types";

// ── Chicago City Medians (ACS 5-Year estimates, approx) ──
export const CHICAGO_MEDIANS = {
  income: 65_000,
  homeValue: 275_000,
  populationPerTract: 3_500,
  walkScore: 11,
} as const;

// QCT threshold: 60% of Area Median Income
const QCT_INCOME_THRESHOLD = CHICAGO_MEDIANS.income * 0.6; // ~$39,000

// LMI threshold: 80% of Area Median Income
const LMI_INCOME_THRESHOLD = CHICAGO_MEDIANS.income * 0.8; // ~$52,000

export interface CensusNarrativeResult {
  /** Plain-language interpretation of income data */
  incomeNarrative: string | null;
  /** Income as percentage of metro median */
  incomePercentOfMetro: number | null;
  /** Whether this tract likely qualifies as QCT */
  isLikelyQCT: boolean;
  /** Whether this tract is in a low-to-moderate income area */
  isLMI: boolean;
  /** Programs this census data unlocks */
  unlockedPrograms: string[];
  /** Home value context */
  homeValueNarrative: string | null;
  /** Population density context */
  populationNarrative: string | null;
  /** Overall "why this location qualifies" explanation */
  qualificationNarrative: string;
}

/**
 * Generate interpreted narrative from raw census data.
 */
export function censusNarrative(census: CensusData): CensusNarrativeResult {
  const result: CensusNarrativeResult = {
    incomeNarrative: null,
    incomePercentOfMetro: null,
    isLikelyQCT: false,
    isLMI: false,
    unlockedPrograms: [],
    homeValueNarrative: null,
    populationNarrative: null,
    qualificationNarrative: "",
  };

  // Income analysis
  if (census.medianIncome != null) {
    const pct = Math.round((census.medianIncome / CHICAGO_MEDIANS.income) * 100);
    result.incomePercentOfMetro = pct;
    result.isLikelyQCT = census.medianIncome < QCT_INCOME_THRESHOLD;
    result.isLMI = census.medianIncome < LMI_INCOME_THRESHOLD;

    if (result.isLikelyQCT) {
      result.incomeNarrative = `$${census.medianIncome.toLocaleString()} — ${pct}% of the Chicago city median ($${CHICAGO_MEDIANS.income.toLocaleString()}). This falls within a modeled Qualified Census Tract (QCT) screening range. Confirm the tract against the current HUD QCT list before relying on that designation for NMTC or LIHTC.`;
      result.unlockedPrograms.push("NMTC (verify)", "LIHTC 130% basis boost (verify)");
    } else if (result.isLMI) {
      result.incomeNarrative = `$${census.medianIncome.toLocaleString()} — ${pct}% of the Chicago city median. This is a modeled low-to-moderate income signal used by some place-based programs. Verify the relevant geography and published requirements with the administering agency.`;
      result.unlockedPrograms.push("CDBG-eligible area (verify)", "SBA HUBZone potential (verify)");
    } else {
      result.incomeNarrative = `$${census.medianIncome.toLocaleString()} — ${pct}% of the Chicago city median ($${CHICAGO_MEDIANS.income.toLocaleString()}). Income levels are near or above the city average.`;
    }
  }

  // Home value — the ACS figure and its ratio to the city median are measured.
  // What that implies about appreciation, "room for growth", or "strong
  // fundamentals" is a forecast this platform has no basis to make, so the
  // number is reported and the forecast is not.
  if (census.medianHomeValue != null) {
    const pct = Math.round(
      (census.medianHomeValue / CHICAGO_MEDIANS.homeValue) * 100,
    );
    result.homeValueNarrative =
      `$${census.medianHomeValue.toLocaleString()} — ${pct}% of the Chicago city median ` +
      `($${CHICAGO_MEDIANS.homeValue.toLocaleString()}), from ACS 5-year estimates. ` +
      `Median home value is a demographic measure, not an appraisal or a projection of future value.`;
  }

  // Population — RESIDENTS, and only residents.
  //
  // This previously read "a densely populated tract offering strong foot
  // traffic and customer volume" above 5,000 residents. Residential population
  // is not foot traffic: it counts who sleeps in the tract, not who passes a
  // storefront, and the two diverge hardest exactly where it matters — a
  // downtown block with few residents and heavy daytime traffic, or a quiet
  // residential tract with no commercial corridor. Publishing an inferred
  // customer volume under a "Measured (census tract)" label is the specific
  // thing lib/site-activity.ts refuses to do, where the header states no
  // combined foot-traffic figure may ever be added. The report already carries
  // real measurements of activity — IDOT counts, CTA entries, workplace jobs,
  // active licenses — so the honest move is to name the census figure for what
  // it is and point at those.
  if (census.population != null) {
    const pct = Math.round(
      (census.population / CHICAGO_MEDIANS.populationPerTract) * 100,
    );
    result.populationNarrative =
      `${census.population.toLocaleString()} residents in this tract — ${pct}% of the typical ` +
      `Chicago tract (about ${CHICAGO_MEDIANS.populationPerTract.toLocaleString()}), from ACS 5-year estimates. ` +
      `This counts residents, not visitors or customers; see the site activity measures for traffic, transit, and workplace counts.`;
  }

  // Overall qualification narrative
  const reasons: string[] = [];
  if (result.isLikelyQCT) {
    reasons.push("its median income falls within a modeled QCT screening range; only the current HUD list can confirm the federal designation");
  }
  if (result.isLMI && !result.isLikelyQCT) {
    reasons.push("its income falls within a modeled low-to-moderate range used by some place-based programs");
  }
  if (census.medianHomeValue != null && census.medianHomeValue < 150_000) {
    // Was: "...suggest the area has been targeted for public investment" — a
    // causal claim about what agencies have done, inferred from a home-value
    // figure that says nothing about it. Whether this area has actually
    // received public investment is a question the Community Investment
    // dataset answers from records; it is not derivable from ACS home values.
    reasons.push("median home value is below the city average, which some place-based programs use as a screening input");
  }

  if (reasons.length > 0) {
    result.qualificationNarrative = `These neighborhood characteristics are relevant to program screening because ${reasons.join(", and ")}. Programs such as Opportunity Zones, TIF, and NMTC use separate official designations and project requirements; confirm both with the program administrator.`;
  } else {
    result.qualificationNarrative = "This area's demographics are near or above city averages. Place-based programs may be more limited, while county-wide and state programs remain available for review.";
  }

  return result;
}
