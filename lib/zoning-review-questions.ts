export type ZoningReviewActivityId =
  | "restaurant"
  | "day_care"
  | "urban_agriculture"
  | "motor_vehicle_repair"
  | "capital_project"
  | "other";

export type ZoningReviewQuestion =
  | {
      id: string;
      kind: "choice";
      prompt: string;
      whyItMatters: string;
      sourceLabel: string;
      sourceUrl: string;
      options: Array<{
        value: string;
        label: string;
        reviewNote: string;
      }>;
    }
  | {
      id: string;
      kind: "text";
      prompt: string;
      whyItMatters: string;
      sourceLabel: string;
      sourceUrl: string;
      placeholder: string;
    };

export interface ZoningReviewActivity {
  id: ZoningReviewActivityId;
  label: string;
  questions: ZoningReviewQuestion[];
}

export interface ZoningReviewNote {
  question: string;
  answer: string;
  reviewNote: string;
}

export interface ZoningOrdinanceLink {
  label: string;
  url: string;
  context: string;
}

export const ZONING_USE_CATEGORY_SOURCE = {
  label: "How Chicago classifies land uses (Section 17-17-0101)",
  url: "https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2684612",
};

const BUSINESS_COMMERCIAL_USE_TABLE =
  "https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2681344";
const RESIDENTIAL_USE_TABLE =
  "https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2681101";
const DOWNTOWN_USE_TABLE =
  "https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2681520";
const MANUFACTURING_USE_TABLE =
  "https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2681764";
const SPECIAL_PURPOSE_CHAPTER =
  "https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-49640";
const TITLE_17 =
  "https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-48750";
const PLANNED_DEVELOPMENTS_CHAPTER =
  "https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-50118";

const CLASSIFICATION_CONTEXT =
  "Chicago's use categories consider the activity, customers or residents, how goods or services are sold or delivered, and site conditions. The Zoning Administrator resolves uses that do not fit one category or appear to fit more than one.";

const COMMON_UNSURE_OPTION = {
  value: "unsure",
  label: "Not sure yet",
  reviewNote: "Flag this detail for confirmation before relying on a use-table row.",
};

export const ZONING_REVIEW_ACTIVITIES: ZoningReviewActivity[] = [
  {
    id: "restaurant",
    label: "Restaurant or cafe",
    questions: [
      {
        id: "drive_through",
        kind: "choice",
        prompt: "Will the project include a drive-through facility?",
        whyItMatters:
          "The published business and commercial use table lists a drive-through facility separately from eating and drinking establishments.",
        sourceLabel: "Business and commercial use table (Section 17-3-0207)",
        sourceUrl: BUSINESS_COMMERCIAL_USE_TABLE,
        options: [
          {
            value: "yes",
            label: "Yes",
            reviewNote:
              "Include the drive-through facility when the City or a zoning professional identifies the applicable use-table rows.",
          },
          {
            value: "no",
            label: "No",
            reviewNote: "No drive-through facility was identified in this intake.",
          },
          COMMON_UNSURE_OPTION,
        ],
      },
      {
        id: "alcohol_plan",
        kind: "choice",
        prompt: "What is the current plan for alcohol at the site?",
        whyItMatters:
          "The published table distinguishes restaurants, taverns, and accessory liquor sales. Alcohol licensing can add a separate review path.",
        sourceLabel: "Business and commercial use table (Section 17-3-0207)",
        sourceUrl: BUSINESS_COMMERCIAL_USE_TABLE,
        options: [
          {
            value: "none",
            label: "No alcohol",
            reviewNote: "No alcohol service or sales were identified in this intake.",
          },
          {
            value: "with_food",
            label: "With food service",
            reviewNote:
              "Confirm the exact restaurant use type and any separate liquor-license requirements.",
          },
          {
            value: "primary",
            label: "Alcohol is a primary offering",
            reviewNote:
              "Ask the City or a zoning professional to confirm whether the proposed operation falls within a tavern or another use category.",
          },
          COMMON_UNSURE_OPTION,
        ],
      },
    ],
  },
  {
    id: "day_care",
    label: "Child or adult day care",
    questions: [
      {
        id: "care_count",
        kind: "choice",
        prompt: "Will the site receive three or more adults or children for care during part or all of the day?",
        whyItMatters:
          "Section 17-17-0103-C uses this threshold in the published definition of day care.",
        sourceLabel: "Day care definition (Section 17-17-0103-C)",
        sourceUrl: ZONING_USE_CATEGORY_SOURCE.url,
        options: [
          {
            value: "yes",
            label: "Yes",
            reviewNote: "Bring the expected number of people served to the use-classification review.",
          },
          {
            value: "no",
            label: "No",
            reviewNote:
              "Ask the City or a zoning professional which use category applies when fewer than three people receive care.",
          },
          COMMON_UNSURE_OPTION,
        ],
      },
      {
        id: "school_operated",
        kind: "choice",
        prompt: "Will a public or private elementary or secondary school system operate the program?",
        whyItMatters:
          "The published day care definition excludes bona fide kindergarten and nursery school programs operated by those school systems.",
        sourceLabel: "Day care definition (Section 17-17-0103-C)",
        sourceUrl: ZONING_USE_CATEGORY_SOURCE.url,
        options: [
          {
            value: "yes",
            label: "Yes",
            reviewNote:
              "Ask the City to confirm the appropriate school or other use category rather than assuming the day care row applies.",
          },
          {
            value: "no",
            label: "No",
            reviewNote: "No school-system operator was identified in this intake.",
          },
          COMMON_UNSURE_OPTION,
        ],
      },
    ],
  },
  {
    id: "urban_agriculture",
    label: "Urban farm or community garden",
    questions: [
      {
        id: "agriculture_type",
        kind: "choice",
        prompt: "Which description is closest to the project?",
        whyItMatters:
          "The ordinance defines community gardens and urban farms separately and applies different standards to them.",
        sourceLabel: "Use-category definitions (Chapter 17-17)",
        sourceUrl: ZONING_USE_CATEGORY_SOURCE.url,
        options: [
          {
            value: "community_garden",
            label: "Community garden",
            reviewNote:
              "Confirm the project against the published community garden definition and use standards, including its purpose and site size.",
          },
          {
            value: "urban_farm",
            label: "Urban farm",
            reviewNote: "Confirm the project against the published urban farm definition and use standards.",
          },
          {
            value: "other",
            label: "Another growing project",
            reviewNote:
              "Describe the operation to the City or a zoning professional so the appropriate use category can be identified.",
          },
          COMMON_UNSURE_OPTION,
        ],
      },
      {
        id: "operation_location",
        kind: "choice",
        prompt: "Where will growing or related operations occur?",
        whyItMatters:
          "The published business and commercial use table separates indoor, outdoor, and rooftop urban farm operations.",
        sourceLabel: "Business and commercial use table (Section 17-3-0207)",
        sourceUrl: BUSINESS_COMMERCIAL_USE_TABLE,
        options: [
          {
            value: "indoor",
            label: "Indoors",
            reviewNote: "Include the indoor operation when the exact use-table row is reviewed.",
          },
          {
            value: "outdoor",
            label: "Outdoors",
            reviewNote: "Include the outdoor operation and site plan when the exact use-table row is reviewed.",
          },
          {
            value: "rooftop",
            label: "On a rooftop",
            reviewNote: "Include the rooftop operation and building details when the exact use-table row is reviewed.",
          },
          {
            value: "mixed",
            label: "More than one",
            reviewNote: "Review every indoor, outdoor, and rooftop component rather than selecting only one row.",
          },
          COMMON_UNSURE_OPTION,
        ],
      },
    ],
  },
  {
    id: "motor_vehicle_repair",
    label: "Motor vehicle repair",
    questions: [
      {
        id: "repair_scope",
        kind: "choice",
        prompt: "Will the shop perform body work, painting, or commercial-vehicle repairs?",
        whyItMatters:
          "The published business and commercial use table separates repair shops that include these activities from other motor vehicle repair shops.",
        sourceLabel: "Business and commercial use table (Section 17-3-0207)",
        sourceUrl: BUSINESS_COMMERCIAL_USE_TABLE,
        options: [
          {
            value: "yes",
            label: "Yes",
            reviewNote: "Include body work, painting, and commercial-vehicle work in the use-classification review.",
          },
          {
            value: "no",
            label: "No",
            reviewNote: "No body work, painting, or commercial-vehicle repair was identified in this intake.",
          },
          COMMON_UNSURE_OPTION,
        ],
      },
      {
        id: "vehicle_activities",
        kind: "choice",
        prompt: "Will vehicle sales, rental, towing, or storage also occur?",
        whyItMatters:
          "The ordinance lists several vehicle sales and service activities as separate use types.",
        sourceLabel: "Business and commercial use table (Section 17-3-0207)",
        sourceUrl: BUSINESS_COMMERCIAL_USE_TABLE,
        options: [
          {
            value: "none",
            label: "None of these",
            reviewNote: "No additional vehicle sales, rental, towing, or storage activity was identified.",
          },
          {
            value: "sales_or_rental",
            label: "Sales or rental",
            reviewNote: "Include whether sales or rental activity is indoors or outdoors in the use review.",
          },
          {
            value: "towing_or_storage",
            label: "Towing or storage",
            reviewNote: "Include the towing or storage operation in the use review.",
          },
          {
            value: "multiple",
            label: "More than one",
            reviewNote: "Review each vehicle-related activity as a potentially separate use type.",
          },
          COMMON_UNSURE_OPTION,
        ],
      },
    ],
  },
  {
    id: "capital_project",
    label: "Major construction or redevelopment",
    questions: [
      {
        id: "capital_project_scope",
        kind: "choice",
        prompt: "Which description is closest to the proposed physical work?",
        whyItMatters:
          "Project scope can change which use categories, development standards, and site-specific review thresholds need to be checked.",
        sourceLabel: "Planned developments (Chapter 17-8)",
        sourceUrl: PLANNED_DEVELOPMENTS_CHAPTER,
        options: [
          {
            value: "ground_up_or_addition",
            label: "Ground-up or major addition",
            reviewNote:
              "Bring the proposed floor area, height, site area, uses, and building count to the entitlement review.",
          },
          {
            value: "adaptive_reuse",
            label: "Adaptive reuse or major rehabilitation",
            reviewNote:
              "Confirm the existing and proposed uses, occupancy, exterior work, and any nonconforming conditions.",
          },
          {
            value: "mixed_use_or_multifamily",
            label: "Mixed-use or multifamily development",
            reviewNote:
              "Identify every principal use, unit count, floor area, height, parking plan, and ground-floor activity.",
          },
          {
            value: "industrial_expansion",
            label: "Industrial expansion",
            reviewNote:
              "Document the production, storage, freight, outdoor, environmental, and infrastructure components of the expansion.",
          },
          COMMON_UNSURE_OPTION,
        ],
      },
      {
        id: "capital_project_scale",
        kind: "choice",
        prompt: "Could the project combine multiple principal uses or involve substantial height, floor area, or site area?",
        whyItMatters:
          "Chapter 17-8 contains mandatory and elective planned-development thresholds that depend on project and site characteristics.",
        sourceLabel: "Planned developments (Chapter 17-8)",
        sourceUrl: PLANNED_DEVELOPMENTS_CHAPTER,
        options: [
          {
            value: "yes",
            label: "Yes",
            reviewNote:
              "Review the current Chapter 17-8 thresholds and confirm whether a planned development or another entitlement path applies.",
          },
          {
            value: "no",
            label: "No",
            reviewNote:
              "No large-scale or mixed-use characteristic was identified here; district-specific and use-specific thresholds still need review.",
          },
          COMMON_UNSURE_OPTION,
        ],
      },
    ],
  },
  {
    id: "other",
    label: "Another project type",
    questions: [
      {
        id: "primary_activity",
        kind: "text",
        prompt: "What will be sold, prepared, repaired, produced, stored, or delivered at the site?",
        whyItMatters: CLASSIFICATION_CONTEXT,
        sourceLabel: ZONING_USE_CATEGORY_SOURCE.label,
        sourceUrl: ZONING_USE_CATEGORY_SOURCE.url,
        placeholder: "Describe the primary activity and anything secondary that will also happen on site.",
      },
      {
        id: "site_activity",
        kind: "text",
        prompt: "What customer, vehicle, delivery, or outdoor activity will regularly occur?",
        whyItMatters: CLASSIFICATION_CONTEXT,
        sourceLabel: ZONING_USE_CATEGORY_SOURCE.label,
        sourceUrl: ZONING_USE_CATEGORY_SOURCE.url,
        placeholder: "Note customer visits, loading, drive-through service, outdoor work or storage, and similar details.",
      },
    ],
  },
];

export function getZoningReviewActivity(
  activityId: ZoningReviewActivityId,
): ZoningReviewActivity {
  return (
    ZONING_REVIEW_ACTIVITIES.find((activity) => activity.id === activityId) ??
    ZONING_REVIEW_ACTIVITIES[ZONING_REVIEW_ACTIVITIES.length - 1]
  );
}

export function buildZoningReviewNotes(
  activityId: ZoningReviewActivityId,
  answers: Record<string, string>,
): ZoningReviewNote[] {
  const activity = getZoningReviewActivity(activityId);

  return activity.questions.flatMap((question) => {
    const value = answers[question.id]?.trim();
    if (!value) return [];

    if (question.kind === "text") {
      return [{
        question: question.prompt,
        answer: value,
        reviewNote: "Use this description when the exact ordinance use category is confirmed.",
      }];
    }

    const selected = question.options.find((option) => option.value === value);
    if (!selected) return [];

    return [{
      question: question.prompt,
      answer: selected.label,
      reviewNote: selected.reviewNote,
    }];
  });
}

export function getDistrictUseTableLink(zoneClass: string): ZoningOrdinanceLink {
  const district = zoneClass.trim().toUpperCase();

  if (district.startsWith("PD")) {
    return {
      label: "Title 17 and the site-specific planned development ordinance",
      url: TITLE_17,
      context:
        "A planned development has site-specific controlling documents. Review those documents before using a base-district table.",
    };
  }

  if (district.startsWith("PMD") || district.startsWith("POS") || /^T(?:-|$)/.test(district)) {
    return {
      label: "Special-purpose district chapter (Chapter 17-6)",
      url: SPECIAL_PURPOSE_CHAPTER,
      context:
        "Special-purpose districts require review of the applicable district and subarea provisions.",
    };
  }

  if (/^(RS|RT|RM)/.test(district)) {
    return {
      label: "Residential district use table (Section 17-2-0207)",
      url: RESIDENTIAL_USE_TABLE,
      context: "Use the published residential table only after the exact ordinance use category is confirmed.",
    };
  }

  if (/^[BC]/.test(district)) {
    return {
      label: "Business and commercial use table (Section 17-3-0207)",
      url: BUSINESS_COMMERCIAL_USE_TABLE,
      context:
        "Use the published business and commercial table only after the exact ordinance use category is confirmed.",
    };
  }

  if (/^D[CRXS]/.test(district)) {
    return {
      label: "Downtown district use table (Section 17-4-0207)",
      url: DOWNTOWN_USE_TABLE,
      context: "Use the published downtown table only after the exact ordinance use category is confirmed.",
    };
  }

  if (/^M[123]/.test(district)) {
    return {
      label: "Manufacturing district use table (Section 17-5-0207)",
      url: MANUFACTURING_USE_TABLE,
      context:
        "Use the published manufacturing table only after the exact ordinance use category is confirmed.",
    };
  }

  return {
    label: "Title 17 Chicago Zoning Ordinance",
    url: TITLE_17,
    context:
      "The district family was not recognized by this guide. Confirm the controlling district provisions with the City.",
  };
}
