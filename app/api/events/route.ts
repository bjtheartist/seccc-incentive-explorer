import { NextRequest, NextResponse } from "next/server";
import { sanitizeAnalyticsEventPayload } from "@/lib/analytics-events";
import { recordReportEvent } from "@/lib/server-analytics";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const event = sanitizeAnalyticsEventPayload(body.eventType, body);

  if (!event) {
    return NextResponse.json({ error: "Invalid analytics event" }, { status: 400 });
  }

  const stored = await recordReportEvent(event.eventType, event);
  return NextResponse.json({ success: true, stored });
}
