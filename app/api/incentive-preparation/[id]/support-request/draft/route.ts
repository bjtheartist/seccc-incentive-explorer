import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import { getSQL } from "@/lib/db";
import { isSupportRequestType } from "@/lib/incentive-support";

type Params = { params: Promise<{ id: string }> };
type DatabaseRow = Record<string, unknown>;

const ALLOWED_SCOPES = new Set([
  "business_profile",
  "packet",
  "documents",
  "contact_information",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSuggestedScopes(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const values = value.map((scope) => (typeof scope === "string" ? scope.trim() : ""));
  if (values.some((scope) => !scope || !ALLOWED_SCOPES.has(scope))) return null;
  return [...new Set(values)];
}

function toDraft(row: DatabaseRow) {
  const rawScopes = Array.isArray(row.suggested_scope_json)
    ? row.suggested_scope_json
    : typeof row.suggested_scope_json === "string"
      ? JSON.parse(row.suggested_scope_json)
      : [];
  return {
    id: String(row.id),
    packetId: String(row.packet_id),
    requestType: isSupportRequestType(row.request_type) ? row.request_type : "introduction",
    targetOrganization: row.target_organization ? String(row.target_organization) : "",
    requestedHelp: String(row.requested_help || ""),
    suggestedScopes: Array.isArray(rawScopes)
      ? rawScopes.filter((scope): scope is string => typeof scope === "string")
      : [],
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function PUT(req: NextRequest, { params }: Params) {
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
  if (!isSupportRequestType(body.requestType)) {
    return NextResponse.json({ error: "requestType is invalid" }, { status: 400 });
  }
  const requestedHelp = typeof body.requestedHelp === "string" ? body.requestedHelp.trim() : "";
  if (!requestedHelp) {
    return NextResponse.json({ error: "requestedHelp is required" }, { status: 400 });
  }
  const targetOrganization =
    typeof body.targetOrganization === "string" ? body.targetOrganization.trim() : "";
  if (body.requestType === "introduction" && !targetOrganization) {
    return NextResponse.json({ error: "targetOrganization is required" }, { status: 400 });
  }
  const suggestedScopes = parseSuggestedScopes(body.suggestedScopes);
  if (!suggestedScopes) {
    return NextResponse.json({ error: "suggestedScopes contains an unsupported value" }, { status: 400 });
  }

  const { id } = await params;
  const packetRows = await sql`
    SELECT id FROM incentive_preparation_packets
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `;
  if (packetRows.length === 0) {
    return NextResponse.json({ error: "Incentive Preparation Packet not found" }, { status: 404 });
  }

  const rows = await sql`
    INSERT INTO incentive_support_request_drafts (
      user_id, packet_id, request_type, target_organization,
      requested_help, suggested_scope_json
    )
    VALUES (
      ${userId}, ${id}, ${body.requestType},
      ${body.requestType === "introduction" ? targetOrganization : null},
      ${requestedHelp}, ${JSON.stringify(suggestedScopes)}::jsonb
    )
    ON CONFLICT (user_id, packet_id) DO UPDATE SET
      request_type = EXCLUDED.request_type,
      target_organization = EXCLUDED.target_organization,
      requested_help = EXCLUDED.requested_help,
      suggested_scope_json = EXCLUDED.suggested_scope_json,
      updated_at = NOW()
    RETURNING *
  `;

  return NextResponse.json({
    draft: toDraft(rows[0] as DatabaseRow),
    note: "Draft saved for review. Nothing was shared or scheduled.",
  });
}
