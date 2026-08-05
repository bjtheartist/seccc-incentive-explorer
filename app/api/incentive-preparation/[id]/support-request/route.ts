import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import { getSQL } from "@/lib/db";
import {
  MATERIALS_REVIEW_ORGANIZATION,
  isSupportRequestType,
} from "@/lib/incentive-support";

type Params = { params: Promise<{ id: string }> };
type DatabaseRow = Record<string, unknown>;

const ALLOWED_CONSENT_SCOPES = new Set([
  "business_profile",
  "packet",
  "documents",
  "contact_information",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseScopes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const scopes = value.map((scope) => (typeof scope === "string" ? scope.trim() : ""));
  if (scopes.some((scope) => !scope || !ALLOWED_CONSENT_SCOPES.has(scope))) return null;

  return [...new Set(scopes)];
}

function dateTime(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function toSupportRequest(row: DatabaseRow) {
  const consentScope = Array.isArray(row.consent_scope_json)
    ? row.consent_scope_json
    : typeof row.consent_scope_json === "string"
      ? JSON.parse(row.consent_scope_json)
      : [];
  const dataScopes = Array.isArray(consentScope)
    ? consentScope.filter((scope): scope is string => typeof scope === "string")
    : [];

  return {
    id: String(row.id),
    packetId: String(row.packet_id),
    requestType: isSupportRequestType(row.request_type) ? row.request_type : "introduction",
    targetOrganization: row.target_organization
      ? String(row.target_organization)
      : MATERIALS_REVIEW_ORGANIZATION,
    requestedHelp: String(row.requested_help),
    consentScope: dataScopes,
    dataScopes,
    status: String(row.status || "pending"),
    consentedAt: row.consented_at ? dateTime(row.consented_at) : null,
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at),
  };
}

export async function POST(req: NextRequest, { params }: Params) {
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
  if (body.consent !== true) {
    return NextResponse.json({ error: "Explicit consent is required" }, { status: 400 });
  }

  const requestedHelp = typeof body.requestedHelp === "string" ? body.requestedHelp.trim() : "";
  if (!requestedHelp) {
    return NextResponse.json({ error: "requestedHelp is required" }, { status: 400 });
  }

  const requestType = isSupportRequestType(body.requestType)
    ? body.requestType
    : "introduction";
  const targetOrganization =
    typeof body.targetOrganization === "string" ? body.targetOrganization.trim() : "";
  if (requestType === "introduction" && !targetOrganization) {
    return NextResponse.json({ error: "targetOrganization is required" }, { status: 400 });
  }

  const scopes = parseScopes(body.scope ?? body.consentScope ?? body.dataScopes);
  if (!scopes) {
    return NextResponse.json(
      { error: "scope must include only approved consent scopes" },
      { status: 400 }
    );
  }

  const { id } = await params;
  const packetRows = await sql`
    SELECT id
    FROM incentive_preparation_packets
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `;
  if (packetRows.length === 0) {
    return NextResponse.json(
      { error: "Incentive Preparation Packet not found" },
      { status: 404 }
    );
  }

  const rows = await sql`
    INSERT INTO incentive_support_requests (
      user_id,
      packet_id,
      request_type,
      target_organization,
      requested_help,
      consent_scope_json,
      status,
      consented_at
    )
    VALUES (
      ${userId},
      ${id},
      ${requestType},
      ${requestType === "introduction" ? targetOrganization : null},
      ${requestedHelp},
      ${JSON.stringify(scopes)}::jsonb,
      'pending',
      NOW()
    )
    RETURNING *
  `;

  // Draft cleanup is intentionally best-effort so a lagging draft-table
  // migration can never block the existing consent-gated request path.
  try {
    await sql`
      DELETE FROM incentive_support_request_drafts
      WHERE packet_id = ${id} AND user_id = ${userId}
    `;
  } catch {
    // The recorded request remains authoritative; a stale draft can be safely
    // overwritten or removed after the migration is applied.
  }

  const supportRequest = toSupportRequest(rows[0] as DatabaseRow);
  return NextResponse.json({ supportRequest, supportRequests: [supportRequest] }, { status: 201 });
}
