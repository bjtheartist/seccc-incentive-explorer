import type {
  FunderType,
  GovernmentFundingPurpose,
  InvestmentSource,
} from "@/lib/community-investment";

export type { GovernmentFundingPurpose };

export const GOVERNMENT_FUNDING_PURPOSES = [
  "capital_project",
  "programmatic",
  "arts",
  "unclassified",
] as const satisfies readonly GovernmentFundingPurpose[];

/**
 * What a government funding record supports. This is orthogonal to both
 * funderType (who supplied the money) and capitalClass (what the dollar figure
 * represents). `unclassified` is deliberate: a source description that does
 * not support one of the accepted rules must remain unresolved rather than be
 * forced into a more useful-looking category.
 */
export const GOVERNMENT_FUNDING_PURPOSE_LABELS: Record<
  GovernmentFundingPurpose,
  string
> = {
  capital_project: "Capital projects",
  programmatic: "Programmatic funding",
  arts: "Arts funding",
  unclassified: "Not classified from source",
};

export const GOVERNMENT_FUNDING_PURPOSE_DESCRIPTIONS: Record<
  GovernmentFundingPurpose,
  string
> = {
  capital_project:
    "Buildings, rehabilitation, acquisition, infrastructure, and other place-based physical work.",
  programmatic:
    "Services, technical or financial assistance, business relief, and other non-capital program delivery.",
  arts:
    "Arts and cultural awards published by a government arts agency.",
  unclassified:
    "The published source does not state enough about the funding purpose to assign it safely.",
};

/**
 * Source families whose purpose is stable at source level. CDBG/HOME and NMTC
 * are handled separately because their own fields span multiple purposes.
 * Philanthropic and private-development sources are null because this taxonomy
 * applies only to government funding.
 */
export const SOURCE_GOVERNMENT_FUNDING_PURPOSE: Record<
  InvestmentSource,
  GovernmentFundingPurpose | null
> = {
  "nof-small": "capital_project",
  "nof-large": "capital_project",
  sbif: "capital_project",
  cdg: "capital_project",
  foundation: null,
  development: null,
  tif: "capital_project",
  "cdbg-home": null,
  lihtc: "capital_project",
  nmtc: null,
  "cook-source-2023": "programmatic",
  "illinois-big": "programmatic",
  "illinois-hospitality-emergency": "programmatic",
  "illinois-b2b": "programmatic",
  "sba-rrf": "programmatic",
  "dceo-capital": "capital_project",
};

type FundingPurposeRecord = {
  source: InvestmentSource;
  funderType: FunderType;
  recipient?: string | null;
  logLine?: string | null;
  /** Raw source purpose used only while importing record-specific sources. */
  sourcePurposeText?: string | null;
};

function classifyCdbgHome(record: FundingPurposeRecord): GovernmentFundingPurpose {
  const activity = record.logLine?.trim() ?? "";
  const recipient = record.recipient?.trim() ?? "";

  if (
    activity === "CDBG activity · Public Improvements" ||
    activity === "HOME activity · Multifamily Rental" ||
    activity === "CDBG activity · Acquisition"
  ) {
    return "capital_project";
  }
  if (
    activity === "CDBG activity · Public Services" ||
    activity === "CDBG activity · Other"
  ) {
    return "programmatic";
  }

  if (activity === "CDBG activity · Housing") {
    if (/rehabilitation|operation and repair/i.test(recipient)) {
      return "capital_project";
    }
    if (/code enforcement/i.test(recipient)) {
      return "programmatic";
    }
    return "unclassified";
  }

  if (activity === "CDBG activity · Economic Development") {
    if (/technical assistance|financial assistance/i.test(recipient)) {
      return "programmatic";
    }
    if (
      /acquisition|rehabilitation|improvements|infrastructure|construction/i.test(
        recipient,
      )
    ) {
      return "capital_project";
    }
    return "unclassified";
  }

  return "unclassified";
}

/**
 * NMTC's public purpose field can name real estate, business financing, other
 * financing, or a semicolon-delimited mix. Only an all-real-estate description
 * establishes physical-project purpose. Business, other, mixed, or missing
 * rows remain unclassified rather than being forced into programmatic funding.
 */
export function classifyNmtcPurpose(
  sourcePurposeText: string | null | undefined,
): GovernmentFundingPurpose {
  const parts = String(sourcePurposeText ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 0 && parts.every((part) => /^Real Estate\b/i.test(part))) {
    return "capital_project";
  }
  return "unclassified";
}

/** Classify one government record using only source-published fields. */
export function governmentFundingPurposeForRecord(
  record: FundingPurposeRecord,
): GovernmentFundingPurpose | null {
  if (record.funderType !== "government") return null;
  if (record.source === "cdbg-home") return classifyCdbgHome(record);
  if (record.source === "nmtc") {
    return classifyNmtcPurpose(record.sourcePurposeText ?? record.logLine);
  }
  return SOURCE_GOVERNMENT_FUNDING_PURPOSE[record.source] ?? "unclassified";
}
