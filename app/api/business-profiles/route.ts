import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import { getSQL } from "@/lib/db";
import {
  buildProfileSnapshot,
  type BusinessProfileInput,
  type BusinessProfileSnapshot,
  type JsonValue,
} from "@/lib/incentive-preparation";

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
  const snapshot = buildProfileSnapshot(rowToInput(row));
  return {
    id: String(row.id),
    ...snapshot,
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

function parseProfileInput(value: unknown):
  | { input: BusinessProfileInput; snapshot: Readonly<BusinessProfileSnapshot> }
  | { error: string } {
  if (!isRecord(value)) return { error: "Profile data is required" };

  const input: BusinessProfileInput = {};
  for (const field of STRING_FIELDS) {
    if (!(field in value)) continue;
    const fieldValue = value[field];
    if (fieldValue !== null && typeof fieldValue !== "string") {
      return { error: `${field} must be a string or null` };
    }
    input[field] = fieldValue as string | null;
  }

  if ("employeeCount" in value) {
    const employeeCount = value.employeeCount;
    if (
      employeeCount !== null &&
      (!Number.isInteger(employeeCount) || (employeeCount as number) < 0)
    ) {
      return { error: "employeeCount must be a non-negative integer or null" };
    }
    input.employeeCount = employeeCount as number | null;
  }

  if ("licenses" in value) {
    input.licenses = value.licenses as JsonValue;
  }

  if ("fieldProvenance" in value) {
    if (!isRecord(value.fieldProvenance)) {
      return { error: "fieldProvenance must be an object" };
    }
    input.fieldProvenance = value.fieldProvenance as Record<string, JsonValue>;
  }

  const snapshot = buildProfileSnapshot(input);
  const error = validateProfile(snapshot);
  return error ? { error } : { input, snapshot };
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
    SELECT *
    FROM business_profiles
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;

  return NextResponse.json({ profiles: rows.map((row) => toProfile(row as ProfileRow)) });
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
  const parsed = parseProfileInput(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const profile = parsed.snapshot;
  const rows = await sql`
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

  return NextResponse.json(
    { profile: toProfile(rows[0] as ProfileRow) },
    { status: 201 }
  );
}
