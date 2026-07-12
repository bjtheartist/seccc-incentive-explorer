import { NextResponse } from "next/server";
import { isConciergeEnabled } from "@/lib/concierge/config";

export const runtime = "nodejs";

/**
 * Lightweight, unauthenticated flag check so the client panel can stay hidden
 * when the guide is turned off. Returns only a boolean and never leaks model
 * credential presence or a model id.
 */
export async function GET() {
  return NextResponse.json(
    { enabled: isConciergeEnabled() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
