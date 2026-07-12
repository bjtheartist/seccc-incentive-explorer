export type PreparationTaskStatus =
  | "needs_document"
  | "needs_owner_answer"
  | "needs_advisor"
  | "external_dependency"
  | "requires_certification"
  | "complete";

export interface BusinessProfile {
  id: string;
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
}

export interface PreparationTask {
  id: string;
  title: string;
  description: string;
  status: PreparationTaskStatus;
  owner: string;
  category: string;
  isCertification: boolean;
  mutable: boolean;
}

export interface PreparationTimelineView {
  estimatedWeeks: { min: number; max: number };
  earliestRealisticDate: string;
  criticalPath: string[];
  asOfDate: string;
  owners: string[];
}

export interface PreparationTimelines {
  foundation: PreparationTimelineView;
  application: PreparationTimelineView;
}

// Continuity documents (financials, tax standing) bank into the Business File
// even though the back-end tags them category "dependency"; mirror the
// server-side isFoundationScopeTask predicate on the client.
export const FOUNDATION_CONTINUITY_TASK_IDS = [
  "accountant-financials",
  "tax-good-standing",
] as const;

export function isFoundationScopeTask(
  task: Pick<PreparationTask, "id" | "category">,
): boolean {
  return (
    task.category === "foundation" ||
    (FOUNDATION_CONTINUITY_TASK_IDS as readonly string[]).includes(task.id)
  );
}

export interface PreparationPacket {
  id: string;
  businessProfile: BusinessProfile;
  primaryGoal: string;
  selectedProgram: {
    programId: string;
    label: string;
  };
  preparationStatus: string;
  estimatedWeekRange: string;
  earliestRealisticDate: string;
  criticalPath: string[];
  timelines: PreparationTimelines;
  tasks: PreparationTask[];
  createdAt: string;
  updatedAt: string;
}

export interface PreparationSupportRequest {
  id: string;
  targetOrganization: string;
  requestedHelp: string;
  dataScopes: string[];
  status: string;
}

export interface FoundationRefreshItemView {
  taskId: string;
  title: string;
  newlyCovered: boolean;
}

export interface FoundationRefreshView {
  asOfDate: string;
  items: FoundationRefreshItemView[];
  newlyCoveredTaskIds: string[];
}

const EMPTY_FOUNDATION_REFRESH: FoundationRefreshView = {
  asOfDate: "",
  items: [],
  newlyCoveredTaskIds: [],
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function cleanString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readString(record: UnknownRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = cleanString(record[key]);
    if (value) return value;
  }
  return "";
}

function readBoolean(record: UnknownRecord, ...keys: string[]): boolean | null {
  for (const key of keys) {
    if (typeof record[key] === "boolean") return record[key] as boolean;
  }
  return null;
}

export function normalizeBusinessProfile(value: unknown): BusinessProfile | null {
  const record = asRecord(value);
  if (!record) return null;

  const id = readString(record, "id", "businessProfileId", "business_profile_id");
  if (!id) return null;

  return {
    id,
    legalBusinessName: readString(
      record,
      "legalName",
      "legalBusinessName",
      "legal_business_name",
      "businessName",
      "name",
    ),
    dbaName: readString(record, "dbaName", "dba_name", "doingBusinessAs"),
    physicalAddress: readString(
      record,
      "physicalAddress",
      "physical_address",
      "projectAddress",
      "address",
    ),
    contactName: readString(record, "contactName", "contact_name"),
    contactEmail: readString(record, "contactEmail", "contact_email", "email"),
    contactPhone: readString(record, "contactPhone", "contact_phone", "phone"),
    industry: readString(record, "industry"),
    entityType: readString(record, "entityType", "entity_type"),
    formationDate: readString(
      record,
      "formationDate",
      "formation_date",
    ),
    employeeCount: readString(record, "employeeCount", "employee_count"),
  };
}

export function extractBusinessProfiles(payload: unknown): BusinessProfile[] {
  const record = asRecord(payload);
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.profiles)
      ? record.profiles
      : Array.isArray(record?.businessProfiles)
        ? record.businessProfiles
        : [];

  return values
    .map((value) => normalizeBusinessProfile(value))
    .filter((value): value is BusinessProfile => value !== null);
}

function normalizeTaskStatus(value: unknown): PreparationTaskStatus {
  const normalized = cleanString(value).toLowerCase().replace(/[ -]/g, "_");
  if (normalized === "complete" || normalized === "completed" || normalized === "done") {
    return "complete";
  }
  if (normalized === "needs_document") return "needs_document";
  if (normalized === "needs_advisor") return "needs_advisor";
  if (normalized === "external_dependency" || normalized === "blocked" || normalized === "waiting") {
    return "external_dependency";
  }
  if (normalized === "requires_certification") return "requires_certification";
  return "needs_owner_answer";
}

function normalizeTask(value: unknown, index: number): PreparationTask | null {
  const record = asRecord(value);
  if (!record) return null;

  const title = readString(record, "title", "label", "name");
  if (!title) return null;

  const taskType = readString(record, "taskType", "task_type", "type").toLowerCase();
  const category = readString(record, "category").toLowerCase();
  const isCertification =
    readBoolean(record, "isCertification", "is_certification") === true ||
    readBoolean(record, "applicantOnly", "applicant_only") === true ||
    taskType === "certification" ||
    category === "certification" ||
    /certif(y|ication)/i.test(title);
  const explicitlyMutable = readBoolean(record, "mutable", "isMutable", "is_mutable");

  return {
    id: readString(record, "id", "taskId", "task_id") || `task-${index}`,
    title,
    description: readString(record, "description", "detail"),
    status: normalizeTaskStatus(record.status),
    owner: readString(record, "owner", "ownerLabel", "owner_label") || "Applicant",
    category: isCertification ? "certification" : category || "goal",
    isCertification,
    mutable: !isCertification && explicitlyMutable !== false,
  };
}

function taskValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  return Object.values(record).flatMap((entry) =>
    Array.isArray(entry) ? entry : [],
  );
}

function normalizeWeekRange(record: UnknownRecord, timeline: UnknownRecord | null): string {
  const explicit =
    readString(record, "estimatedWeekRange", "estimated_week_range") ||
    (timeline
      ? readString(timeline, "estimatedWeekRange", "estimated_week_range", "weekRange")
      : "");
  if (explicit) return explicit;

  const estimatedWeeks = timeline ? asRecord(timeline.estimatedWeeks) : null;
  const min =
    readString(record, "estimatedWeeksMin", "estimated_weeks_min") ||
    (timeline ? readString(timeline, "minWeeks", "min_weeks") : "") ||
    (estimatedWeeks ? readString(estimatedWeeks, "min") : "");
  const max =
    readString(record, "estimatedWeeksMax", "estimated_weeks_max") ||
    (timeline ? readString(timeline, "maxWeeks", "max_weeks") : "") ||
    (estimatedWeeks ? readString(estimatedWeeks, "max") : "");
  if (min && max) return `${min}-${max} weeks`;
  if (min || max) return `${min || max} weeks`;
  return "Timing estimate pending";
}

function normalizeCriticalPath(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter(Boolean);
  }
  const text = cleanString(value);
  return text ? [text] : [];
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeEstimatedWeeks(record: UnknownRecord): { min: number; max: number } {
  const nested = asRecord(record.estimatedWeeks);
  const min = Math.max(
    0,
    readNumber(nested?.min) ??
      readNumber(record.estimatedMinWeeks) ??
      readNumber(record.minWeeks) ??
      0,
  );
  const max = Math.max(
    min,
    readNumber(nested?.max) ??
      readNumber(record.estimatedMaxWeeks) ??
      readNumber(record.maxWeeks) ??
      min,
  );
  return { min, max };
}

function normalizeOwners(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanString).filter(Boolean);
}

function normalizeTimelineView(value: unknown): PreparationTimelineView {
  const record = asRecord(value) ?? {};
  return {
    estimatedWeeks: normalizeEstimatedWeeks(record),
    earliestRealisticDate: readString(
      record,
      "earliestRealisticDate",
      "earliest_realistic_date",
    ),
    criticalPath: normalizeCriticalPath(
      record.criticalPathTaskIds ?? record.criticalPath ?? record.critical_path,
    ),
    asOfDate: readString(record, "asOfDate", "as_of_date"),
    owners: normalizeOwners(record.owners),
  };
}

const EMPTY_TIMELINE_VIEW: PreparationTimelineView = {
  estimatedWeeks: { min: 0, max: 0 },
  earliestRealisticDate: "",
  criticalPath: [],
  asOfDate: "",
  owners: [],
};

export function extractPreparationPacket(payload: unknown): PreparationPacket | null {
  const root = asRecord(payload);
  if (!root) return null;
  const nested = asRecord(
    root.packet ?? root.preparation ?? root.incentivePreparation,
  );
  const record = nested ?? root;
  const id = readString(record, "id", "packetId", "preparationId");
  if (!id) return null;

  const profile =
    normalizeBusinessProfile(
      record.businessProfile ?? record.profile ?? root.profile ?? root.businessProfile,
    ) ?? (() => {
      const snapshot = asRecord(record.profileSnapshot);
      return {
      id: readString(record, "businessProfileId", "business_profile_id"),
      legalBusinessName: readString(
        snapshot ?? record,
        "legalName",
        "legalBusinessName",
        "legal_business_name",
      ),
      dbaName: readString(snapshot ?? record, "dbaName", "dba_name"),
      physicalAddress: readString(snapshot ?? record, "physicalAddress", "physical_address", "address"),
      contactName: readString(snapshot ?? record, "contactName", "contact_name"),
      contactEmail: readString(snapshot ?? record, "contactEmail", "contact_email"),
      contactPhone: readString(snapshot ?? record, "contactPhone", "contact_phone"),
      industry: readString(snapshot ?? record, "industry"),
      entityType: readString(snapshot ?? record, "entityType", "entity_type"),
      formationDate: readString(snapshot ?? record, "formationDate", "formation_date"),
      employeeCount: readString(snapshot ?? record, "employeeCount", "employee_count"),
    };
    })();
  const selectedProgramRecord = asRecord(record.selectedProgram ?? record.program);
  const timeline = asRecord(record.timeline);
  const rawTasks = record.tasks ?? record.preparationTasks ?? record.taskGroups;

  // Dual timelines: prefer the API's `timelines` split; fall back to the single
  // `timeline` (which equals the application timeline) so older payloads render.
  const timelinesRecord = asRecord(record.timelines);
  const applicationView = normalizeTimelineView(
    timelinesRecord?.application ?? record.timeline ?? record,
  );
  const foundationView = timelinesRecord?.foundation
    ? normalizeTimelineView(timelinesRecord.foundation)
    : EMPTY_TIMELINE_VIEW;

  return {
    id,
    businessProfile: profile,
    primaryGoal: readString(record, "primaryGoal", "primary_goal", "projectGoal", "goalType"),
    selectedProgram: {
      programId:
        readString(record, "selectedProgramId", "selected_program_id", "programId") ||
        (selectedProgramRecord
          ? readString(selectedProgramRecord, "programId", "id")
          : ""),
      label:
        readString(
          record,
          "selectedProgramLabel",
          "selected_program_label",
          "programLabel",
          "programName",
        ) ||
        (selectedProgramRecord
          ? readString(selectedProgramRecord, "label", "name", "title")
          : ""),
    },
    preparationStatus: readString(
      record,
      "preparationStatus",
      "preparation_status",
      "status",
    ),
    estimatedWeekRange: normalizeWeekRange(record, timeline),
    earliestRealisticDate:
      readString(record, "earliestRealisticDate", "earliest_realistic_date") ||
      (timeline
        ? readString(timeline, "earliestRealisticDate", "earliest_realistic_date")
        : ""),
    criticalPath: normalizeCriticalPath(
      record.criticalPath ??
        record.critical_path ??
        timeline?.criticalPath ??
        timeline?.criticalPathTaskIds,
    ),
    timelines: { foundation: foundationView, application: applicationView },
    tasks: taskValues(rawTasks)
      .map((value, index) => normalizeTask(value, index))
      .filter((value): value is PreparationTask => value !== null),
    createdAt: readString(record, "createdAt", "created_at"),
    updatedAt: readString(record, "updatedAt", "updated_at"),
  };
}

export function extractCreatedPreparationId(payload: unknown): string {
  return extractPreparationPacket(payload)?.id ?? "";
}

export function extractFoundationRefresh(payload: unknown): FoundationRefreshView {
  const root = asRecord(payload);
  const record = asRecord(root?.foundationRefresh);
  if (!record) return EMPTY_FOUNDATION_REFRESH;

  const items = Array.isArray(record.items)
    ? record.items.flatMap((value): FoundationRefreshItemView[] => {
        const item = asRecord(value);
        const taskId = item ? readString(item, "taskId", "task_id") : "";
        if (!item || !taskId) return [];
        return [
          {
            taskId,
            title: readString(item, "title"),
            newlyCovered: readBoolean(item, "newlyCovered", "newly_covered") === true,
          },
        ];
      })
    : [];

  const newlyCoveredTaskIds = Array.isArray(record.newlyCoveredTaskIds)
    ? record.newlyCoveredTaskIds.map(cleanString).filter(Boolean)
    : items.filter((item) => item.newlyCovered).map((item) => item.taskId);

  return {
    asOfDate: readString(record, "asOfDate", "as_of_date"),
    items,
    newlyCoveredTaskIds,
  };
}

export function extractPreparationSupportRequests(
  payload: unknown,
): PreparationSupportRequest[] {
  const root = asRecord(payload);
  const values = Array.isArray(root?.supportRequests)
    ? root.supportRequests
    : Array.isArray(root?.support_requests)
      ? root.support_requests
      : [];

  return values.flatMap((value, index) => {
    const record = asRecord(value);
    if (!record) return [];
    const targetOrganization = readString(
      record,
      "targetOrganization",
      "target_organization",
      "organizationName",
    );
    const requestedHelp = readString(record, "requestedHelp", "requested_help", "help");
    if (!targetOrganization || !requestedHelp) return [];
    const rawDataScopes =
      record.dataScopes ?? record.data_scopes ?? record.consentScope ?? record.consent_scope;
    const dataScopes = Array.isArray(rawDataScopes)
      ? rawDataScopes.map(cleanString).filter(Boolean)
      : [];
    return [{
      id: readString(record, "id", "supportRequestId", "support_request_id") || `support-${index}`,
      targetOrganization,
      requestedHelp,
      dataScopes,
      status: readString(record, "status") || "recorded",
    }];
  });
}
