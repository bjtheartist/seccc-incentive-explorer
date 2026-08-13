import { NextRequest, NextResponse } from "next/server";
import { CHECKABLE_ZONE_KEYS } from "@/lib/constants";
import { ZONE_DATA_REVISION } from "@/lib/zone-layer-registry";
import { resolveZoneEvidenceV2Cached } from "@/lib/zone-evidence-cache";

export const runtime = "nodejs";

/**
 * GET /api/zones/check/v2?lat=&lon=&layers=tif,nof,...
 *
 * NEW route (build-spec.md 1.3) — a distinct, versioned contract from
 * /api/zones/check (v1, untouched, still returns the legacy positives-only
 * array). No PR1 consumer calls this route yet; it exists so the producer
 * side of Zone Evidence v2 is fully built and tested before PR2 migrates
 * consumers onto it.
 *
 * Response shape:
 *   { schemaVersion: 2, dataRevision, checkedAt, requestedLayers,
 *     layers: { [key]: { state: "matched"|"not_matched"|"unknown", name?, reason? } } }
 *
 * No redundant checked[]/unknown[] arrays — `layers` is the single source
 * of truth; derive any convenience list from it (see
 * lib/zone-response.ts's normalizeZoneEvidenceV2 for exactly that).
 *
 * Caching: any response containing an `unknown` layer sets
 * `Cache-Control: no-store` on the HTTP response (the CDN/browser must
 * never treat a partial-failure response as cacheable evidence), and the
 * Redis layer underneath (lib/zone-evidence-cache.ts) independently caps
 * that same response's own TTL at 5 minutes — see that module's doc
 * comment for why "stale-on-error must never serve as evidence for a
 * negative claim" needs both.
 */
export async function GET(request: NextRequest) {
  const lat = request.nextUrl.searchParams.get("lat");
  const lon = request.nextUrl.searchParams.get("lon");
  const layersParam = request.nextUrl.searchParams.get("layers");

  if (!lat || !lon) {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });
  }

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    return NextResponse.json({ error: "lat and lon must be valid numbers" }, { status: 400 });
  }

  const requestedLayers = layersParam
    ? layersParam
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    : [...CHECKABLE_ZONE_KEYS];

  try {
    const { layers, hadUnknown } = await resolveZoneEvidenceV2Cached(
      ZONE_DATA_REVISION,
      latNum,
      lonNum,
      requestedLayers
    );

    const body = {
      schemaVersion: 2 as const,
      dataRevision: ZONE_DATA_REVISION,
      checkedAt: new Date().toISOString(),
      requestedLayers,
      layers,
    };

    return NextResponse.json(body, {
      headers: hadUnknown
        ? { "Cache-Control": "no-store" }
        : { "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error("zone check v2 API error:", err);
    return NextResponse.json({ error: "Zone check failed" }, { status: 500 });
  }
}
