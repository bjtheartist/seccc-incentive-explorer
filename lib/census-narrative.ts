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
      result.incomeNarrative = `$${census.medianIncome.toLocaleString()} — ${pct}% of the Chicago metro median ($${CHICAGO_MEDIANS.income.toLocaleString()}). This qualifies the area as a Qualified Census Tract (QCT), unlocking enhanced NMTC and LIHTC credits.`;
      result.unlockedPrograms.push("NMTC (enhanced)", "LIHTC (130% basis boost)");
    } else if (result.isLMI) {
      result.incomeNarrative = `$${census.medianIncome.toLocaleString()} — ${pct}% of the Chicago metro median. This is a low-to-moderate income area, qualifying for many place-based incentive programs.`;
      result.unlockedPrograms.push("CDBG-eligible area", "SBA HUBZone potential");
    } else {
      result.incomeNarrative = `$${census.medianIncome.toLocaleString()} — ${pct}% of the Chicago metro median ($${CHICAGO_MEDIANS.income.toLocaleString()}). Income levels are near or above the metro average.`;
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
    reasons.push("its median income qualifies it as a Qualified Census Tract (QCT) — a federal designation that unlocks enhanced tax credits");
  }
  if (result.isLMI && !result.isLikelyQCT) {
    reasons.push("its income levels fall in the low-to-moderate range, making it eligible for place-based federal and state programs");
  }
  if (census.medianHomeValue != null && census.medianHomeValue < 150_000) {
    reasons.push("property values below the city average indicate the area was targeted for public investment");
  }

  if (reasons.length > 0) {
    result.qualificationNarrative = `This neighborhood qualifies for enhanced incentives because ${reasons.join(", and ")}. These conditions are why programs like Opportunity Zones, TIF, and NMTC were established here — to attract private investment and create jobs.`;
  } else {
    result.qualificationNarrative = "This area's demographics are near or above city averages. While place-based incentives may be limited, county-wide and state programs still apply.";
  }

  return result;
}
