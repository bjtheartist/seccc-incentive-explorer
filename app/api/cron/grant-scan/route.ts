import { timingSafeEqual } from "node:crypto";
import { scanSources } from "@/lib/grants/scanner";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = Buffer.from(req.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (
    !secret ||
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.GRANTS_SCAN_ENABLED !== "true")
    return Response.json({
      skipped: true,
      reason: "Grant scanning is not enabled",
    });
  try {
    return Response.json(await scanSources(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Grant scanner unavailable" },
      { status: 503 },
    );
  }
}
