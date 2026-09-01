import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getSQL } from "@/lib/db";
import { findTifBoundaryAtPoint } from "@/lib/tif-boundary";
import { GET as zonesCheckV2GET } from "@/app/api/zones/check/v2/route";
import { getProgramsSync } from "@/lib/programs-data";
import {
  assessWatchedArea,
  buildDigestEmailHtml,
  loadSbifRollout,
  loadTifFinancialsMap,
  parsePointAreaId,
  type AreaAssessment,
  type AreaResolvers,
} from "@/lib/watchlist-digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/watchlist-digest
 *
 * Weekly digest for users with watched areas: per area, TIF district
 * expiration (12-month flag, 120-day urgent) and program/zone deadlines
 * within 90 days. One email per user; users with zero notable items are
 * skipped.
 *
 * Auth: when CRON_SECRET is set (Vercel sends it as `Authorization: Bearer
 * <CRON_SECRET>` for cron invocations) the header is required. Without the
 * env var the route only runs outside production.
 *
 * `?dryRun=1` returns the would-send payload as JSON without emailing.
 */

interface DigestUserRow {
  userId: string;
  email: string | null;
  name: string | null;
  areas: { areaType: string; areaId: string; areaLabel: string | null }[];
}

/**
 * Fail CLOSED when CRON_SECRET is unset (R2 finding 7).
 *
 * This used to end `return process.env.NODE_ENV !== "production"` — an
 * unauthenticated open door on any deployment whose NODE_ENV was not exactly
 * "production". Preview deployments are the obvious case: they run against
 * real infrastructure, carry real user rows, and this route reads the watched
 * areas of every user and SENDS THEM EMAIL. "Not production" was standing in
 * for "not real", and it is not the same thing.
 *
 * Now it matches app/api/cron/sync-permits/route.ts, which already treated a
 * missing secret as "this cron is not configured" and refused. Callers get 503
 * for unconfigured (an honest description of the deployment) and 401 for a bad
 * or missing header — never a free pass.
 */
type CronAuthResult = "ok" | "unconfigured" | "unauthorized";

function cronAuth(req: NextRequest): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) return "unconfigured";
  return req.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "unauthorized";
}

async function checkZonesAtPoint(lat: number, lon: number): Promise<unknown> {
  // review6 S16: was the v1 zones/check route handler — migrated to v2
  // (see lib/watchlist-digest.ts's own comment on the normalize call for
  // why). Reuses the route handler in-process (DB-first with static
  // GeoJSON fallback + Redis caching) instead of duplicating its lookup
  // logic, same pattern the v1 call already used. Layers param omitted
  // — the v2 route defaults to every CHECKABLE_ZONE_KEYS, matching v1's
  // "check everything" behavior.
  const res = await zonesCheckV2GET(
    new NextRequest(`http://localhost/api/zones/check/v2?lat=${lat}&lon=${lon}`)
  );
  if (!res.ok) return null;
  return res.json();
}

export async function GET(req: NextRequest) {
  const auth = cronAuth(req);
  if (auth === "unconfigured") {
    return NextResponse.json(
      { error: "Watchlist digest cron is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (auth === "unauthorized") {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  if (!dryRun && !process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "Email service not configured" },
      { status: 503 }
    );
  }

  const rows = await sql`
    SELECT w.user_id, w.area_type, w.area_id, w.area_label, u.email, u.name
    FROM watched_areas w
    JOIN users u ON u.id = w.user_id
    ORDER BY w.user_id, w.created_at DESC
  `;

  const users = new Map<string, DigestUserRow>();
  for (const row of rows as Record<string, unknown>[]) {
    const userId = String(row.user_id);
    let user = users.get(userId);
    if (!user) {
      user = {
        userId,
        email: row.email ? String(row.email) : null,
        name: row.name ? String(row.name) : null,
        areas: [],
      };
      users.set(userId, user);
    }
    user.areas.push({
      areaType: String(row.area_type),
      areaId: String(row.area_id),
      areaLabel: row.area_label ? String(row.area_label) : null,
    });
  }

  const resolvers: AreaResolvers = {
    findTifBoundary: findTifBoundaryAtPoint,
    checkZones: checkZonesAtPoint,
    programs: getProgramsSync(),
    tifFinancials: loadTifFinancialsMap(),
    sbifRollout: loadSbifRollout(),
  };

  const today = new Date();
  // Areas are shared across users at identical coordinates; assess each
  // distinct areaId once.
  const assessmentCache = new Map<string, AreaAssessment | null>();

  const outbox: {
    userId: string;
    email: string;
    subject: string;
    html: string;
    areas: AreaAssessment[];
  }[] = [];
  let usersSkipped = 0;

  for (const user of users.values()) {
    const assessments: AreaAssessment[] = [];
    for (const area of user.areas) {
      let assessment = assessmentCache.get(area.areaId);
      if (assessment === undefined) {
        // review8 S27 (HIGH, BLOCKING): `assessWatchedArea` itself now
        // degrades any failure for a VALID point into a notable,
        // `zoneDataIncomplete: true` result (see its own S27 comment) —
        // it should no longer reject at all for a parseable areaId. This
        // catch is defense in depth, not the primary fix: if it ever
        // fires anyway, it must NOT reduce to the old `null` (which
        // silently dropped the area from the digest with no caveat,
        // while a user's OTHER, successfully-assessed areas still sent —
        // the exact false-negative this finding is about). A parseable
        // point still gets a synthetic notable/zoneDataIncomplete entry;
        // only a genuinely unparseable areaId (parsePointAreaId returns
        // null, same as assessWatchedArea's own early return) stays null.
        assessment = await assessWatchedArea(area, resolvers, today).catch(
          (err) => {
            console.error("watchlist digest: area assessment failed", area.areaId, err);
            const point = parsePointAreaId(area.areaId);
            if (!point) return null;
            return {
              areaId: area.areaId,
              areaLabel: area.areaLabel || area.areaId,
              lat: point.lat,
              lon: point.lon,
              tif: null,
              deadlines: [],
              notable: true,
              zoneDataIncomplete: true,
            } satisfies AreaAssessment;
          }
        );
        assessmentCache.set(area.areaId, assessment);
      }
      if (assessment) {
        // Re-attach this user's label (cache is keyed by coordinates only).
        assessments.push({
          ...assessment,
          areaLabel: area.areaLabel || assessment.areaLabel,
        });
      }
    }

    const notable = assessments.filter((a) => a.notable);
    if (notable.length === 0 || !user.email) {
      usersSkipped += 1;
      continue;
    }

    const { subject, html } = buildDigestEmailHtml(user.name, notable);
    outbox.push({ userId: user.userId, email: user.email, subject, html, areas: notable });
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      usersWithWatchedAreas: users.size,
      usersSkipped,
      wouldSend: outbox.map((o) => ({
        userId: o.userId,
        email: o.email,
        subject: o.subject,
        areas: o.areas.map((a) => ({
          areaId: a.areaId,
          areaLabel: a.areaLabel,
          tif: a.tif,
          deadlines: a.deadlines,
        })),
      })),
    });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  let emailsSent = 0;
  const errors: string[] = [];

  for (const message of outbox) {
    try {
      await resend.emails.send({
        from: "Chicago Incentive Explorer <reports@chicagoincentiveexplorer.com>",
        to: [message.email],
        subject: message.subject,
        html: message.html,
      });
      emailsSent += 1;
    } catch (err) {
      console.error("watchlist digest send failed:", message.userId, err);
      errors.push(message.userId);
    }
  }

  return NextResponse.json({
    ok: true,
    usersWithWatchedAreas: users.size,
    usersSkipped,
    emailsSent,
    failed: errors.length,
  });
}
