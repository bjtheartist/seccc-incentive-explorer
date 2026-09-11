import {
  fundingLabels,
  roundState,
  screenMatch,
  type Applicant,
  type GrantRecord,
  type Program,
  type Round,
} from "./model";

export const shortlistLimit = 5;
export type FundingCandidate = {
  program: GrantRecord<Program>;
  round: GrantRecord<Round>;
  screening: ReturnType<typeof screenMatch>;
  state: ReturnType<typeof roundState>;
  fit: number;
};
const normalize = (v: string) => v.trim().toLowerCase();

/** Rank recorded alignment, never award probability. One result per program. */
export function buildGrantShortlist(
  applicant: Applicant,
  programs: GrantRecord<Program>[],
  rounds: GrantRecord<Round>[],
  now = new Date(),
) {
  const candidates: FundingCandidate[] = [],
    future: FundingCandidate[] = [];
  const omitted: Array<{ name: string; reason: string }> = [];
  const livePrograms = programs.filter((p) => !p.data.archived);
  const permitted = applicant.fundingTypes ?? Object.keys(fundingLabels);
  if (applicant.archived)
    return {
      candidates,
      watchlist: future,
      omitted,
      totalRelevant: 0,
      needsRules: 0,
      considered: 0,
    };
  let needsRules = 0;
  for (const program of livePrograms) {
    if (!permitted.includes(program.data.fundingType)) {
      omitted.push({
        name: program.data.name,
        reason: `${fundingLabels[program.data.fundingType]} is outside the selected funding types.`,
      });
      continue;
    }
    if (
      program.data.fundingType === "reimbursement" &&
      applicant.reimbursementReady === "no"
    ) {
      omitted.push({
        name: program.data.name,
        reason:
          "Reimbursement requires paying eligible costs first; upfront funding is not currently available.",
      });
      continue;
    }
    const current = rounds.filter(
      (r) => r.data.programId === program.id && r.data.review !== "archived",
    );
    if (!current.length) {
      needsRules++;
      continue;
    }
    const relevant: FundingCandidate[] = [];
    for (const round of current) {
      const screening = screenMatch(applicant, round.data, now);
      if (screening.exclusions.length) {
        omitted.push({
          name: `${program.data.name} / ${round.data.name}`,
          reason: screening.exclusions.join("; "),
        });
        continue;
      }
      const state = roundState(round.data, now);
      const supportedCosts = round.data.rules.costs.map(normalize);
      const matchedCosts = applicant.costs.filter((c) =>
        supportedCosts.includes(normalize(c)),
      );
      // A known purpose/cost fit is needed before promoting a lead. Empty rules
      // stay in the research queue rather than filling a shortlist with guesses.
      if (
        !supportedCosts.length ||
        (!matchedCosts.length && !supportedCosts.includes("any"))
      ) {
        omitted.push({
          name: program.data.name,
          reason:
            "Project-cost rules or applicant costs need more detail before matching.",
        });
        continue;
      }
      if (
        program.data.fundingType === "reimbursement" &&
        applicant.reimbursementReady !== "yes"
      )
        screening.gaps.push(
          "Confirm whether the business can pay costs before reimbursement.",
        );
      if (applicant.targetDate)
        screening.gaps.push(
          `Confirm award and payment timing against the target funding date, ${applicant.targetDate}.`,
        );
      if (applicant.budget.trim())
        screening.gaps.push(
          `Check the project budget (${applicant.budget}) against the award cap and required contribution.`,
        );
      const fit =
        matchedCosts.length * 4 +
        screening.reasons.filter((x) => x.includes("criteria align")).length *
          2 -
        screening.gaps.length;
      relevant.push({
        program,
        round,
        screening: {
          ...screening,
          result: screening.gaps.length
            ? "needs_information"
            : screening.result,
        },
        state,
        fit,
      });
    }
    relevant.sort(compareCandidates);
    // Prefer a current round over an upcoming one within the same program.
    const isFuture = (c: FundingCandidate) =>
      c.state === "upcoming" ||
      c.round.data.availability === "announced" ||
      Boolean(
        c.round.data.opensAt &&
        Date.parse(c.round.data.opensAt) > now.getTime(),
      );
    const best = relevant.find((c) => !isFuture(c)) ?? relevant[0];
    if (best) (isFuture(best) ? future : candidates).push(best);
  }
  candidates.sort(compareCandidates);
  future.sort(compareCandidates);
  return {
    candidates: candidates.slice(0, shortlistLimit),
    watchlist: future.slice(0, 3),
    omitted,
    totalRelevant: candidates.length,
    needsRules,
    considered: livePrograms.length,
  };
}

function compareCandidates(a: FundingCandidate, b: FundingCandidate) {
  const available = (c: FundingCandidate) =>
    ["open", "rolling"].includes(c.state) ? 1 : 0;
  return (
    available(b) - available(a) ||
    b.fit - a.fit ||
    (a.round.data.closesAt ? Date.parse(a.round.data.closesAt) : Infinity) -
      (b.round.data.closesAt ? Date.parse(b.round.data.closesAt) : Infinity) ||
    a.program.data.name.localeCompare(b.program.data.name) ||
    a.round.id.localeCompare(b.round.id)
  );
}
