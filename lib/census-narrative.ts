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

  // Home value analysis
  if (census.medianHomeValue != null) {
    if (census.medianHomeValue < 150_000) {
      result.homeValueNarrative = `$${census.medianHomeValue.toLocaleString()} — well below the city average, indicating potential for appreciation. Land Bank and TIF investments target areas like this.`;
    } else if (census.medianHomeValue < 250_000) {
      result.homeValueNarrative = `$${census.medianHomeValue.toLocaleString()} — moderate property values suggest room for growth with incentive-backed investment.`;
    } else {
      result.homeValueNarrative = `$${census.medianHomeValue.toLocaleString()} — higher property values indicate an established market with strong fundamentals.`;
    }
  }

  // Population
  if (census.population != null) {
    if (census.population < 2000) {
      result.populationNarrative = `${census.population.toLocaleString()} residents in this tract — a smaller population can mean less competition and more community impact from your business.`;
    } else if (census.population < 5000) {
      result.populationNarrative = `${census.population.toLocaleString()} residents — a mid-size tract with a solid customer base for neighborhood-serving businesses.`;
    } else {
      result.populationNarrative = `${census.population.toLocaleString()} residents — a densely populated tract offering strong foot traffic and customer volume.`;
    }
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
    reasons.push("property values below the city average suggest the area has been targeted for public investment");
  }

  if (reasons.length > 0) {
    result.qualificationNarrative = `These neighborhood characteristics are relevant to program screening because ${reasons.join(", and ")}. Programs such as Opportunity Zones, TIF, and NMTC use separate official designations and project requirements; confirm both with the program administrator.`;
  } else {
    result.qualificationNarrative = "This area's demographics are near or above city averages. Place-based programs may be more limited, while county-wide and state programs remain available for review.";
  }

  return result;
}
