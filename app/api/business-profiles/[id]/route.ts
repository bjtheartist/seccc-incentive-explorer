import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import { getSQL } from "@/lib/db";
import {
  buildProfileSnapshot,
  summarizeProfileFoundation,
  type BusinessProfileInput,
  type BusinessProfileSnapshot,
  type JsonValue,
} from "@/lib/incentive-preparation";

type Params = { params: Promise<{ id: string }> };
type ProfileRow = Record<string, unknown>;

const STRING_FIELDS = [
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

function rowToInput(row: ProfileRow): BusinessProfileInput {
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

function toProfile(row: ProfileRow) {
  const input = rowToInput(row);
  const snapshot = buildProfileSnapshot(input);
  return {
    id: String(row.id),
    ...snapshot,
    foundationSummary: summarizeProfileFoundation(input),
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at),
  };
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateProfile(snapshot: Readonly<BusinessProfileSnapshot>): string | null {
  if (!snapshot.legalName) return "legalName is required";
  if (!snapshot.physicalAddress) return "physicalAddress is required";
  if (!snapshot.contactName) return "contactName is required";
  if (!snapshot.contactEmail) return "contactEmail is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.contactEmail)) {
    return "contactEmail must be a valid email address";
  }
  if (snapshot.formationDate && !isValidDateOnly(snapshot.formationDate)) {
    return "formationDate must be a valid YYYY-MM-DD date";
  }
  return null;
}

function parseProfileUpdate(value: unknown, current: BusinessProfileInput):
  | { snapshot: Readonly<BusinessProfileSnapshot> }
  | { error: string } {
  if (!isRecord(value)) return { error: "Profile update is required" };

  const next: BusinessProfileInput = {
    ...current,
    fieldProvenance: { ...(current.fieldProvenance ?? {}) },
  };
  let changedFields = 0;

  for (const field of STRING_FIELDS) {
    if (!(field in value)) continue;
    const fieldValue = value[field];
    if (fieldValue !== null && typeof fieldValue !== "string") {
      return { error: `${field} must be a string or null` };
    }
    next[field] = fieldValue as string | null;
    changedFields += 1;
  }

  if ("employeeCount" in value) {
    const employeeCount = value.employeeCount;
    if (
      employeeCount !== null &&
      (!Number.isInteger(employeeCount) || (employeeCount as number) < 0)
    ) {
      return { error: "employeeCount must be a non-negative integer or null" };
    }
    next.employeeCount = employeeCount as number | null;
    changedFields += 1;
  }

  if ("licenses" in value) {
    next.licenses = value.licenses as JsonValue;
    changedFields += 1;
  }

  if ("fieldProvenance" in value) {
    if (!isRecord(value.fieldProvenance)) {
      return { error: "fieldProvenance must be an object" };
    }
    next.fieldProvenance = {
      ...(current.fieldProvenance ?? {}),
      ...(value.fieldProvenance as Record<string, JsonValue>),
    };
    changedFields += 1;
  }

  if (changedFields === 0) {
    return { error: "At least one profile field is required" };
  }

  const snapshot = buildProfileSnapshot(next);
  const error = validateProfile(snapshot);
  return error ? { error } : { snapshot };
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
  const rows = await sql`
    SELECT *
    FROM business_profiles
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Business profile not found" }, { status: 404 });
  }

  return NextResponse.json({ profile: toProfile(rows[0] as ProfileRow) });
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

  const { id } = await params;
  const existingRows = await sql`
    SELECT *
    FROM business_profiles
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `;
  if (existingRows.length === 0) {
    return NextResponse.json({ error: "Business profile not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = parseProfileUpdate(body, rowToInput(existingRows[0] as ProfileRow));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const profile = parsed.snapshot;
  const rows = await sql`
    UPDATE business_profiles
    SET
      legal_name = ${profile.legalName},
      dba_name = ${profile.dbaName},
      physical_address = ${profile.physicalAddress},
      mailing_address = ${profile.mailingAddress},
      contact_name = ${profile.contactName},
      contact_email = ${profile.contactEmail},
      contact_phone = ${profile.contactPhone},
      entity_type = ${profile.entityType},
      formation_date = ${profile.formationDate}::date,
      industry = ${profile.industry},
      naics_code = ${profile.naicsCode},
      employee_count = ${profile.employeeCount},
      ownership_notes = ${profile.ownershipNotes},
      licenses_json = ${JSON.stringify(profile.licenses)}::jsonb,
      field_provenance_json = ${JSON.stringify(profile.fieldProvenance)}::jsonb,
      updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Business profile not found" }, { status: 404 });
  }

  return NextResponse.json({ profile: toProfile(rows[0] as ProfileRow) });
}
