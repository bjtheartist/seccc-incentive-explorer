"use client";
import { ArrowUpRight } from "lucide-react";
import { CatalogSuggestionsPanel } from "./FundingCatalog";
import {
  buildGrantShortlist,
  type FundingCandidate,
} from "@/lib/grants/shortlist";
import {
  fundingLabels,
  matchNeedsReview,
  type Applicant,
  type GrantRecord,
  type Match,
  type WorkspaceData,
} from "@/lib/grants/model";

export function GrantShortlist({
  applicant,
  workspace,
  now,
  onReview,
  onReviewImported,
}: {
  applicant: GrantRecord<Applicant>;
  workspace: WorkspaceData;
  now: Date;
  onReview: (candidate: FundingCandidate, match?: GrantRecord<Match>) => void;
  onReviewImported: (programId: string, roundId: string) => Promise<void>;
}) {
  const results = buildGrantShortlist(
    applicant.data,
    workspace.programs,
    workspace.rounds,
    now,
  );
  const verified = results.candidates.filter((c) =>
    ["open", "rolling"].includes(c.state),
  );
  const research = results.candidates.filter(
    (c) => !["open", "rolling"].includes(c.state),
  );
  const canEdit = workspace.member.role !== "viewer";
  const card = (c: FundingCandidate, index: number, watch = false) => {
    const match = workspace.matches.find(
      (m) =>
        m.data.applicantId === applicant.id && m.data.roundId === c.round.id,
    );
    const stale =
      match && matchNeedsReview(match.data, applicant, c.round, now);
    return (
      <article
        key={c.round.id}
        className="grant-panel p-5"
        data-testid={watch ? "watchlist-result" : "shortlist-result"}
      >
        <div className="flex flex-wrap justify-between gap-3">
          <div className="flex gap-3">
            <span className="grant-shortlist-rank">
              {watch ? "↗" : index + 1}
            </span>
            <div>
              <h3 className="font-semibold">{c.program.data.name}</h3>
              <p className="mt-1 text-xs text-slate-500">
                {c.round.data.name} ·{" "}
                {fundingLabels[c.program.data.fundingType]}
              </p>
              <span
                className={`grant-badge mt-2 ${["open", "rolling"].includes(c.state) ? "green" : "amber"}`}
              >
                {["open", "rolling"].includes(c.state)
                  ? "Verified application window"
                  : watch
                    ? "Upcoming — timing to review"
                    : "Needs verification"}
              </span>
            </div>
          </div>
          <a
            className="grant-button quiet"
            href={c.round.data.evidenceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Official source <ArrowUpRight size={14} />
          </a>
        </div>
        <p className="mt-4 text-sm">
          <strong>{c.round.data.amount}</strong>
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {c.round.data.closesAt
            ? `Recorded deadline: ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: c.round.data.timezone }).format(new Date(c.round.data.closesAt))} · ${c.round.data.timezone}`
            : c.state === "rolling"
              ? "Verified rolling intake"
              : "No confirmed deadline"}
        </p>
        <div className="mt-4 grid gap-5 text-sm sm:grid-cols-2">
          <div>
            <h4 className="mb-2 font-semibold">Why it is here</h4>
            <ul className="list-disc space-y-1 pl-4 text-slate-600">
              {c.screening.reasons.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-2 font-semibold">Confirm before recommending</h4>
            <ul className="list-disc space-y-1 pl-4 text-slate-600">
              {c.screening.gaps.length ? (
                c.screening.gaps.map((v) => <li key={v}>{v}</li>)
              ) : (
                <li>Staff review of the source and project scope.</li>
              )}
            </ul>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-slate-500">
            {match
              ? `${stale ? "Saved match needs review" : match.data.status.replaceAll("_", " ")} · Next action: ${match.data.nextAction || "Not assigned"}`
              : "No staff recommendation saved yet."}
          </p>
          {canEdit && (
            <button className="grant-button" onClick={() => onReview(c, match)}>
              {match ? "Review match" : "Save & review match"}
            </button>
          )}
        </div>
      </article>
    );
  };
  return (
    <>
      <section className="grant-panel p-5">
        <p className="grant-eyebrow">SAVED BUSINESS PROFILE</p>
        <h2 className="text-xl font-semibold">{applicant.data.name}</h2>
        <p className="mt-2 text-sm text-slate-600">
          {applicant.data.primaryGoal ||
            applicant.data.project ||
            "Primary goal needs confirmation."}
        </p>
        <dl className="grant-profile-facts">
          {[
            ["Business type", applicant.data.businessType],
            ["Industry", applicant.data.industry],
            ["Intake date", applicant.data.intakeDate],
            ["Target funding date", applicant.data.targetDate],
            ["Applicant role", applicant.data.role],
            ["Project budget", applicant.data.budget],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v || "Not recorded"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          {applicant.data.address || "Address not confirmed"} · Source:{" "}
          {applicant.data.factsSource || "Needs confirmation"}
        </p>
      </section>
      <div className="mb-4 mt-7">
        <p className="grant-eyebrow">YOUR FUNDING SHORTLIST</p>
        <h2 className="text-xl font-semibold">
          {verified.length}{" "}
          {verified.length === 1 ? "opportunity" : "opportunities"} ready for
          staff review
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Screened {results.considered} programs. Up to five results, one per
          program, ordered by verified availability, recorded fit and deadline.
          Eligibility and payment timing still need review.
        </p>
      </div>
      <div className="space-y-4">
        {verified.map((c, i) => card(c, i))}
        {!verified.length && (
          <div className="grant-panel p-6 text-sm text-slate-600">
            No verified current opportunity fits the recorded answers yet.{" "}
            {research.length
              ? "Relevant leads below need source verification."
              : "Review the answers or add verified program criteria to continue."}
          </div>
        )}
      </div>
      {research.length > 0 && (
        <section className="mt-7">
          <h2 className="mb-2 font-semibold">
            Research leads to verify · {research.length}
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Recorded criteria suggest a fit. These leads are not yet ready to
            recommend.
          </p>
          <div className="space-y-4">
            {research.map((c, i) => card(c, verified.length + i))}
          </div>
        </section>
      )}
      <CatalogSuggestionsPanel
        key={`${applicant.id}-${applicant.version}`}
        applicant={applicant}
        limit={Math.max(0, 5 - results.candidates.length)}
        canEdit={canEdit}
        onReview={onReviewImported}
      />
      {results.totalRelevant > 5 && (
        <p className="mt-4 text-sm text-slate-500">
          Showing the five strongest of {results.totalRelevant} possible fits.
          Update the answers to narrow further.
        </p>
      )}
      {results.watchlist.length > 0 && (
        <details className="grant-panel mt-6 p-5">
          <summary className="cursor-pointer font-semibold">
            Upcoming rounds to watch · {results.watchlist.length}
          </summary>
          <p className="my-3 text-sm text-slate-500">
            These application windows are in the future. Confirm that award
            timing could meet the project&apos;s needs.
          </p>
          <div className="space-y-3">
            {results.watchlist.map((c, i) => card(c, i, true))}
          </div>
        </details>
      )}
      <details className="grant-panel mt-5 p-5">
        <summary className="cursor-pointer text-sm font-semibold">
          What needs more research or was left out?
        </summary>
        <p className="my-3 text-sm text-slate-500">
          {results.needsRules} programs have no recorded application round.
          Closed rounds, incompatible criteria and funding types outside the
          selected preferences are omitted. Missing industry or zone information
          remains a review question.
        </p>
        <ul className="space-y-3 text-sm text-slate-600">
          {results.omitted.map((o, i) => (
            <li key={`${o.name}-${i}`}>
              <strong>{o.name}:</strong> {o.reason}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
