import type { GoalType } from "./workspace";
import type { VerificationStep } from "./types";

export const PREPARATION_TASK_STATUSES = [
  "needs_document",
  "needs_owner_answer",
  "needs_advisor",
  "external_dependency",
  "requires_certification",
  "complete",
] as const;

export type PreparationTaskStatus = (typeof PREPARATION_TASK_STATUSES)[number];

export const PREPARATION_TASK_OWNERS = [
  "business",
  "advisor",
  "accountant",
  "landlord",
  "local_partner",
  "program_administrator",
] as const;

export type PreparationTaskOwner = (typeof PREPARATION_TASK_OWNERS)[number];

export const PREPARATION_PACKET_STATUSES = [
  "foundation_complete",
  "needs_information",
  "waiting_on_others",
  "needs_advisor",
  "requires_certification",
  "ready_to_submit",
] as const;

export type PreparationPacketStatus = (typeof PREPARATION_PACKET_STATUSES)[number];

export type PreparationTaskCategory =
  | "foundation"
  | "goal"
  | "dependency"
  | "certification";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | ReadonlyArray<JsonValue>
  | { [key: string]: JsonValue };

type DeepReadonly<T> = Readonly<T>;

export interface BusinessProfileInput {
  legalName?: string | null;
  dbaName?: string | null;
  physicalAddress?: string | null;
  mailingAddress?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  entityType?: string | null;
  formationDate?: string | null;
  industry?: string | null;
  naicsCode?: string | null;
  employeeCount?: number | null;
  ownershipNotes?: string | null;
  licenses?: JsonValue;
  fieldProvenance?: Record<string, JsonValue>;
}

export interface BusinessProfileSnapshot {
  legalName: string | null;
  dbaName: string | null;
  physicalAddress: string | null;
  mailingAddress: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  entityType: string | null;
  formationDate: string | null;
  industry: string | null;
  naicsCode: string | null;
  employeeCount: number | null;
  ownershipNotes: string | null;
  licenses: JsonValue;
  fieldProvenance: Record<string, JsonValue>;
}

export interface PreparationTask {
  id: string;
  title: string;
  description: string;
  status: PreparationTaskStatus;
  owner: PreparationTaskOwner;
  category: PreparationTaskCategory;
  dependsOn: string[];
  estimatedMinWeeks: number;
  estimatedMaxWeeks: number;
  programId?: string;
  programName?: string;
  requiredProfileFields?: Array<keyof BusinessProfileSnapshot>;
  applicantOnly?: boolean;
  completionAuthority?: "applicant_or_authorized_representative";
}

export interface PreparationTimeline {
  asOfDate: string;
  estimatedMinWeeks: number;
  estimatedMaxWeeks: number;
  estimatedWeeks: {
    min: number;
    max: number;
  };
  earliestRealisticDate: string;
  criticalPathTaskIds: string[];
  owners: PreparationTaskOwner[];
  parallelizableWork: string[][];
  parallelizableTaskIds: string[];
}

export interface BuildPreparationTasksInput {
  /**
   * The target incentive's goal overlay. When omitted (foundation-first
   * "Business File" packets), only the program-agnostic foundation scope is
   * generated — identity/address/contact plus the reusable continuity
   * documents — with no goal, program, or certification work.
   */
  goalType?: GoalType | null;
  programId?: string | null;
  programName?: string | null;
  programRequiredDocs?: readonly string[];
  programVerificationSteps?: ReadonlyArray<
    Pick<VerificationStep, "label" | "agency" | "kind" | "appliesBefore" | "note">
  >;
  profile: BusinessProfileInput;
}

export const OFFICIAL_CERTIFICATION_TASK_ID = "official-certification-submission";

const FOUNDATION_IDENTITY_TASK_ID = "foundation-business-identity";
const FOUNDATION_ADDRESS_TASK_ID = "foundation-addresses";
const FOUNDATION_CONTACT_TASK_ID = "foundation-authorized-contact";
const PROGRAM_REQUIREMENTS_TASK_ID = "program-application-requirements";
const FINANCIALS_TASK_ID = "accountant-financials";
const TAX_STANDING_TASK_ID = "tax-good-standing";
const SITE_CONTROL_TASK_ID = "landlord-site-control";
const ZONING_TASK_ID = "zoning-permits";
const LOCAL_SUPPORT_TASK_ID = "local-support-letter";
const ADVISOR_REVIEW_TASK_ID = "advisor-application-review";

interface GoalOverlay {
  tasks: PreparationTask[];
  needsSiteControl: boolean;
  needsZoningReview: boolean;
  needsLocalSupportLetter: boolean;
}

function goalTask(
  id: string,
  title: string,
  description: string,
  status: Extract<PreparationTaskStatus, "needs_document" | "needs_owner_answer">,
  dependsOn: string[],
  estimatedMinWeeks: number,
  estimatedMaxWeeks: number
): PreparationTask {
  return {
    id,
    title,
    description,
    status,
    owner: "business",
    category: "goal",
    dependsOn,
    estimatedMinWeeks,
    estimatedMaxWeeks,
  };
}

const GOAL_OVERLAYS: Record<GoalType, GoalOverlay> = {
  "improve-storefront": {
    tasks: [
      goalTask(
        "storefront-improvement-scope",
        "Define the storefront improvement scope",
        "Describe the proposed exterior and interior work, the business purpose, and the preferred schedule for application preparation.",
        "needs_owner_answer",
        [FOUNDATION_IDENTITY_TASK_ID, FOUNDATION_ADDRESS_TASK_ID],
        1,
        2
      ),
      goalTask(
        "storefront-contractor-materials",
        "Collect contractor scopes and estimates",
        "Gather comparable scopes, estimates, and supporting project documents without treating them as an award commitment.",
        "needs_document",
        ["storefront-improvement-scope"],
        1,
        3
      ),
    ],
    needsSiteControl: true,
    needsZoningReview: true,
    needsLocalSupportLetter: true,
  },
  "buy-equipment": {
    tasks: [
      goalTask(
        "equipment-use-plan",
        "Define the equipment use plan",
        "List the equipment, how the business will use it, and the intended operating timeline for application preparation.",
        "needs_owner_answer",
        [FOUNDATION_IDENTITY_TASK_ID],
        1,
        2
      ),
      goalTask(
        "equipment-vendor-materials",
        "Collect vendor specifications and quotes",
        "Gather current vendor specifications, quotes, and purchasing terms for the equipment under consideration.",
        "needs_document",
        ["equipment-use-plan"],
        1,
        3
      ),
    ],
    needsSiteControl: false,
    needsZoningReview: false,
    needsLocalSupportLetter: false,
  },
  "hire-staff": {
    tasks: [
      goalTask(
        "staffing-plan",
        "Define the staffing plan",
        "Document roles, anticipated wages, work locations, and the hiring schedule for application preparation.",
        "needs_owner_answer",
        [FOUNDATION_IDENTITY_TASK_ID, FOUNDATION_ADDRESS_TASK_ID],
        1,
        2
      ),
      goalTask(
        "workforce-records",
        "Collect workforce and payroll records",
        "Gather current staffing, payroll, and job-description records needed to explain the hiring plan.",
        "needs_document",
        ["staffing-plan"],
        1,
        3
      ),
    ],
    needsSiteControl: false,
    needsZoningReview: false,
    needsLocalSupportLetter: false,
  },
  "expand-location": {
    tasks: [
      goalTask(
        "expansion-scope",
        "Define the expansion scope",
        "Describe the space constraints, proposed work, operating changes, and schedule for application preparation.",
        "needs_owner_answer",
        [FOUNDATION_IDENTITY_TASK_ID, FOUNDATION_ADDRESS_TASK_ID],
        1,
        2
      ),
      goalTask(
        "expansion-project-materials",
        "Collect expansion plans and estimates",
        "Gather plans, scopes, estimates, and other documents that support the proposed expansion.",
        "needs_document",
        ["expansion-scope"],
        1,
        3
      ),
    ],
    needsSiteControl: true,
    needsZoningReview: true,
    needsLocalSupportLetter: true,
  },
  "open-relocate": {
    tasks: [
      goalTask(
        "opening-relocation-plan",
        "Define the opening or relocation plan",
        "Document the target site, operating plan, move or opening schedule, and intended use for application preparation.",
        "needs_owner_answer",
        [FOUNDATION_IDENTITY_TASK_ID, FOUNDATION_ADDRESS_TASK_ID],
        1,
        2
      ),
      goalTask(
        "opening-relocation-materials",
        "Collect site and startup materials",
        "Gather site comparisons, preliminary layouts, estimates, and supporting operating documents.",
        "needs_document",
        ["opening-relocation-plan"],
        1,
        3
      ),
    ],
    needsSiteControl: true,
    needsZoningReview: true,
    needsLocalSupportLetter: true,
  },
  "acquire-vacant-property": {
    tasks: [
      goalTask(
        "vacant-property-acquisition-plan",
        "Define the property acquisition plan",
        "Document the target property, proposed use, acquisition approach, and preparation schedule.",
        "needs_owner_answer",
        [FOUNDATION_IDENTITY_TASK_ID, FOUNDATION_ADDRESS_TASK_ID],
        1,
        2
      ),
      goalTask(
        "vacant-property-due-diligence",
        "Collect property due-diligence materials",
        "Gather ownership, parcel, condition, environmental, and preliminary development records available for the site.",
        "needs_document",
        ["vacant-property-acquisition-plan"],
        2,
        4
      ),
    ],
    needsSiteControl: true,
    needsZoningReview: true,
    needsLocalSupportLetter: true,
  },
  "development-feasibility": {
    tasks: [
      goalTask(
        "development-concept",
        "Define the development concept",
        "Describe the proposed use, project partners, site assumptions, and decision timeline for application preparation.",
        "needs_owner_answer",
        [FOUNDATION_IDENTITY_TASK_ID, FOUNDATION_ADDRESS_TASK_ID],
        1,
        2
      ),
      goalTask(
        "development-feasibility-materials",
        "Collect feasibility and site materials",
        "Gather concept plans, site records, condition findings, estimates, and other feasibility documents.",
        "needs_document",
        ["development-concept"],
        2,
        4
      ),
    ],
    needsSiteControl: true,
    needsZoningReview: true,
    needsLocalSupportLetter: true,
  },
};

const TASK_STATUS_SET = new Set<string>(PREPARATION_TASK_STATUSES);
const TASK_OWNER_SET = new Set<string>(PREPARATION_TASK_OWNERS);
const TASK_CATEGORY_SET = new Set<string>([
  "foundation",
  "goal",
  "dependency",
  "certification",
]);

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function cloneJsonValue(value: unknown, fallback: JsonValue): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item, null));
  }
  if (value && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined && typeof item !== "function" && typeof item !== "symbol") {
        result[key] = cloneJsonValue(item, null);
      }
    }
    return result;
  }
  return fallback;
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value as DeepReadonly<T>;
}

export function buildProfileSnapshot(
  profile: BusinessProfileInput
): DeepReadonly<BusinessProfileSnapshot> {
  const employeeCount =
    typeof profile.employeeCount === "number" &&
    Number.isFinite(profile.employeeCount) &&
    profile.employeeCount >= 0
      ? Math.trunc(profile.employeeCount)
      : null;
  const licenses = cloneJsonValue(profile.licenses, []);
  const provenance = cloneJsonValue(profile.fieldProvenance, {});

  const snapshot: BusinessProfileSnapshot = {
    legalName: normalizeText(profile.legalName),
    dbaName: normalizeText(profile.dbaName),
    physicalAddress: normalizeText(profile.physicalAddress),
    mailingAddress: normalizeText(profile.mailingAddress),
    contactName: normalizeText(profile.contactName),
    contactEmail: normalizeText(profile.contactEmail)?.toLowerCase() ?? null,
    contactPhone: normalizeText(profile.contactPhone),
    entityType: normalizeText(profile.entityType),
    formationDate: normalizeText(profile.formationDate),
    industry: normalizeText(profile.industry),
    naicsCode: normalizeText(profile.naicsCode),
    employeeCount,
    ownershipNotes: normalizeText(profile.ownershipNotes),
    licenses,
    fieldProvenance: isJsonObject(provenance) ? provenance : {},
  };

  return deepFreeze(snapshot);
}

function allPresent(
  snapshot: DeepReadonly<BusinessProfileSnapshot>,
  fields: Array<keyof BusinessProfileSnapshot>
): boolean {
  return fields.every((field) => {
    const value = snapshot[field];
    return typeof value === "string" ? value.length > 0 : value !== null;
  });
}

function withProgramContext(
  task: PreparationTask,
  programId: string | null,
  programName: string | null
): PreparationTask {
  return {
    ...task,
    dependsOn: [...task.dependsOn],
    ...(programId ? { programId } : {}),
    ...(programName ? { programName } : {}),
  };
}

/**
 * The reusable continuity documents (accountant-reviewed financials and tax /
 * good-standing records). They carry category "dependency" but bank into the
 * foundation scope via CONTINUITY_TASK_IDS, so both the full application build
 * and the foundation-only Business File emit them identically. They depend only
 * on business identity — program-agnostic, preparable before any goal exists.
 */
function buildContinuityTasks(): PreparationTask[] {
  return [
    {
      id: FINANCIALS_TASK_ID,
      title: "Prepare accountant-reviewed financials",
      description:
        "Coordinate with an accountant to assemble the current financial and tax records needed for application preparation. These records are reusable across programs.",
      status: "external_dependency",
      owner: "accountant",
      category: "dependency",
      dependsOn: [FOUNDATION_IDENTITY_TASK_ID],
      estimatedMinWeeks: 1,
      estimatedMaxWeeks: 3,
    },
    {
      id: TAX_STANDING_TASK_ID,
      title: "Obtain tax and good-standing records",
      description:
        "Request current tax-clearance and entity good-standing records from the appropriate issuing offices for application preparation.",
      status: "external_dependency",
      owner: "accountant",
      category: "dependency",
      dependsOn: [FOUNDATION_IDENTITY_TASK_ID],
      estimatedMinWeeks: 1,
      estimatedMaxWeeks: 3,
    },
  ];
}

export function buildPreparationTasks({
  goalType = null,
  programId,
  programName,
  programRequiredDocs = [],
  programVerificationSteps = [],
  profile,
}: BuildPreparationTasksInput): PreparationTask[] {
  const snapshot = buildProfileSnapshot(profile);
  const normalizedProgramId = normalizeText(programId);
  const normalizedProgramName = normalizeText(programName);
  const identityFields: Array<keyof BusinessProfileSnapshot> = [
    "legalName",
    "entityType",
    "formationDate",
    "industry",
    "naicsCode",
  ];
  const addressFields: Array<keyof BusinessProfileSnapshot> = [
    "physicalAddress",
    "mailingAddress",
  ];
  const contactFields: Array<keyof BusinessProfileSnapshot> = [
    "contactName",
    "contactEmail",
    "contactPhone",
  ];

  const tasks: PreparationTask[] = [
    {
      id: FOUNDATION_IDENTITY_TASK_ID,
      title: "Confirm the business identity",
      description:
        "Confirm the legal name, entity details, formation date, industry, and NAICS code used for application preparation.",
      status: allPresent(snapshot, identityFields) ? "complete" : "needs_owner_answer",
      owner: "business",
      category: "foundation",
      dependsOn: [],
      estimatedMinWeeks: 0.5,
      estimatedMaxWeeks: 1,
      requiredProfileFields: identityFields,
    },
    {
      id: FOUNDATION_ADDRESS_TASK_ID,
      title: "Confirm physical and mailing addresses",
      description:
        "Confirm the physical project address and the mailing address that should appear in preparation materials.",
      status: allPresent(snapshot, addressFields) ? "complete" : "needs_owner_answer",
      owner: "business",
      category: "foundation",
      dependsOn: [],
      estimatedMinWeeks: 0.5,
      estimatedMaxWeeks: 1,
      requiredProfileFields: addressFields,
    },
    {
      id: FOUNDATION_CONTACT_TASK_ID,
      title: "Confirm the authorized contact",
      description:
        "Confirm the person authorized to coordinate application preparation and their current contact information.",
      status: allPresent(snapshot, contactFields) ? "complete" : "needs_owner_answer",
      owner: "business",
      category: "foundation",
      dependsOn: [FOUNDATION_IDENTITY_TASK_ID],
      estimatedMinWeeks: 0.5,
      estimatedMaxWeeks: 1,
      requiredProfileFields: contactFields,
    },
  ];

  if (!goalType) {
    // Foundation-first "Business File": program-agnostic scope only. No goal
    // overlay, no program/dependency/certification work — those layer in later
    // through mergePreparationProgramTasks when a target incentive is chosen.
    tasks.push(...buildContinuityTasks());
    return tasks.map((task) => withProgramContext(task, null, null));
  }

  const overlay = GOAL_OVERLAYS[goalType];
  const overlayTasks = overlay.tasks.map((task) => ({
    ...task,
    dependsOn: [...task.dependsOn],
  }));
  tasks.push(...overlayTasks);

  const goalFoundationTaskId = overlayTasks[0].id;
  const goalDocumentTaskId = overlayTasks[overlayTasks.length - 1].id;
  const programLabel = normalizedProgramName
    ? normalizedProgramName
    : "the selected likely match";

  tasks.push({
    id: PROGRAM_REQUIREMENTS_TASK_ID,
    title: "Confirm current program requirements",
    description:
      "Ask the program administrator to confirm the current application preparation checklist, timing, and submission channel for " +
      programLabel +
      ".",
    status: "external_dependency",
    owner: "program_administrator",
    category: "dependency",
    dependsOn: [
      FOUNDATION_IDENTITY_TASK_ID,
      FOUNDATION_ADDRESS_TASK_ID,
      FOUNDATION_CONTACT_TASK_ID,
      goalFoundationTaskId,
    ],
    estimatedMinWeeks: 0.5,
    estimatedMaxWeeks: 2,
  });

  const programDocumentTaskIds: string[] = [];
  const seenProgramDocuments = new Set<string>();
  for (const requirement of programRequiredDocs) {
    const label = normalizeText(requirement);
    const normalizedLabel = label?.toLowerCase();
    if (!label || !normalizedLabel || seenProgramDocuments.has(normalizedLabel)) continue;
    seenProgramDocuments.add(normalizedLabel);
    const id = `program-document-${programDocumentTaskIds.length + 1}`;
    programDocumentTaskIds.push(id);
    tasks.push({
      id,
      title: `Collect program document: ${label}`,
      description: `Add the current ${label} requested for ${programLabel}, then confirm the document remains current before official submission.`,
      status: "needs_document",
      owner: "business",
      category: "goal",
      dependsOn: [PROGRAM_REQUIREMENTS_TASK_ID, FOUNDATION_IDENTITY_TASK_ID],
      estimatedMinWeeks: 0.5,
      estimatedMaxWeeks: 2,
    });
  }

  const programVerificationTaskIds: string[] = [];
  const seenVerificationSteps = new Set<string>();
  for (const step of programVerificationSteps) {
    const label = normalizeText(step.label);
    const normalizedLabel = label?.toLowerCase();
    if (!label || !normalizedLabel || seenVerificationSteps.has(normalizedLabel)) continue;
    seenVerificationSteps.add(normalizedLabel);
    const id = `program-verification-${programVerificationTaskIds.length + 1}`;
    const agency = normalizeText(step.agency) || "the program administrator";
    const note = normalizeText(step.note);
    programVerificationTaskIds.push(id);
    tasks.push({
      id,
      title: `Confirm program step: ${label}`,
      description: `Confirm this pre-application step with ${agency}.${note ? ` ${note}` : ""}`,
      status: "external_dependency",
      owner: "program_administrator",
      category: "dependency",
      dependsOn: [PROGRAM_REQUIREMENTS_TASK_ID, FOUNDATION_ADDRESS_TASK_ID],
      estimatedMinWeeks: 0.5,
      estimatedMaxWeeks: 2,
    });
  }

  tasks.push(...buildContinuityTasks());

  if (overlay.needsSiteControl) {
    tasks.push({
      id: SITE_CONTROL_TASK_ID,
      title: "Document site control or landlord authorization",
      description:
        "Obtain the lease, ownership record, letter of intent, or landlord authorization appropriate to the proposed project.",
      status: "external_dependency",
      owner: "landlord",
      category: "dependency",
      dependsOn: [FOUNDATION_ADDRESS_TASK_ID, goalFoundationTaskId],
      estimatedMinWeeks: 1,
      estimatedMaxWeeks: 4,
    });
  }

  if (overlay.needsZoningReview) {
    tasks.push({
      id: ZONING_TASK_ID,
      title: "Confirm zoning and permit path",
      description:
        "Request written zoning and permit guidance for the proposed use and scope before finalizing application preparation materials.",
      status: "external_dependency",
      owner: "program_administrator",
      category: "dependency",
      dependsOn: [SITE_CONTROL_TASK_ID, goalFoundationTaskId, PROGRAM_REQUIREMENTS_TASK_ID],
      estimatedMinWeeks: 2,
      estimatedMaxWeeks: 6,
    });
  }

  if (overlay.needsLocalSupportLetter) {
    tasks.push({
      id: LOCAL_SUPPORT_TASK_ID,
      title: "Request a local support letter",
      description:
        "After explicit consent to share the stated information, ask a local partner for the support letter needed for application preparation.",
      status: "external_dependency",
      owner: "local_partner",
      category: "dependency",
      dependsOn: [
        PROGRAM_REQUIREMENTS_TASK_ID,
        goalDocumentTaskId,
        ...(overlay.needsZoningReview ? [ZONING_TASK_ID] : []),
      ],
      estimatedMinWeeks: 1,
      estimatedMaxWeeks: 3,
    });
  }

  const advisorDependencies = [
    PROGRAM_REQUIREMENTS_TASK_ID,
    FINANCIALS_TASK_ID,
    TAX_STANDING_TASK_ID,
    goalDocumentTaskId,
    ...programDocumentTaskIds,
    ...programVerificationTaskIds,
    ...(overlay.needsSiteControl ? [SITE_CONTROL_TASK_ID] : []),
    ...(overlay.needsZoningReview ? [ZONING_TASK_ID] : []),
    ...(overlay.needsLocalSupportLetter ? [LOCAL_SUPPORT_TASK_ID] : []),
  ];

  tasks.push({
    id: ADVISOR_REVIEW_TASK_ID,
    title: "Review the preparation packet with an advisor",
    description:
      "Have an advisor review the assembled materials for completeness and unresolved questions without treating the review as an award decision.",
    status: "needs_advisor",
    owner: "advisor",
    category: "dependency",
    dependsOn: advisorDependencies,
    estimatedMinWeeks: 1,
    estimatedMaxWeeks: 2,
  });

  tasks.push({
    id: OFFICIAL_CERTIFICATION_TASK_ID,
    title: "Complete official certification and submission",
    description:
      "Review the Incentive Preparation Packet, make every official certification, and submit the application. Only the applicant or an authorized representative may certify or submit.",
    status: "requires_certification",
    owner: "business",
    category: "certification",
    dependsOn: tasks.map((task) => task.id),
    estimatedMinWeeks: 0.25,
    estimatedMaxWeeks: 0.5,
    applicantOnly: true,
    completionAuthority: "applicant_or_authorized_representative",
  });

  return tasks.map((task) =>
    withProgramContext(task, normalizedProgramId, normalizedProgramName)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeWeekValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = normalizeText(item);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function isOfficialCertificationTask(task: Pick<PreparationTask, "id" | "category">): boolean {
  return task.id === OFFICIAL_CERTIFICATION_TASK_ID || task.category === "certification";
}

export function normalizePreparationTasks(value: unknown): PreparationTask[] {
  if (!Array.isArray(value)) return [];

  const normalized: PreparationTask[] = [];
  const seenIds = new Set<string>();

  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = normalizeText(item.id);
    const title = normalizeText(item.title);
    if (!id || !title || seenIds.has(id)) continue;

    const estimatedWeeks = isRecord(item.estimatedWeeks) ? item.estimatedWeeks : {};
    const estimatedMinWeeks = normalizeWeekValue(
      item.estimatedMinWeeks ?? estimatedWeeks.min,
      0
    );
    const estimatedMaxWeeks = Math.max(
      estimatedMinWeeks,
      normalizeWeekValue(item.estimatedMaxWeeks ?? estimatedWeeks.max, estimatedMinWeeks)
    );
    const rawStatus = normalizeText(item.status);
    const rawOwner = normalizeText(item.owner);
    const rawCategory = normalizeText(item.category);
    const category = TASK_CATEGORY_SET.has(rawCategory ?? "")
      ? (rawCategory as PreparationTaskCategory)
      : "goal";
    const certificationTask = id === OFFICIAL_CERTIFICATION_TASK_ID || category === "certification";
    const status = certificationTask
      ? "requires_certification"
      : TASK_STATUS_SET.has(rawStatus ?? "")
        ? (rawStatus as PreparationTaskStatus)
        : "needs_owner_answer";
    const owner = certificationTask
      ? "business"
      : TASK_OWNER_SET.has(rawOwner ?? "")
        ? (rawOwner as PreparationTaskOwner)
        : "business";
    const requiredProfileFields = normalizeStringArray(item.requiredProfileFields) as Array<
      keyof BusinessProfileSnapshot
    >;
    const programId = normalizeText(item.programId);
    const programName = normalizeText(item.programName);

    seenIds.add(id);
    normalized.push({
      id,
      title,
      description: normalizeText(item.description) ?? "",
      status,
      owner,
      category: certificationTask ? "certification" : category,
      dependsOn: normalizeStringArray(item.dependsOn ?? item.dependencies),
      estimatedMinWeeks,
      estimatedMaxWeeks,
      ...(programId ? { programId } : {}),
      ...(programName ? { programName } : {}),
      ...(requiredProfileFields.length > 0 ? { requiredProfileFields } : {}),
      ...(certificationTask ? { applicantOnly: true as const } : {}),
      ...(certificationTask
        ? { completionAuthority: "applicant_or_authorized_representative" as const }
        : {}),
    });
  }

  const validIds = new Set(normalized.map((task) => task.id));
  const withValidDependencies = normalized.map((task) => ({
    ...task,
    dependsOn: task.dependsOn.filter(
      (dependencyId, index, dependencies) =>
        dependencyId !== task.id &&
        validIds.has(dependencyId) &&
        dependencies.indexOf(dependencyId) === index
    ),
  }));

  return [
    ...withValidDependencies.filter((task) => !isOfficialCertificationTask(task)),
    ...withValidDependencies.filter((task) => isOfficialCertificationTask(task)),
  ];
}

/**
 * The task-merge seam for foundation-first packets. When a foundation-only
 * "Business File" packet gains a target incentive, program/goal/application
 * tasks must layer in WITHOUT clobbering the user's confirmed foundation work.
 *
 * `freshTasks` is the authoritative full-graph rebuild (foundation + goal +
 * program + certification) for the newly chosen program. `existingTasks` is the
 * packet's current, possibly user-edited, task state. The merge:
 *
 *   - keeps the fresh structure (titles, descriptions, dependency graph,
 *     program context) so the graph is complete and dependency-closed;
 *   - preserves the user-set `status` on any task that already existed
 *     (identity/address/contact/financials/tax the applicant confirmed);
 *   - adds the new goal/program/dependency tasks with their fresh status;
 *   - never carries a stale status onto the protected certification task
 *     (normalizePreparationTasks re-locks it to requires_certification anyway);
 *   - is idempotent: re-merging an already-merged packet returns the same set
 *     with statuses preserved, so a repeated program selection is a safe no-op.
 *
 * Foundation tasks are matched by id, so they are never duplicated. Any task
 * present only in the old state (none exist today — the foundation subset is a
 * strict subset of the full graph) is dropped in favor of the fresh structure.
 */
export function mergePreparationProgramTasks(
  existingTasks: unknown,
  freshTasks: readonly PreparationTask[]
): PreparationTask[] {
  const existingById = new Map(
    normalizePreparationTasks(existingTasks).map((task) => [task.id, task])
  );

  const merged = freshTasks.map((fresh) => {
    const existing = existingById.get(fresh.id);
    if (!existing || isOfficialCertificationTask(fresh)) return fresh;
    return { ...fresh, status: existing.status };
  });

  return normalizePreparationTasks(merged);
}

export function canApplicantUpdateTask(task: PreparationTask): boolean {
  return (
    task.status !== "requires_certification" &&
    !isOfficialCertificationTask(task)
  );
}

export function summarizePreparationStatus(tasks: readonly PreparationTask[]): PreparationPacketStatus {
  const normalized = normalizePreparationTasks(tasks);
  if (normalized.length === 0) return "needs_information";

  const certificationTasks = normalized.filter(isOfficialCertificationTask);
  const preparationTasks = normalized.filter((task) => !isOfficialCertificationTask(task));

  if (preparationTasks.every((task) => task.status === "complete")) {
    return certificationTasks.length > 0 ? "ready_to_submit" : "foundation_complete";
  }

  if (preparationTasks.some((task) => task.status === "requires_certification")) {
    return "requires_certification";
  }
  if (
    preparationTasks.some(
      (task) => task.status === "needs_document" || task.status === "needs_owner_answer"
    )
  ) {
    return "needs_information";
  }
  if (preparationTasks.some((task) => task.status === "needs_advisor")) {
    return "needs_advisor";
  }
  if (preparationTasks.some((task) => task.status === "external_dependency")) {
    return "waiting_on_others";
  }

  return certificationTasks.length > 0 ? "requires_certification" : "foundation_complete";
}

function normalizeAsOfDate(asOf: Date | string): Date {
  const parsed = asOf instanceof Date ? new Date(asOf.getTime()) : new Date(asOf);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError("asOf must be a valid date");
  }
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
  );
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function roundWeeks(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculatePreparationTimeline(
  tasks: readonly PreparationTask[],
  asOf: Date | string = new Date()
): PreparationTimeline {
  const normalized = normalizePreparationTasks(tasks);
  const baseDate = normalizeAsOfDate(asOf);
  const asOfDate = formatDate(baseDate);

  if (normalized.length === 0) {
    return {
      asOfDate,
      estimatedMinWeeks: 0,
      estimatedMaxWeeks: 0,
      estimatedWeeks: { min: 0, max: 0 },
      earliestRealisticDate: asOfDate,
      criticalPathTaskIds: [],
      owners: [],
      parallelizableWork: [],
      parallelizableTaskIds: [],
    };
  }

  const taskById = new Map(normalized.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: PreparationTask[] = [];

  const visit = (task: PreparationTask) => {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) {
      throw new Error("Preparation task dependencies must be acyclic");
    }
    visiting.add(task.id);
    for (const dependencyId of task.dependsOn) {
      const dependency = taskById.get(dependencyId);
      if (dependency) visit(dependency);
    }
    visiting.delete(task.id);
    visited.add(task.id);
    ordered.push(task);
  };

  for (const task of normalized) visit(task);

  const minFinish = new Map<string, number>();
  const maxFinish = new Map<string, number>();
  const maxPath = new Map<string, string[]>();

  for (const task of ordered) {
    let minStart = 0;
    let maxStart = 0;
    let predecessorPath: string[] = [];

    for (const dependencyId of task.dependsOn) {
      minStart = Math.max(minStart, minFinish.get(dependencyId) ?? 0);
      const dependencyMax = maxFinish.get(dependencyId) ?? 0;
      if (dependencyMax > maxStart || predecessorPath.length === 0) {
        maxStart = dependencyMax;
        predecessorPath = maxPath.get(dependencyId) ?? [];
      }
    }

    const minDuration = task.status === "complete" ? 0 : task.estimatedMinWeeks;
    const maxDuration = task.status === "complete" ? 0 : task.estimatedMaxWeeks;
    minFinish.set(task.id, roundWeeks(minStart + minDuration));
    maxFinish.set(task.id, roundWeeks(maxStart + maxDuration));
    maxPath.set(task.id, [...predecessorPath, task.id]);
  }

  let estimatedMinWeeks = 0;
  let estimatedMaxWeeks = 0;
  let criticalPathTaskIds: string[] = [];
  for (const task of ordered) {
    estimatedMinWeeks = Math.max(estimatedMinWeeks, minFinish.get(task.id) ?? 0);
    const taskMax = maxFinish.get(task.id) ?? 0;
    if (taskMax > estimatedMaxWeeks || criticalPathTaskIds.length === 0) {
      estimatedMaxWeeks = taskMax;
      criticalPathTaskIds = maxPath.get(task.id) ?? [];
    }
  }

  const remainingTasks = ordered.filter((task) => task.status !== "complete");
  const levelById = new Map<string, number>();
  for (const task of remainingTasks) {
    const dependencyLevels = task.dependsOn
      .map((dependencyId) => levelById.get(dependencyId))
      .filter((level): level is number => typeof level === "number");
    levelById.set(task.id, dependencyLevels.length > 0 ? Math.max(...dependencyLevels) + 1 : 0);
  }

  const tasksByLevel = new Map<number, string[]>();
  for (const task of remainingTasks) {
    const level = levelById.get(task.id) ?? 0;
    const levelTasks = tasksByLevel.get(level) ?? [];
    levelTasks.push(task.id);
    tasksByLevel.set(level, levelTasks);
  }
  const parallelizableWork = [...tasksByLevel.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, taskIds]) => taskIds)
    .filter((taskIds) => taskIds.length > 1);
  const parallelizableTaskIds = [...new Set(parallelizableWork.flat())];

  const owners = [
    ...new Set(remainingTasks.map((task) => task.owner)),
  ] as PreparationTaskOwner[];
  const earliestRealisticDate = new Date(baseDate.getTime());
  earliestRealisticDate.setUTCDate(
    earliestRealisticDate.getUTCDate() + Math.ceil(estimatedMaxWeeks * 7)
  );

  return {
    asOfDate,
    estimatedMinWeeks: roundWeeks(estimatedMinWeeks),
    estimatedMaxWeeks: roundWeeks(estimatedMaxWeeks),
    estimatedWeeks: {
      min: roundWeeks(estimatedMinWeeks),
      max: roundWeeks(estimatedMaxWeeks),
    },
    earliestRealisticDate: formatDate(earliestRealisticDate),
    criticalPathTaskIds,
    owners,
    parallelizableWork,
    parallelizableTaskIds,
  };
}

/*
 * The Business File split: foundation-scope work is program-agnostic and
 * reusable across every application a business prepares. Continuity documents
 * (financials, tax standing) carry category "dependency" but bank into the
 * foundation because an accountant prepares them once, independent of any
 * program. Program/goal/site tasks stay application-scope.
 */
const CONTINUITY_TASK_IDS = new Set<string>([
  FINANCIALS_TASK_ID,
  TAX_STANDING_TASK_ID,
]);

export function isFoundationScopeTask(
  task: Pick<PreparationTask, "id" | "category">
): boolean {
  return task.category === "foundation" || CONTINUITY_TASK_IDS.has(task.id);
}

export interface PreparationTimelines {
  foundation: PreparationTimeline;
  application: PreparationTimeline;
}

export function calculateFoundationTimeline(
  tasks: readonly PreparationTask[],
  asOf: Date | string = new Date()
): PreparationTimeline {
  return calculatePreparationTimeline(
    normalizePreparationTasks(tasks).filter(isFoundationScopeTask),
    asOf
  );
}

export function calculateApplicationTimeline(
  tasks: readonly PreparationTask[],
  asOf: Date | string = new Date()
): PreparationTimeline {
  return calculatePreparationTimeline(tasks, asOf);
}

export function calculatePreparationTimelines(
  tasks: readonly PreparationTask[],
  asOf: Date | string = new Date()
): PreparationTimelines {
  return {
    foundation: calculateFoundationTimeline(tasks, asOf),
    application: calculateApplicationTimeline(tasks, asOf),
  };
}
