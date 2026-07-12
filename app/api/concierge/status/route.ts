import { NextResponse } from "next/server";
import { isConciergeEnabled } from "@/lib/concierge/config";

export const runtime = "nodejs";

/**
 * Lightweight, unauthenticated flag check so the client panel can stay hidden
 * entirely when the concierge is turned off or has no gateway key. Returns only
 * a boolean — never leaks key presence or model id.
 */
export async function GET() {
  return NextResponse.json(
    { enabled: isConciergeEnabled() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
