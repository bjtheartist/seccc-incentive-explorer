/**
 * Public-source lifecycle for Illinois DCEO funding records.
 *
 * An appropriation, executed grant agreement, and disbursement can describe
 * different stages of one funding path. They are never additive measures and
 * must not be presented as a current project's expected incentive dollars.
 */

export const DCEO_FUNDING_LIFECYCLE_STAGE_IDS = [
  "proposed_budget",
  "enacted_authority",
  "appropriation_register",
  "funding_opportunity",
  "executed_award",
  "disbursement",
] as const;

export type DceoFundingLifecycleStageId =
  (typeof DCEO_FUNDING_LIFECYCLE_STAGE_IDS)[number];

export interface DceoFundingLifecycleStage {
  id: DceoFundingLifecycleStageId;
  label: string;
  sourceName: string;
  sourceUrl: string;
  sourceField: string;
  amountMeaning: string;
  platformCoverage: "ingested" | "source_identified";
}

export const DCEO_FUNDING_LIFECYCLE_STAGES = [
  {
    id: "proposed_budget",
    label: "Proposed budget project",
    sourceName: "Illinois Capital Projects List",
    sourceUrl:
      "https://budget.illinois.gov/content/dam/soi/en/web/budget/documents/budget-book/fy2027-budget/Capital-Projects-List.xlsx",
    sourceField: "Recommended project amount",
    amountMeaning:
      "Budget recommendation context until reconciled to enacted appropriation authority.",
    platformCoverage: "source_identified",
  },
  {
    id: "enacted_authority",
    label: "Enacted authority",
    sourceName: "Illinois enacted appropriations by line item",
    sourceUrl:
      "https://budget.illinois.gov/content/dam/soi/en/web/budget/documents/budget-book/fy2026-budget/FY25%20Final%20and%20FY26%20Enacted%20Appropriations%20by%20Line%20Item.xls",
    sourceField: "Enacted appropriation",
    amountMeaning:
      "Spending authority enacted by the General Assembly; not an executed grant agreement or payment.",
    platformCoverage: "source_identified",
  },
  {
    id: "appropriation_register",
    label: "Appropriation",
    sourceName: "DCEO Capital Appropriation List",
    sourceUrl:
      "https://dceo.illinois.gov/aboutdceo/grantopportunities/capitalgrants.html",
    sourceField: "Published balance",
    amountMeaning:
      "Legislative budget authority published by DCEO; not an executed grant agreement or payment.",
    platformCoverage: "ingested",
  },
  {
    id: "funding_opportunity",
    label: "Funding opportunity",
    sourceName: "DCEO Grant Opportunities and Illinois CSFA",
    sourceUrl:
      "https://dceo.illinois.gov/aboutdceo/grantopportunities/grants.html",
    sourceField: "Notice of Funding Opportunity",
    amountMeaning:
      "Formal opportunity to apply under GATA; not an award, obligation, or payment.",
    platformCoverage: "source_identified",
  },
  {
    id: "executed_award",
    label: "Executed award",
    sourceName: "DCEO Grant Tracker",
    sourceUrl: "https://dceoapps.ildceo.net/granttracker/gt/Default.aspx",
    sourceField: "Award Amount",
    amountMeaning:
      "State obligation under an executed grant agreement; not a payment to the grantee.",
    platformCoverage: "source_identified",
  },
  {
    id: "disbursement",
    label: "Disbursement",
    sourceName: "DCEO Grant Tracker",
    sourceUrl: "https://dceoapps.ildceo.net/granttracker/gt/faq.aspx",
    sourceField: "Amount Disbursed",
    amountMeaning:
      "Payments processed through DCEO systems for the grant agreement.",
    platformCoverage: "source_identified",
  },
] as const satisfies readonly DceoFundingLifecycleStage[];

export const DCEO_FUNDING_LIFECYCLE_POLICY = {
  amountCombinationPolicy: "never_sum_across_lifecycle_stages",
  crosswalkPolicy:
    "Link stages only through an official shared identifier or documented manual verification. Prefer fiscal year, public act/article/section, appropriation account code, recipient, and normalized project description; names and similar dollar values alone are not sufficient.",
  readerNote:
    "Lifecycle stages are shown separately as historical public records and do not estimate funding for a current project.",
  officialDefinitionsUrl:
    "https://dceoapps.ildceo.net/granttracker/gt/faq.aspx",
  appropriationArchiveUrl:
    "https://illinoiscomptroller.gov/financial-reports-data/find-a-report/budgetary-reporting/appropriations/",
  budgetArchiveUrl: "https://budget.illinois.gov/budget-books.html",
} as const;

export function dceoFundingLifecycleStage(
  id: DceoFundingLifecycleStageId,
): DceoFundingLifecycleStage {
  return DCEO_FUNDING_LIFECYCLE_STAGES.find((stage) => stage.id === id)!;
}
