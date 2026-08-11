"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ClipboardCheck, ExternalLink, Info, Landmark } from "lucide-react";
import { PreparationCostBadge } from "@/components/report/PreparationCostBadge";
import { StageHandoffButton } from "@/components/zoning/StageHandoffButton";
import {
  buildZoningReviewNotes,
  getDistrictUseTableLink,
  getZoningReviewActivity,
  ZONING_REVIEW_ACTIVITIES,
  ZONING_USE_CATEGORY_SOURCE,
  type ZoningReviewActivityId,
} from "@/lib/zoning-review-questions";

interface ZoningReviewQuestionsProps {
  zoneClass: string;
  zoningSourceLabel?: string;
  zoningSourceUrl?: string;
  siteSpecificOrdinanceUrl?: string | null;
  /** Site address, carried into the stage handoff summary. */
  address?: string | null;
  /** Business type / industry as the user described it, for the handoff. */
  businessType?: string | null;
}

const DOB_PERMIT_GUIDE_URL =
  "https://www.chicago.gov/city/en/sites/guide-to-building-permits/home.html";
const ZBA_URL = "https://www.chicago.gov/zba";
const DEFAULT_ZONING_SOURCE = {
  label: "City of Chicago ArcGIS zoning boundaries",
  url: "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1",
};
const PERMIT_PATH_COST = {
  tier: "$$" as const,
  basis: "Permit filing fees or licensed professional help may apply depending on the work scope.",
};
const ZBA_PATH_COST = {
  tier: "$$$" as const,
  basis: "A zoning-relief application may involve filing fees and specialized professional work depending on the case.",
};

export function ZoningReviewQuestions({
  zoneClass,
  zoningSourceLabel,
  zoningSourceUrl,
  siteSpecificOrdinanceUrl,
  address,
  businessType,
}: ZoningReviewQuestionsProps) {
  const [activityId, setActivityId] = useState<ZoningReviewActivityId | "">("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const activity = activityId ? getZoningReviewActivity(activityId) : null;
  const reviewNotes = useMemo(
    () => (activityId ? buildZoningReviewNotes(activityId, answers) : []),
    [activityId, answers],
  );
  const districtUseTable = getDistrictUseTableLink(zoneClass);
  const districtSourceLabel = zoningSourceLabel ?? DEFAULT_ZONING_SOURCE.label;
  const districtSourceUrl = zoningSourceUrl ?? DEFAULT_ZONING_SOURCE.url;

  const selectActivity = (value: string) => {
    setActivityId(value as ZoningReviewActivityId | "");
    setAnswers({});
  };

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  };

  return (
    <section
      aria-labelledby="zoning-review-questions-title"
      className="border border-[#0C1B33]/10 bg-white rounded-md overflow-hidden"
    >
      <div className="p-4 sm:p-5 border-b border-[#0C1B33]/10">
        <div className="flex items-start gap-3">
          <ClipboardCheck className="w-4 h-4 text-[#2F5BEA] mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
              <h3
                id="zoning-review-questions-title"
                className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#0C1B33]/70"
              >
                Prepare for a Zoning Review
              </h3>
              <span className="font-mono-bureau text-[8px] tracking-[0.12em] uppercase text-[#2F5BEA] border border-[#2F5BEA]/20 px-2 py-1 rounded">
                Published district {zoneClass}
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-[#0C1B33]/55 leading-relaxed max-w-2xl">
              Capture the project details that can affect which ordinance use category should be reviewed. This guide does not classify the use or determine whether it is allowed.
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <label
          htmlFor="zoning-review-activity"
          className="font-mono-bureau text-[9px] tracking-[0.14em] uppercase text-[#0C1B33]/50 block mb-2"
        >
          Project type
        </label>
        <select
          id="zoning-review-activity"
          value={activityId}
          onChange={(event) => selectActivity(event.target.value)}
          className="w-full min-h-11 rounded-md border border-[#0C1B33]/15 bg-white px-3 py-2.5 text-sm text-[#0C1B33] focus:outline-none focus:ring-2 focus:ring-[#2F5BEA]/40"
        >
          <option value="">Choose a project type</option>
          {ZONING_REVIEW_ACTIVITIES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        {activity ? (
          <div className="mt-5 border-t border-[#0C1B33]/10">
            {activity.questions.map((question, index) => (
              <fieldset key={question.id} className="py-5 border-b border-[#0C1B33]/10 last:border-b-0">
                <legend className="text-sm text-[#0C1B33]/80 leading-relaxed font-medium">
                  {index + 1}. {question.prompt}
                </legend>

                {question.kind === "choice" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                    {question.options.map((option) => {
                      const inputId = `${question.id}-${option.value}`;
                      return (
                        <label
                          key={option.value}
                          htmlFor={inputId}
                          className={`min-h-10 flex items-center gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer transition-colors ${
                            answers[question.id] === option.value
                              ? "border-[#2F5BEA]/60 bg-[#2F5BEA]/[0.07] text-[#0C1B33]"
                              : "border-[#0C1B33]/10 bg-white text-[#0C1B33]/60 hover:border-[#0C1B33]/25 hover:text-[#0C1B33]/80"
                          }`}
                        >
                          <input
                            id={inputId}
                            type="radio"
                            name={question.id}
                            value={option.value}
                            checked={answers[question.id] === option.value}
                            onChange={() => setAnswer(question.id, option.value)}
                            className="h-4 w-4 shrink-0 accent-[#2563EB]"
                          />
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <textarea
                    aria-label={question.prompt}
                    value={answers[question.id] ?? ""}
                    onChange={(event) => setAnswer(question.id, event.target.value)}
                    placeholder={question.placeholder}
                    rows={3}
                    className="mt-3 w-full resize-y rounded-md border border-[#0C1B33]/15 bg-white px-3 py-2.5 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/30 focus:outline-none focus:ring-2 focus:ring-[#2F5BEA]/40"
                  />
                )}

                <div className="mt-3 flex items-start gap-2 text-[10px] text-[#0C1B33]/45 leading-relaxed">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#2F5BEA]/70" aria-hidden="true" />
                  <p>
                    <span className="text-[#0C1B33]/65">Why this matters: </span>
                    {question.whyItMatters}{" "}
                    <a
                      href={question.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#2F5BEA] hover:underline"
                    >
                      {question.sourceLabel}
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  </p>
                </div>
              </fieldset>
            ))}

            {reviewNotes.length > 0 && (
              <div className="pt-5" aria-live="polite">
                <div className="font-mono-bureau text-[9px] tracking-[0.16em] uppercase text-[#0C1B33]/55 mb-3">
                  Details to Verify
                </div>
                <ul className="space-y-2">
                  {reviewNotes.map((note) => (
                    <li key={note.question} className="flex items-start gap-2 text-xs text-[#0C1B33]/60 leading-relaxed">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#2F5BEA] shrink-0" aria-hidden="true" />
                      <span>
                        <strong className="font-medium text-[#0C1B33]/80">{note.answer}:</strong>{" "}
                        {note.reviewNote}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {activityId === "capital_project" && (
              <div className="mt-4 border-l-2 border-[#2F5BEA]/45 pl-3 text-[10px] text-[#0C1B33]/50 leading-relaxed" role="note">
                <div className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/55 mb-2">
                  Capital Project Scope Control
                </div>
                <p>
                  Some workstreams may overlap when the project team and program rules allow it: concept design with zoning or entitlement review; financing conversations with pro forma refinement; and environmental due diligence with site-control negotiations.
                </p>
                <p className="mt-2">
                  Overlap is not a promised shortcut. Zoning, site control, public-capital agreements, permits, construction draws, and closeout remain project-specific. Have counsel draft any lease or purchase contingencies, and verify each funding program&rsquo;s preapproval and eligible-cost rules before committing costs.
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-[10px] text-[#0C1B33]/40 leading-relaxed">
            Choose the closest project type. Use &ldquo;Another project type&rdquo; when the listed options do not fit.
          </p>
        )}
      </div>

      <div className="border-t border-[#0C1B33]/10 bg-[#F7F8FA] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Landmark className="w-4 h-4 text-[#2F5BEA] mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <div className="font-mono-bureau text-[9px] tracking-[0.16em] uppercase text-[#0C1B33]/55 mb-2">
              Verification Path
            </div>
            <ol className="space-y-1.5 text-[11px] text-[#0C1B33]/55 leading-relaxed list-decimal pl-4">
              <li>Confirm the published district and any site-specific ordinance.</li>
              <li>Ask the City or a zoning professional to identify the exact Title 17 use category.</li>
              <li>Review that category&rsquo;s row, use standards, parking, licensing, and permit requirements.</li>
            </ol>

            <div className="mt-4 border-t border-[#0C1B33]/10 pt-4">
              <div className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/45 mb-2">
                After the Status Is Confirmed
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-2">
                    <PreparationCostBadge signal={PERMIT_PATH_COST} label="Possible cost" />
                  </div>
                  <p className="text-[10px] text-[#0C1B33]/55 leading-relaxed">
                    If the City confirms the exact use is listed as permitted by-right and identifies no other zoning relief, determine whether the work requires a building permit and which current DOB review program fits the scope.
                  </p>
                  <a
                    href={DOB_PERMIT_GUIDE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[10px] text-[#2F5BEA] hover:underline"
                  >
                    City building permit guide
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                </div>
                <div>
                  <div className="mb-2">
                    <PreparationCostBadge signal={ZBA_PATH_COST} label="Possible cost" />
                  </div>
                  <p className="text-[10px] text-[#0C1B33]/55 leading-relaxed">
                    If the City issues an official denial or referral for a special use or variation, use the current ZBA application materials and hearing schedule for that case type.
                  </p>
                  <a
                    href={ZBA_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[10px] text-[#2F5BEA] hover:underline"
                  >
                    Chicago Zoning Board of Appeals
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              <a
                href={districtSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-[#2F5BEA] hover:underline"
              >
                {districtSourceLabel}
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
              {siteSpecificOrdinanceUrl && (
                <a
                  href={siteSpecificOrdinanceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-[#2F5BEA] hover:underline"
                >
                  Site-specific ordinance record
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
              <a
                href={districtUseTable.url}
                target="_blank"
                rel="noopener noreferrer"
                title={districtUseTable.context}
                className="inline-flex items-center gap-1 text-[10px] text-[#2F5BEA] hover:underline"
              >
                {districtUseTable.label}
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
              <a
                href={ZONING_USE_CATEGORY_SOURCE.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-[#2F5BEA] hover:underline"
              >
                {ZONING_USE_CATEGORY_SOURCE.label}
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>
            <p className="mt-3 text-[9px] text-[#0C1B33]/35 leading-relaxed">
              This preparation guide is not an official use classification, zoning opinion, approval, or legal advice.
            </p>
            <div className="mt-4 border-t border-[#0C1B33]/10 pt-4">
              <StageHandoffButton
                input={{
                  address,
                  businessType,
                  zoneClass,
                  activityLabel: activity?.label ?? null,
                  reviewAnswers: reviewNotes.map((note) => ({
                    question: note.question,
                    answer: note.answer,
                  })),
                  officialLinks: [
                    { label: districtUseTable.label, url: districtUseTable.url },
                    { label: districtSourceLabel, url: districtSourceUrl },
                    ...(siteSpecificOrdinanceUrl
                      ? [{ label: "Site-specific ordinance record", url: siteSpecificOrdinanceUrl }]
                      : []),
                  ],
                }}
              />
            </div>
            <a
              href="/learn"
              className="mt-3 inline-flex items-center gap-1 text-[10px] text-[#2F5BEA] hover:underline"
            >
              Learn how zoning, approvals, and permits fit together
              <ArrowRight className="w-3 h-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
