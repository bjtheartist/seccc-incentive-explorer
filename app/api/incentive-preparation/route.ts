import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import { getSQL } from "@/lib/db";
import {
  buildPreparationTasks,
  buildProfileSnapshot,
  calculatePreparationTimeline,
  normalizePreparationTasks,
  summarizePreparationStatus,
  type BusinessProfileInput,
  type BusinessProfileSnapshot,
  type JsonValue,
  type PreparationTimeline,
} from "@/lib/incentive-preparation";
import { getAllPrograms } from "@/lib/programs-data";
import { isGoalType } from "@/lib/workspace";

type DatabaseRow = Record<string, unknown>;

const PROFILE_STRING_FIELDS = [
  "legalName",
  "dbaName",
  "physicalAddress",
  "mailingAddress",
  "contactName",
  "contactEmail",
  "contactPhone",
  "entityType",
  "formationDate",
  "industry",
  "naicsCode",
  "ownershipNotes",
] as const satisfies ReadonlyArray<keyof BusinessProfileInput>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: unknown, fallback: JsonValue): JsonValue {
  if (typeof value !== "string") return (value as JsonValue) ?? fallback;
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return fallback;
  }
}

function parseProvenance(value: unknown): Record<string, JsonValue> {
  const parsed = parseJson(value, {});
  return isRecord(parsed) ? (parsed as Record<string, JsonValue>) : {};
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dateTime(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function profileRowToInput(row: DatabaseRow): BusinessProfileInput {
  return {
    legalName: row.legal_name ? String(row.legal_name) : null,
    dbaName: row.dba_name ? String(row.dba_name) : null,
    physicalAddress: row.physical_address ? String(row.physical_address) : null,
    mailingAddress: row.mailing_address ? String(row.mailing_address) : null,
    contactName: row.contact_name ? String(row.contact_name) : null,
    contactEmail: row.contact_email ? String(row.contact_email) : null,
    contactPhone: row.contact_phone ? String(row.contact_phone) : null,
    entityType: row.entity_type ? String(row.entity_type) : null,
    formationDate: dateOnly(row.formation_date),
    industry: row.industry ? String(row.industry) : null,
    naicsCode: row.naics_code ? String(row.naics_code) : null,
    employeeCount:
      row.employee_count === null || row.employee_count === undefined
        ? null
        : Number(row.employee_count),
    ownershipNotes: row.ownership_notes ? String(row.ownership_notes) : null,
    licenses: parseJson(row.licenses_json, []),
    fieldProvenance: parseProvenance(row.field_provenance_json),
  };
}

function toProfile(row: DatabaseRow) {
  return {
    id: String(row.id),
    ...buildProfileSnapshot(profileRowToInput(row)),
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at),
  };
}

function packetTimeline(row: DatabaseRow): PreparationTimeline {
  const parsed = parseJson(row.timeline_json, {});
  if (isRecord(parsed) && typeof parsed.earliestRealisticDate === "string") {
    return parsed as unknown as PreparationTimeline;
  }
  const tasks = normalizePreparationTasks(parseJson(row.tasks_json, []));
  return calculatePreparationTimeline(tasks);
}

function packetSummary(row: DatabaseRow, businessName?: string | null) {
  const tasks = normalizePreparationTasks(parseJson(row.tasks_json, []));
  return {
    id: String(row.id),
    title: String(row.title || "Incentive Preparation Packet"),
    programId: row.program_id ? String(row.program_id) : null,
    programName: String(row.program_name || ""),
    goalType: String(row.goal_type),
    projectAddress: row.project_address ? String(row.project_address) : null,
    status: row.status ? String(row.status) : summarizePreparationStatus(tasks),
    businessName:
      businessName ||
      (row.business_name ? String(row.business_name) : "Business profile"),
    timeline: packetTimeline(row),
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at),
  };
}

function packetDetail(row: DatabaseRow, businessName?: string | null) {
  return {
    ...packetSummary(row, businessName),
    tasks: normalizePreparationTasks(parseJson(row.tasks_json, [])),
    profileSnapshot: buildProfileSnapshot(
      parseJson(row.profile_snapshot_json, {}) as BusinessProfileInput
    ),
  };
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateProfile(snapshot: Readonly<BusinessProfileSnapshot>): string | null {
  if (!snapshot.legalName) return "profile.legalName is required";
  if (!snapshot.physicalAddress) return "profile.physicalAddress is required";
  if (!snapshot.contactName) return "profile.contactName is required";
  if (!snapshot.contactEmail) return "profile.contactEmail is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.contactEmail)) {
    return "profile.contactEmail must be a valid email address";
  }
  if (snapshot.formationDate && !isValidDateOnly(snapshot.formationDate)) {
    return "profile.formationDate must be a valid YYYY-MM-DD date";
  }
  return null;
}

function parseInlineProfile(value: unknown):
  | { snapshot: Readonly<BusinessProfileSnapshot> }
  | { error: string } {
  if (!isRecord(value)) return { error: "profile must be an object" };

  const input: BusinessProfileInput = {};
  for (const field of PROFILE_STRING_FIELDS) {
    if (!(field in value)) continue;
    const fieldValue = value[field];
    if (fieldValue !== null && typeof fieldValue !== "string") {
      return { error: `profile.${field} must be a string or null` };
    }
    input[field] = fieldValue as string | null;
  }

  if ("employeeCount" in value) {
    const employeeCount = value.employeeCount;
    if (
      employeeCount !== null &&
      (!Number.isInteger(employeeCount) || (employeeCount as number) < 0)
    ) {
      return { error: "profile.employeeCount must be a non-negative integer or null" };
    }
    input.employeeCount = employeeCount as number | null;
  }

  if ("licenses" in value) input.licenses = value.licenses as JsonValue;
  if ("fieldProvenance" in value) {
    if (!isRecord(value.fieldProvenance)) {
      return { error: "profile.fieldProvenance must be an object" };
    }
    input.fieldProvenance = value.fieldProvenance as Record<string, JsonValue>;
  }

  const snapshot = buildProfileSnapshot(input);
  const error = validateProfile(snapshot);
  return error ? { error } : { snapshot };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getProgramPreparationOverlay(programId: string | null, programName: string) {
  const programs = getAllPrograms();
  const program =
    (programId ? programs.find((candidate) => candidate.id === programId) : undefined) ??
    programs.find((candidate) => candidate.name === programName);

  return {
    programRequiredDocs: program?.requiredDocs ?? [],
    programVerificationSteps: program?.verificationSteps ?? [],
  };
}

async function insertProfile(
  sql: NonNullable<ReturnType<typeof getSQL>>,
  userId: string,
  profile: Readonly<BusinessProfileSnapshot>
) {
  return sql`
    INSERT INTO business_profiles (
      user_id,
      legal_name,
      dba_name,
      physical_address,
      mailing_address,
      contact_name,
      contact_email,
      contact_phone,
      entity_type,
      formation_date,
      industry,
      naics_code,
      employee_count,
      ownership_notes,
      licenses_json,
      field_provenance_json
    )
    VALUES (
      ${userId},
      ${profile.legalName},
      ${profile.dbaName},
      ${profile.physicalAddress},
      ${profile.mailingAddress},
      ${profile.contactName},
      ${profile.contactEmail},
      ${profile.contactPhone},
      ${profile.entityType},
      ${profile.formationDate}::date,
      ${profile.industry},
      ${profile.naicsCode},
      ${profile.employeeCount},
      ${profile.ownershipNotes},
      ${JSON.stringify(profile.licenses)}::jsonb,
      ${JSON.stringify(profile.fieldProvenance)}::jsonb
    )
    RETURNING *
  `;
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const rows = await sql`
    SELECT
      packet.*,
      COALESCE(NULLIF(profile.dba_name, ''), profile.legal_name, 'Business profile') AS business_name
    FROM incentive_preparation_packets packet
    JOIN business_profiles profile
      ON profile.id = packet.business_profile_id
      AND profile.user_id = packet.user_id
    WHERE packet.user_id = ${userId}
    ORDER BY packet.updated_at DESC
  `;

  return NextResponse.json({
    packets: rows.map((row) => packetSummary(row as DatabaseRow)),
  });
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Request body is required" }, { status: 400 });
  }

  const goalType = body.goalType;
  if (!isGoalType(goalType)) {
    return NextResponse.json({ error: "Valid goalType is required" }, { status: 400 });
  }
  const programName = optionalString(body.programName);
  if (!programName) {
    return NextResponse.json({ error: "programName is required" }, { status: 400 });
  }

  if (body.profileId !== undefined && body.profileId !== null && typeof body.profileId !== "string") {
    return NextResponse.json({ error: "profileId must be a string" }, { status: 400 });
  }
  const profileId = optionalString(body.profileId);
  const hasInlineProfile = isRecord(body.profile);
  if ((profileId && hasInlineProfile) || (!profileId && !hasInlineProfile)) {
    return NextResponse.json(
      { error: "Provide either profileId or profile" },
      { status: 400 }
    );
  }

  let inlineProfile: Readonly<BusinessProfileSnapshot> | null = null;
  if (hasInlineProfile) {
    const parsedProfile = parseInlineProfile(body.profile);
    if ("error" in parsedProfile) {
      return NextResponse.json({ error: parsedProfile.error }, { status: 400 });
    }
    inlineProfile = parsedProfile.snapshot;
  }

  for (const field of ["programId", "projectId", "savedReportId", "projectAddress", "title"] as const) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== "string") {
      return NextResponse.json({ error: `${field} must be a string` }, { status: 400 });
    }
  }

  const projectId = optionalString(body.projectId);
  if (projectId) {
    const projectRows = await sql`
      SELECT id
      FROM business_projects
      WHERE id = ${projectId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (projectRows.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
  }

  const savedReportId = optionalString(body.savedReportId);
  if (savedReportId) {
    const reportRows = await sql`
      SELECT id
      FROM saved_reports
      WHERE id = ${savedReportId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (reportRows.length === 0) {
      return NextResponse.json({ error: "Saved report not found" }, { status: 404 });
    }
  }

  let profileRow: DatabaseRow;
  let profile: Readonly<BusinessProfileSnapshot>;
  if (profileId) {
    const profileRows = await sql`
      SELECT *
      FROM business_profiles
      WHERE id = ${profileId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (profileRows.length === 0) {
      return NextResponse.json({ error: "Business profile not found" }, { status: 404 });
    }
    profileRow = profileRows[0] as DatabaseRow;
    profile = buildProfileSnapshot(profileRowToInput(profileRow));
  } else {
    profile = inlineProfile!;
    const profileRows = await insertProfile(sql, userId, profile);
    profileRow = profileRows[0] as DatabaseRow;
  }

  const programId = optionalString(body.programId);
  const programOverlay = getProgramPreparationOverlay(programId, programName);
  const tasks = buildPreparationTasks({
    goalType,
    programId,
    programName,
    ...programOverlay,
    profile,
  });
  const timeline = calculatePreparationTimeline(tasks);
  const status = summarizePreparationStatus(tasks);
  const title = optionalString(body.title) || "Incentive Preparation Packet";
  const projectAddress = optionalString(body.projectAddress) || profile.physicalAddress;

  const packetRows = await sql`
    INSERT INTO incentive_preparation_packets (
      user_id,
      business_profile_id,
      project_id,
      saved_report_id,
      title,
      program_id,
      program_name,
      goal_type,
      project_address,
      status,
      tasks_json,
      timeline_json,
      profile_snapshot_json
    )
    VALUES (
      ${userId},
      ${String(profileRow.id)},
      ${projectId},
      ${savedReportId},
      ${title},
      ${programId},
      ${programName},
      ${goalType},
      ${projectAddress},
      ${status},
      ${JSON.stringify(tasks)}::jsonb,
      ${JSON.stringify(timeline)}::jsonb,
      ${JSON.stringify(profile)}::jsonb
    )
    RETURNING *
  `;

  const packetRow = packetRows[0] as DatabaseRow;
  const businessName = profile.dbaName || profile.legalName || "Business profile";
  return NextResponse.json(
    {
      packet: packetDetail(packetRow, businessName),
      profile: toProfile(profileRow),
      supportRequests: [],
    },
    { status: 201 }
  );
}
