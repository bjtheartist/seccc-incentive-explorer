import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import {
  SPATIAL_MATCH_RADIUS_M,
  type MatchedPermit,
  type PermitMatchConfidence,
  type PermitMatchMethod,
} from "@/lib/permit-match";

/**
 * Matched building permit records for ONE vacant parcel.
 *
 * GET /api/permit-match?id=<vacant_properties.id>
 * GET /api/permit-match?pin=<14-digit digits-only Cook County PIN>
 *
 * The map card keys on `pin` because that is what its features carry; the
 * `id` form exists for callers that hold the vacant_properties primary key.
 *
 * PUBLIC, like /api/site-activity: every field served here is a City of Chicago
 * Building Permits record (`ydr8-5enu`) plus how it was matched. There are no
 * owner names, no taxpayer records, and nothing from the gated Community
 * Investment dataset.
 *
 * ── Honesty rails this route enforces ──
 *
 *  • It returns the individual matched records and NOTHING aggregated. There is
 *    no total, no sum, no count of dollars. `reported_cost` is the applicant's
 *    own estimate on the application form; adding two of them together produces
 *    a number that means nothing while looking like a capital figure, so the
 *    opportunity to do it does not exist in the payload.
 *  • A parcel with no matches returns `{ matches: [] }` with 200. That is a
 *    genuine absence, and the client renders it as one.
 *  • A database that is not configured, or a match table that does not exist on
 *    this branch, returns 503 — NOT an empty list. The client renders 503 as
 *    "could not check", never as "no permit record", because the difference is
 *    the difference between a fact about the parcel and a fact about the server.
 */

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

/** Most recent matches first; a parcel with a long permit history is capped so
 *  one response cannot balloon. The card shows one; the cap is headroom. */
const MAX_MATCHES = 20;

const METHODS: readonly string[] = ["pin_exact", "address_normalized", "spatial_proximity"];
const CONFIDENCES: readonly string[] = ["high", "medium", "low"];

function toStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
  const pin = (request.nextUrl.searchParams.get("pin") ?? "").replace(/\D/g, "");
  if (!id && pin.length !== 14) {
    return NextResponse.json(
      { error: "id, or a 14-digit pin, is required" },
      { status: 400 },
    );
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  try {
    // One query for both key forms: an empty `id` never equals a real id and an
    // empty `pin` never equals a real pin, so whichever the caller supplied is
    // the one that selects. No dynamic SQL, no second code path to keep in sync.
    const rows = await sql`
      SELECT
        bp.permit_id,
        bp.permit_type,
        bp.work_type,
        bp.work_description,
        bp.issue_date::text AS issue_date,
        bp.reported_cost,
        bp.permit_status,
        bp.permit_milestone,
        bp.permit_condition,
        m.match_method,
        m.match_confidence
      FROM vacant_property_permit_matches m
      JOIN vacant_properties vp ON vp.id = m.vacant_property_id
      JOIN building_permits bp ON bp.permit_id = m.permit_id
      WHERE (
        (${id} <> '' AND vp.id = ${id})
        OR (${pin} <> '' AND vp.pin = ${pin})
      )
        AND (
          m.match_method <> 'spatial_proximity'
          OR (
            -- Proximity is fallback evidence, never a competing explanation
            -- for a permit that already has a PIN/address match anywhere in
            -- the vacant-parcel universe.
            NOT EXISTS (
              SELECT 1
              FROM vacant_property_permit_matches stronger
              WHERE stronger.permit_id = m.permit_id
                AND stronger.match_method IN ('pin_exact', 'address_normalized')
            )
            AND bp.geom IS NOT NULL
            AND vp.geom IS NOT NULL
            -- A permit point may fall within 25 m of several narrow Chicago
            -- parcels. Serve it only on the closest parcel; id is the stable
            -- tie-break when two parcel points share coordinates.
            AND NOT EXISTS (
              SELECT 1
              FROM vacant_properties other_vp
              WHERE other_vp.geom IS NOT NULL
                AND other_vp.id <> vp.id
                AND ST_DWithin(bp.geom, other_vp.geom, ${SPATIAL_MATCH_RADIUS_M})
                AND (
                  ST_Distance(bp.geom, other_vp.geom) < ST_Distance(bp.geom, vp.geom)
                  OR (
                    ST_Distance(bp.geom, other_vp.geom) = ST_Distance(bp.geom, vp.geom)
                    AND other_vp.id < vp.id
                  )
                )
            )
          )
        )
      ORDER BY
        array_position(
          ARRAY['pin_exact','address_normalized','spatial_proximity'],
          m.match_method
        ),
        bp.issue_date DESC NULLS LAST,
        bp.permit_id
      LIMIT ${MAX_MATCHES}
    `;

    const matches: MatchedPermit[] = rows
      .filter(
        (r) =>
          METHODS.includes(String(r.match_method)) &&
          CONFIDENCES.includes(String(r.match_confidence)),
      )
      .map((r) => ({
        permitId: String(r.permit_id),
        permitType: toStringOrNull(r.permit_type),
        workType: toStringOrNull(r.work_type),
        workDescription: toStringOrNull(r.work_description),
        issueDate: toStringOrNull(r.issue_date),
        reportedCost: toNumberOrNull(r.reported_cost),
        permitStatus: toStringOrNull(r.permit_status),
        permitMilestone: toStringOrNull(r.permit_milestone),
        permitCondition: toStringOrNull(r.permit_condition),
        matchMethod: String(r.match_method) as PermitMatchMethod,
        matchConfidence: String(r.match_confidence) as PermitMatchConfidence,
      }));

    return NextResponse.json({ matches }, { headers: CDN_HEADERS });
  } catch (err) {
    // Table absent on this branch, connection failure, anything else: 503, so
    // the surface says "could not check" instead of claiming an absence.
    console.warn(
      "permit-match lookup failed:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "permit match unavailable" }, { status: 503 });
  }
}
