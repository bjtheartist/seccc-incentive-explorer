"use client";
import { useState } from "react";
import {
  businessStructures,
  classificationFor,
  naicsBusinessTypes,
} from "@/lib/grants/classification";
import type { Applicant } from "@/lib/grants/model";

export function BusinessClassification({
  data,
  onChange,
}: {
  data: Pick<
    Applicant,
    "naicsCode" | "businessStructure" | "legacyBusinessType" | "legacyIndustry"
  >;
  onChange: (fields: Partial<Applicant>) => void;
}) {
  const [search, setSearch] = useState("");
  const classification = classificationFor(data.naicsCode);
  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const results = naicsBusinessTypes.filter((row) =>
    terms.every((term) =>
      `${row.code} ${row.title}`.toLowerCase().includes(term),
    ),
  );
  const choices = results.slice(0, 60);
  if (
    classification &&
    !choices.some((row) => row.code === classification.naicsCode)
  )
    choices.unshift({
      code: classification.naicsCode,
      title: classification.businessType,
    });
  return (
    <div className="space-y-4 sm:col-span-2">
      <label className="grant-question-field">
        <span>Business structure</span>
        <select
          aria-label="Business structure"
          value={data.businessStructure || "unknown"}
          onChange={(e) =>
            onChange({
              businessStructure: e.target
                .value as Applicant["businessStructure"],
            })
          }
        >
          {Object.entries(businessStructures).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <small>
          Legal structure is separate from nonprofit status and the activity the
          business performs.
        </small>
      </label>
      <label className="grant-question-field">
        <span>Find a business type by NAICS code or activity</span>
        <input
          type="search"
          aria-label="Search NAICS business types"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="e.g. child care, beauty salons, or 624410"
        />
      </label>
      <label className="grant-question-field">
        <span>Business type — NAICS 2022</span>
        <select
          aria-label="Business type — NAICS 2022"
          value={data.naicsCode || ""}
          onChange={(e) =>
            onChange(
              classificationFor(e.target.value) || {
                naicsCode: null,
                businessType: "",
                industryCode: "",
                industry: "",
              },
            )
          }
        >
          <option value="">Not confirmed — needs follow-up</option>
          {choices.map((row) => (
            <option key={row.code} value={row.code}>
              {row.code} — {row.title}
            </option>
          ))}
        </select>
        <small>
          {results.length > 60
            ? "Showing the first 60 results. Search to narrow the list."
            : `${results.length} matching business types.`}{" "}
          Confirm the primary activity with the business; an unconfirmed code
          remains a matching gap.
        </small>
      </label>
      <label className="grant-question-field">
        <span>Business industry — NAICS sector</span>
        <input
          aria-label="Business industry — NAICS sector"
          readOnly
          value={
            classification
              ? `${classification.industryCode} — ${classification.industry}`
              : "Not confirmed"
          }
        />
        <small>
          Filled automatically from the selected business type.{" "}
          <a
            className="underline"
            href="https://www.census.gov/naics/"
            target="_blank"
            rel="noreferrer"
          >
            Census NAICS reference
          </a>
        </small>
      </label>
      {(data.legacyBusinessType || data.legacyIndustry) && (
        <p className="text-xs text-slate-500">
          Earlier intake descriptions:{" "}
          {[data.legacyBusinessType, data.legacyIndustry]
            .filter(Boolean)
            .join(" · ")}
          . Retained for reference; no NAICS code was inferred.
        </p>
      )}
    </div>
  );
}
