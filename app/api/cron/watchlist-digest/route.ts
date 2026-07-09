import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getSQL } from "@/lib/db";
import { findTifBoundaryAtPoint } from "@/lib/tif-boundary";
import { GET as zonesCheckGET } from "@/app/api/zones/check/route";
import { getProgramsSync } from "@/lib/programs-data";
import {
  assessWatchedArea,
  buildDigestEmailHtml,
  loadSbifRollout,
  loadTifFinancialsMap,
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

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return req.headers.get("authorization") === `Bearer ${secret}`;
  }
  return process.env.NODE_ENV !== "production";
}

async function checkZonesAtPoint(lat: number, lon: number): Promise<unknown> {
  // Reuse the zones/check route handler (DB-first with static GeoJSON
  // fallback + caching) instead of duplicating its lookup logic.
  const res = await zonesCheckGET(
    new NextRequest(`http://localhost/api/zones/check?lat=${lat}&lon=${lon}`)
  );
  if (!res.ok) return null;
  return res.json();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        assessment = await assessWatchedArea(area, resolvers, today);
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
