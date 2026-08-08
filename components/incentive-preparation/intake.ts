import type {
  PreparationContext,
  PreparationProgramCandidate,
} from "./report-context";
import type { BusinessProfile } from "./types";
import {
  GOAL_OPTIONS,
  isGoalType,
  type GoalType,
} from "@/lib/workspace";

export interface PreparationIntakeDraft {
  legalBusinessName: string;
  dbaName: string;
  physicalAddress: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  industry: string;
  entityType: string;
  formationDate: string;
  employeeCount: string;
  primaryGoal: string;
  selectedProgramId: string;
  selectedProgramLabel: string;
}

export type PreparationIntakeErrors = Partial<
  Record<keyof PreparationIntakeDraft, string>
>;

export const EMPTY_PREPARATION_INTAKE: PreparationIntakeDraft = {
  legalBusinessName: "",
  dbaName: "",
  physicalAddress: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  industry: "",
  entityType: "",
  formationDate: "",
  employeeCount: "",
  primaryGoal: "",
  selectedProgramId: "",
  selectedProgramLabel: "",
};

function clean(value: string): string {
  return value.trim();
}

const GOAL_ALIASES: Record<string, GoalType> = {
  remodel: "improve-storefront",
  renovation: "improve-storefront",
  storefront: "improve-storefront",
  equipment: "buy-equipment",
  hiring: "hire-staff",
  hire: "hire-staff",
  expansion: "expand-location",
  expand: "expand-location",
  relocation: "open-relocate",
  relocate: "open-relocate",
  vacancy: "acquire-vacant-property",
  development: "development-feasibility",
};

export function normalizeGoalType(value: string): GoalType | "" {
  const cleaned = clean(value);
  if (isGoalType(cleaned)) return cleaned;

  const normalized = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const option = GOAL_OPTIONS.find(
    (goal) => goal.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === normalized,
  );
  if (option) return option.id;

  for (const [keyword, goalType] of Object.entries(GOAL_ALIASES)) {
    if (normalized.includes(keyword)) return goalType;
  }
  return "";
}

export function draftFromContext(
  context: PreparationContext | null,
  contactEmail = "",
): PreparationIntakeDraft {
  const firstProgram = context?.programs[0];
  return {
    ...EMPTY_PREPARATION_INTAKE,
    physicalAddress: context?.address ?? "",
    contactEmail,
    industry: context?.industry ?? "",
    primaryGoal: normalizeGoalType(context?.projectGoal ?? ""),
    selectedProgramId: firstProgram?.programId ?? "",
    selectedProgramLabel: firstProgram?.label ?? "",
  };
}

export function draftFromProfile(
  profile: BusinessProfile,
  current: PreparationIntakeDraft,
): PreparationIntakeDraft {
  return {
    ...current,
    legalBusinessName: profile.legalBusinessName,
    dbaName: profile.dbaName,
    physicalAddress: profile.physicalAddress || current.physicalAddress,
    contactName: profile.contactName,
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone,
    industry: profile.industry || current.industry,
    entityType: profile.entityType,
    formationDate: profile.formationDate,
    employeeCount: profile.employeeCount,
  };
}

export function selectProgramCandidate(
  draft: PreparationIntakeDraft,
  programId: string,
  programs: PreparationProgramCandidate[],
): PreparationIntakeDraft {
  const candidate = programs.find((program) => program.programId === programId);
  return {
    ...draft,
    selectedProgramId: candidate?.programId ?? "",
    selectedProgramLabel: candidate?.label ?? "",
  };
}

export function validatePreparationIntake(
  draft: PreparationIntakeDraft,
): PreparationIntakeErrors {
  const errors: PreparationIntakeErrors = {};
  const required: Array<[keyof PreparationIntakeDraft, string]> = [
    ["legalBusinessName", "Legal business name is required."],
    ["physicalAddress", "Physical or project address is required."],
    ["contactName", "Contact name is required."],
    ["contactEmail", "Contact email is required."],
    ["primaryGoal", "Primary goal is required."],
    ["selectedProgramLabel", "Select a program to prepare for."],
  ];

  for (const [field, message] of required) {
    if (!clean(draft[field])) errors[field] = message;
  }

  const email = clean(draft.contactEmail);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.contactEmail = "Enter a valid contact email.";
  }

  return errors;
}

/**
 * Foundation-first validation: only the Business File profile facts are
 * required. A goal and a target program are chosen later on the packet, so they
 * are not validated here.
 */
export function validateBusinessFileIntake(
  draft: PreparationIntakeDraft,
): PreparationIntakeErrors {
  const errors: PreparationIntakeErrors = {};
  const required: Array<[keyof PreparationIntakeDraft, string]> = [
    ["legalBusinessName", "Legal business name is required."],
    ["physicalAddress", "Physical or project address is required."],
    ["contactName", "Contact name is required."],
    ["contactEmail", "Contact email is required."],
  ];

  for (const [field, message] of required) {
    if (!clean(draft[field])) errors[field] = message;
  }

  const email = clean(draft.contactEmail);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.contactEmail = "Enter a valid contact email.";
  }

  return errors;
}

export function buildBusinessProfilePayload(draft: PreparationIntakeDraft) {
  return {
    legalName: clean(draft.legalBusinessName),
    dbaName: clean(draft.dbaName) || null,
    physicalAddress: clean(draft.physicalAddress),
    contactName: clean(draft.contactName),
    contactEmail: clean(draft.contactEmail),
    contactPhone: clean(draft.contactPhone) || null,
    industry: clean(draft.industry) || null,
    entityType: clean(draft.entityType) || null,
    formationDate: clean(draft.formationDate) || null,
    employeeCount: Number.isInteger(Number(clean(draft.employeeCount)))
      ? Number(clean(draft.employeeCount))
      : null,
  };
}

export function buildPreparationPayload(
  draft: PreparationIntakeDraft,
  profileId: string,
  context: PreparationContext | null,
) {
  return {
    ...(profileId
      ? { profileId }
      : { profile: buildBusinessProfilePayload(draft) }),
    goalType: clean(draft.primaryGoal),
    programId: clean(draft.selectedProgramId) || null,
    programName: clean(draft.selectedProgramLabel),
    projectId: context?.projectId || null,
    projectAddress: clean(draft.physicalAddress) || context?.address || null,
  };
}

/**
 * Foundation-first payload: creates a Business File packet with no goal and no
 * program. The API detects the absence of both and generates the foundation
 * scope only; a target incentive is layered on later.
 */
export function buildFoundationPayload(
  draft: PreparationIntakeDraft,
  profileId: string,
  context: PreparationContext | null,
) {
  return {
    ...(profileId
      ? { profileId }
      : { profile: buildBusinessProfilePayload(draft) }),
    projectId: context?.projectId || null,
    projectAddress: clean(draft.physicalAddress) || context?.address || null,
  };
}
