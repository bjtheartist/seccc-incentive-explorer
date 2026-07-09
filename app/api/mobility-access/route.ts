import { NextRequest, NextResponse } from "next/server";
import { parseLatLon } from "@/lib/district-lookup";
import { getMobilityAccess } from "@/lib/mobility-access";

export const runtime = "nodejs";

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
};

export async function GET(request: NextRequest) {
  const parsed = parseLatLon(
    request.nextUrl.searchParams.get("lat"),
    request.nextUrl.searchParams.get("lon"),
  );

  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await getMobilityAccess(parsed.latNum, parsed.lonNum);
  return NextResponse.json(result, { headers: CDN_HEADERS });
}
