import { runShortlistEngine, zoningBadgeFor, zoningAlignmentRank, selectedTransitNetwork, transitScoreFor, transitScreenMeters, type ShortlistEngineInputs, type RankedShortlistCandidate } from "./shortlist-engine";
import { assessShortlistEvidence, type ScreeningUniverseRow, type ShortlistScreeningEvidence } from "./shortlist-screening-evidence";

export type EvidenceCandidate = RankedShortlistCandidate & {
  screeningEvidence?: ShortlistScreeningEvidence;
  screeningReasons: string[];
  screeningDisposition: "match" | "review" | "conversion";
};

/** Five equally weighted evidence categories, independent of the brief.
 * Count coverage, never property quality: usable identity, dated recorded type,
 * any typed measurement, resolved zoning and resolved community membership.
 * Multiple measurements do not multiply the bonus; unverified owner/value
 * fields and incentive counts do not influence this order.
 */
function evidenceCompleteness(row: ScreeningUniverseRow): number {
  const evidence = row.screeningEvidence;
  const usableIdentity = evidence?.pin != null && ["saved", "resolved"].includes(evidence.identityStatus);
  return Number(usableIdentity)
    + Number(usableIdentity && evidence?.checkedAt != null && !["unknown", "exempt"].includes(evidence.recordedType))
    + Number(Object.values(evidence?.measurements ?? {}).some((measurement) => measurement != null && measurement.value > 0
      && (measurement.source !== "cook_county_assessor" || usableIdentity)))
    + Number(row.zoning.status === "resolved")
    + Number(Boolean(evidence?.communityArea));
}

/** Evidence requirements are applied to the full universe before ranking. The
 * existing engine retains transport scoring; completeness leads the refined order. It must not reapply legacy
 * untyped size or broad zoning admission to already partitioned rows.
 */
export function runEvidenceShortlist(inputs: ShortlistEngineInputs & { rows: readonly ScreeningUniverseRow[] }) {
  const buckets: Record<"match" | "review" | "conversion", ScreeningUniverseRow[]> = { match: [], review: [], conversion: [] };
  const reasons = new Map<string, string[]>();
  let excluded = 0;
  const network = selectedTransitNetwork(inputs.criteria, inputs.stations);
  const maximumDistance = transitScreenMeters(inputs.criteria);
  for (const row of inputs.rows) {
    if (inputs.criteria.propertyType === "existing-building" && !row.hasVacantBuildingEvidence) continue;
    if (inputs.criteria.propertyType === "vacant-land" && !row.hasVacantLandEvidence) continue;
    const assessment = assessShortlistEvidence(row, inputs.criteria);
    if (inputs.criteria.zoningAlignment && inputs.criteria.projectUse) {
      const badge = zoningBadgeFor(inputs.criteria.projectUse, row.zoning);
      if (badge === "not-aligned") {
        assessment.disposition = "excluded";
        assessment.reasons.push("Mapped district family is not broadly aligned with the proposed activity.");
      } else if (badge !== "aligned" && assessment.disposition !== "excluded") {
        assessment.disposition = "review";
        assessment.reasons.push(badge === "planned-development" ? "PD/PMD requires site-specific zoning review." : "Mapped zoning district needs verification.");
      }
    }
    if (inputs.criteria.communityArea) {
      // Populated by the boundary join; absence must not silently skip a filter.
      const community = row.screeningEvidence?.communityArea;
      if (!community && assessment.disposition !== "excluded") {
        assessment.disposition = "review";
        assessment.reasons.push("Community-area membership needs verification.");
      } else if (community && community !== inputs.criteria.communityArea) {
        assessment.disposition = "excluded";
        assessment.reasons.push("Outside the selected official community area.");
      }
    }
    if (network && maximumDistance != null) {
      const distance = transitScoreFor(row, network)?.meters;
      if (distance == null && assessment.disposition !== "excluded") {
        assessment.disposition = "review";
        assessment.reasons.push("Selected rail distance cannot be evaluated without a reliable location.");
      } else if (distance != null && distance > maximumDistance) {
        assessment.disposition = "excluded";
        assessment.reasons.push("Outside the selected straight-line rail distance.");
      }
    }
    reasons.set(row.canonicalKey, assessment.reasons);
    if (assessment.disposition === "excluded") excluded++;
    else buckets[assessment.disposition].push(row);
  }
  const rank = (disposition: keyof typeof buckets) => {
    const rows = buckets[disposition].map((row) => ({ ...row, pin: row.screeningEvidence ? row.screeningEvidence.pin : row.pin }));
    const byKey = new Map(rows.map((row) => [row.canonicalKey, row.screeningEvidence]));
    const completeness = new Map(rows.map((row) => [row.canonicalKey, evidenceCompleteness(row)]));
    const result = runShortlistEngine({ ...inputs, rows, criteria: { ...inputs.criteria, minSquareFeet: null, maxSquareFeet: null, zoningAlignment: null, transportationDistance: null } });
    return { ...result, ranked: result.ranked.map((candidate): EvidenceCandidate => ({
      ...candidate,
      recordCompletenessScore: completeness.get(candidate.key) ?? 0,
      screeningEvidence: byKey.get(candidate.key),
      screeningReasons: reasons.get(candidate.key) ?? [],
      screeningDisposition: disposition,
    })).sort((a, b) => b.recordCompletenessScore - a.recordCompletenessScore
      || b.score - a.score
      || zoningAlignmentRank(inputs.criteria.projectUse, a.badge) - zoningAlignmentRank(inputs.criteria.projectUse, b.badge)
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) };
  };
  const matches = rank("match"), review = rank("review"), conversions = rank("conversion");
  return { ...matches, review: review.ranked, conversions: conversions.ranked, excluded,
    railDataUnavailable: matches.railDataUnavailable || review.railDataUnavailable || conversions.railDataUnavailable,
    dispatchCoverageBroken: matches.dispatchCoverageBroken || review.dispatchCoverageBroken || conversions.dispatchCoverageBroken,
  };
}
