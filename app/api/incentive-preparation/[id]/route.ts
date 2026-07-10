import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import { getSQL } from "@/lib/db";
import {
  PREPARATION_TASK_STATUSES,
  buildProfileSnapshot,
  calculatePreparationTimeline,
  canApplicantUpdateTask,
  normalizePreparationTasks,
  summarizePreparationStatus,
  type BusinessProfileInput,
  type JsonValue,
  type PreparationTaskStatus,
  type PreparationTimeline,
} from "@/lib/incentive-preparation";

type Params = { params: Promise<{ id: string }> };
type DatabaseRow = Record<string, unknown>;

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

function joinedProfileInput(row: DatabaseRow): BusinessProfileInput {
  return {
    legalName: row.profile_legal_name ? String(row.profile_legal_name) : null,
    dbaName: row.profile_dba_name ? String(row.profile_dba_name) : null,
    physicalAddress: row.profile_physical_address
      ? String(row.profile_physical_address)
      : null,
    mailingAddress: row.profile_mailing_address
      ? String(row.profile_mailing_address)
      : null,
    contactName: row.profile_contact_name ? String(row.profile_contact_name) : null,
    contactEmail: row.profile_contact_email ? String(row.profile_contact_email) : null,
    contactPhone: row.profile_contact_phone ? String(row.profile_contact_phone) : null,
    entityType: row.profile_entity_type ? String(row.profile_entity_type) : null,
    formationDate: dateOnly(row.profile_formation_date),
    industry: row.profile_industry ? String(row.profile_industry) : null,
    naicsCode: row.profile_naics_code ? String(row.profile_naics_code) : null,
    employeeCount:
      row.profile_employee_count === null || row.profile_employee_count === undefined
        ? null
        : Number(row.profile_employee_count),
    ownershipNotes: row.profile_ownership_notes
      ? String(row.profile_ownership_notes)
      : null,
    licenses: parseJson(row.profile_licenses_json, []),
    fieldProvenance: parseProvenance(row.profile_field_provenance_json),
  };
}

function toProfile(row: DatabaseRow) {
  return {
    id: String(row.profile_id),
    ...buildProfileSnapshot(joinedProfileInput(row)),
    createdAt: dateTime(row.profile_created_at),
    updatedAt: dateTime(row.profile_updated_at),
  };
}

function packetTimeline(row: DatabaseRow): PreparationTimeline {
  const parsed = parseJson(row.timeline_json, {});
  if (isRecord(parsed) && typeof parsed.earliestRealisticDate === "string") {
    return parsed as unknown as PreparationTimeline;
  }
  return calculatePreparationTimeline(
    normalizePreparationTasks(parseJson(row.tasks_json, []))
  );
}

function packetSummary(row: DatabaseRow) {
  const tasks = normalizePreparationTasks(parseJson(row.tasks_json, []));
  return {
    id: String(row.id),
    title: String(row.title || "Incentive Preparation Packet"),
    programId: row.program_id ? String(row.program_id) : null,
    programName: String(row.program_name || ""),
    goalType: String(row.goal_type),
    projectAddress: row.project_address ? String(row.project_address) : null,
    status: row.status ? String(row.status) : summarizePreparationStatus(tasks),
    businessName: row.business_name ? String(row.business_name) : "Business profile",
    timeline: packetTimeline(row),
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at),
  };
}

function packetDetail(row: DatabaseRow) {
  return {
    ...packetSummary(row),
    tasks: normalizePreparationTasks(parseJson(row.tasks_json, [])),
    profileSnapshot: buildProfileSnapshot(
      parseJson(row.profile_snapshot_json, {}) as BusinessProfileInput
    ),
  };
}

function toSupportRequest(row: DatabaseRow) {
  const consentScope = parseJson(row.consent_scope_json, []);
  const dataScopes = Array.isArray(consentScope)
    ? consentScope.filter((scope): scope is string => typeof scope === "string")
    : [];

  return {
    id: String(row.id),
    packetId: String(row.packet_id),
    targetOrganization: String(row.target_organization),
    requestedHelp: String(row.requested_help),
    consentScope: dataScopes,
    dataScopes,
    status: String(row.status || "pending"),
    consentedAt: row.consented_at ? dateTime(row.consented_at) : null,
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at),
  };
}

async function loadPacket(
  sql: NonNullable<ReturnType<typeof getSQL>>,
  id: string,
  userId: string
) {
  return sql`
    SELECT
      packet.*,
      COALESCE(NULLIF(profile.dba_name, ''), profile.legal_name, 'Business profile') AS business_name,
      profile.id AS profile_id,
      profile.legal_name AS profile_legal_name,
      profile.dba_name AS profile_dba_name,
      profile.physical_address AS profile_physical_address,
      profile.mailing_address AS profile_mailing_address,
      profile.contact_name AS profile_contact_name,
      profile.contact_email AS profile_contact_email,
      profile.contact_phone AS profile_contact_phone,
      profile.entity_type AS profile_entity_type,
      profile.formation_date AS profile_formation_date,
      profile.industry AS profile_industry,
      profile.naics_code AS profile_naics_code,
      profile.employee_count AS profile_employee_count,
      profile.ownership_notes AS profile_ownership_notes,
      profile.licenses_json AS profile_licenses_json,
      profile.field_provenance_json AS profile_field_provenance_json,
      profile.created_at AS profile_created_at,
      profile.updated_at AS profile_updated_at
    FROM incentive_preparation_packets packet
    JOIN business_profiles profile
      ON profile.id = packet.business_profile_id
      AND profile.user_id = packet.user_id
    WHERE packet.id = ${id} AND packet.user_id = ${userId}
    LIMIT 1
  `;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const packetRows = await loadPacket(sql, id, userId);
  if (packetRows.length === 0) {
    return NextResponse.json(
      { error: "Incentive Preparation Packet not found" },
      { status: 404 }
    );
  }

  const supportRows = await sql`
    SELECT *
    FROM incentive_support_requests
    WHERE packet_id = ${id} AND user_id = ${userId}
    ORDER BY created_at DESC
  `;
  const packetRow = packetRows[0] as DatabaseRow;

  return NextResponse.json({
    packet: packetDetail(packetRow),
    profile: toProfile(packetRow),
    supportRequests: supportRows.map((row) => toSupportRequest(row as DatabaseRow)),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
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
  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }
  const nextStatus = typeof body.status === "string" ? body.status.trim() : "";
  if (!PREPARATION_TASK_STATUSES.includes(nextStatus as PreparationTaskStatus)) {
    return NextResponse.json({ error: "Valid status is required" }, { status: 400 });
  }

  const { id } = await params;
  const packetRows = await loadPacket(sql, id, userId);
  if (packetRows.length === 0) {
    return NextResponse.json(
      { error: "Incentive Preparation Packet not found" },
      { status: 404 }
    );
  }

  const packetRow = packetRows[0] as DatabaseRow;
  const tasks = normalizePreparationTasks(parseJson(packetRow.tasks_json, []));
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found in packet" }, { status: 400 });
  }

  if (
    !canApplicantUpdateTask(task) ||
    (task.status === "requires_certification" && nextStatus === "complete")
  ) {
    return NextResponse.json(
      {
        error:
          "This task is protected. Final certification and submission belong only to the applicant or an authorized representative.",
      },
      { status: 400 }
    );
  }

  const updatedTasks = normalizePreparationTasks(
    tasks.map((candidate) =>
      candidate.id === taskId
        ? { ...candidate, status: nextStatus as PreparationTaskStatus }
        : candidate
    )
  );
  const timeline = calculatePreparationTimeline(updatedTasks);
  const status = summarizePreparationStatus(updatedTasks);

  const updatedRows = await sql`
    UPDATE incentive_preparation_packets
    SET
      tasks_json = ${JSON.stringify(updatedTasks)}::jsonb,
      timeline_json = ${JSON.stringify(timeline)}::jsonb,
      status = ${status},
      updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `;
  if (updatedRows.length === 0) {
    return NextResponse.json(
      { error: "Incentive Preparation Packet not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    packet: packetDetail({
      ...(updatedRows[0] as DatabaseRow),
      business_name: packetRow.business_name,
    }),
  });
}
