import { NextRequest, NextResponse } from "next/server";
import {
  clearVisitorCookie,
  resolveActivityIdentity,
  setVisitorCookie,
  VISITOR_COOKIE,
} from "@/lib/activity-identity";
import { sanitizeAnalyticsEventPayload } from "@/lib/analytics-events";
import { recordReportEvent } from "@/lib/server-analytics";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const event = sanitizeAnalyticsEventPayload(body.eventType, body);

  if (!event) {
    return NextResponse.json({ error: "Invalid analytics event" }, { status: 400 });
  }

  // Identity comes from the session and the server-issued cookie, never from
  // the request body (sanitizeAnalyticsEventPayload drops any client userId).
  const identity = await resolveActivityIdentity(req, { mintVisitorId: true });
  // The client stops sending after an opt-out; this covers stale tabs and
  // GPC browsers, and removes any visitor id issued before the choice.
  if (identity.analyticsOptedOut) {
    const res = NextResponse.json({ success: true, stored: false });
    if (req.cookies.has(VISITOR_COOKIE)) clearVisitorCookie(res);
    return res;
  }
  const stored = await recordReportEvent(event.eventType, {
    ...event,
    userId: identity.userId,
    anonymousId: identity.anonymousId,
  });

  const res = NextResponse.json({ success: true, stored });
  if (identity.issuedVisitorId && identity.anonymousId) {
    setVisitorCookie(res, identity.anonymousId);
  }
  return res;
}
