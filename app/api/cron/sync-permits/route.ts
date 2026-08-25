import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { runDailyPermitSync } from "@/lib/ingest/permit-daily-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Permit sync cron is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await runDailyPermitSync({ sql });
    const blocked = result.status === "bootstrap_required" || result.status === "surge_blocked";
    return NextResponse.json(result, {
      status: blocked ? 409 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("daily permit sync failed", error);
    return NextResponse.json(
      { error: "Daily permit sync failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
