import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { ANALYTICS_ADMIN_COOKIE } from "@/lib/analytics-admin-auth";
import { availableSpaceSourceLabel, positiveSquareFeet } from "@/lib/parcel-space";
import { loadCurrentAvailableSpaceMeasurements } from "@/lib/parcel-space-server";
import { normalizePin14 } from "@/lib/cook-viewer";
import { getOwnerCluster } from "@/lib/owner-file";

const AVAILABLE_SPACE_SOURCE_KEYS = [
  "owner_confirmation",
  "seccc_field_survey",
  "cclba_record",
  "city_record",
  "other_verified_record",
] as const;

type AvailableSpaceSourceKey = (typeof AVAILABLE_SPACE_SOURCE_KEYS)[number];

function isAuthorized(req: NextRequest): boolean {
  return hasValidOwnerFilesAdminSession(
    req.cookies.get(OWNER_FILES_ADMIN_COOKIE)?.value,
    req.cookies.get(ANALYTICS_ADMIN_COOKIE)?.value,
  );
}

function trimmed(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= maxLength ? result : null;
}

/** Public-safe current available-space records. Human identity and notes never leave the admin write. */
export async function GET(req: NextRequest) {
  const pin = normalizePin14(req.nextUrl.searchParams.get("pin"));
  const zip = req.nextUrl.searchParams.get("zip")?.trim() ?? "";
  if (!pin && !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "A 14-digit pin or 5-digit zip is required" }, { status: 400 });
  }

  const result = await loadCurrentAvailableSpaceMeasurements({ pin, zip: pin ? null : zip });
  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=300" },
  });
}

/** Admin-gated, append-history write for explicitly verified usable vacant interior space. */
export async function POST(req: NextRequest) {
  if (!isOwnerFilesAdminConfigured()) {
    return NextResponse.json({ error: "Owner Files admin auth is not configured" }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sql = getSQL();
  if (!sql) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body is required" }, { status: 400 });
  }

  const pin = normalizePin14(body.pin);
  const zip = trimmed(body.zip, 5);
  const clusterKey = trimmed(body.clusterKey, 500);
  const sqft = positiveSquareFeet(body.availableSpaceSqft);
  const verifierName = trimmed(body.verifierName, 200);
  const sourceKey = trimmed(body.sourceKey, 80) as AvailableSpaceSourceKey | null;
  const sourceUrl = trimmed(body.sourceUrl, 1000);
  const notes = trimmed(body.notes, 5000);
  const verifiedAtRaw = trimmed(body.verifiedAt, 40);
  const verifiedAt = verifiedAtRaw ? new Date(verifiedAtRaw) : new Date();

  if (!pin) return NextResponse.json({ error: "pin must contain 14 digits" }, { status: 400 });
  if (!zip || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "zip must be a 5-digit ZIP code" }, { status: 400 });
  }
  if (!clusterKey) {
    return NextResponse.json({ error: "clusterKey is required" }, { status: 400 });
  }
  if (sqft === null || sqft > 2_000_000) {
    return NextResponse.json(
      { error: "availableSpaceSqft must be between 1 and 2,000,000" },
      { status: 400 },
    );
  }
  if (!verifierName) {
    return NextResponse.json({ error: "verifierName is required" }, { status: 400 });
  }
  if (!sourceKey || !AVAILABLE_SPACE_SOURCE_KEYS.includes(sourceKey)) {
    return NextResponse.json(
      { error: `sourceKey must be one of: ${AVAILABLE_SPACE_SOURCE_KEYS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!sourceUrl && !notes) {
    return NextResponse.json(
      { error: "A source URL or verification note is required" },
      { status: 400 },
    );
  }
  if (sourceUrl && !/^https?:\/\/\S+$/i.test(sourceUrl)) {
    return NextResponse.json({ error: "sourceUrl must be an http(s) URL" }, { status: 400 });
  }
  if (body.confirmedUsableVacantInteriorSpace !== true) {
    return NextResponse.json(
      { error: "Confirm that this is usable vacant interior space, not lot or whole-building area" },
      { status: 400 },
    );
  }
  if (Number.isNaN(verifiedAt.getTime())) {
    return NextResponse.json({ error: "verifiedAt must be a valid date" }, { status: 400 });
  }
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (verifiedAt < ninetyDaysAgo || verifiedAt > tomorrow) {
    return NextResponse.json(
      { error: "verifiedAt must be within the past 90 days and not in the future" },
      { status: 400 },
    );
  }

  const cluster = await getOwnerCluster(zip, clusterKey);
  const clusterPins = new Set(
    (cluster?.pins ?? []).map(normalizePin14).filter((value): value is string => value !== null),
  );
  if (!cluster) {
    return NextResponse.json({ error: "Owner File was not found in this ZIP" }, { status: 404 });
  }
  if (!clusterPins.has(pin)) {
    return NextResponse.json(
      { error: "PIN does not belong to this Owner File and ZIP" },
      { status: 400 },
    );
  }

  const sourceRecordId = `${sourceKey}:${randomUUID()}`;
  const rawJson = JSON.stringify({ verifierName, sourceUrl });
  const reconfirmAfter = new Date(verifiedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
  try {
    const rows = await sql`
      WITH retired AS (
        UPDATE parcel_space_measurements
        SET is_current = FALSE, is_active = FALSE, updated_at = NOW()
        WHERE pin = ${pin} AND metric = 'available_space' AND is_current IS TRUE
      )
      INSERT INTO parcel_space_measurements (
        pin, zip, metric, sqft, measurement_scope, unit,
        source_key, source_record_id, source_year,
        source_updated_at, fetched_at, match_method, verification_status,
        notes, raw_json, is_current, is_active, verified_at, reconfirm_after
      ) VALUES (
        ${pin}, ${zip}, 'available_space', ${sqft},
        'largest_contiguous_usable_interior_space', 'square_feet',
        ${sourceKey}, ${sourceRecordId},
        ${verifiedAt.getUTCFullYear()}, ${verifiedAt.toISOString()}, NOW(),
        'verified_submission', 'verified', ${notes}, ${rawJson}::jsonb,
        TRUE, TRUE, ${verifiedAt.toISOString()}, ${reconfirmAfter.toISOString()}
      )
      RETURNING pin, sqft, source_key, verified_at, reconfirm_after
    `;
    const saved = rows[0] as Record<string, unknown>;
    return NextResponse.json({
      measurement: {
        pin: String(saved.pin),
        availableSpaceSqft: Math.round(Number(saved.sqft)),
        source: availableSpaceSourceLabel(String(saved.source_key ?? "")),
        verifiedAt: new Date(String(saved.verified_at)).toISOString(),
        reconfirmAfter: new Date(String(saved.reconfirm_after)).toISOString(),
      },
    });
  } catch (error) {
    console.error("[parcel-space] available-space write failed", error);
    return NextResponse.json({ error: "Could not save available-space verification" }, { status: 503 });
  }
}
