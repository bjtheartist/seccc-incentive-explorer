import { NextRequest, NextResponse } from "next/server";
import { generateReportData, type ReportContext } from "@/lib/report-engine";
import { getProgramsSync } from "@/lib/programs-data";
import { loadCapitalContextForArea } from "@/lib/investment-analysis";
import type { WizardState } from "@/lib/report-wizard-config";
import type { Program } from "@/lib/types";
import {
  GenerateReportRequestSchema,
  MAX_GENERATE_BODY_BYTES,
  firstIssue,
} from "@/lib/report-request-schemas";
import {
  reportGenerateClientIdentifier,
  reserveReportGeneration,
} from "@/lib/report-generate-rate-limit";

/**
 * Request ceiling (30s). R2 finding 8: this route sits on the report pathway
 * and had no `maxDuration`, so it ran under the platform default with no
 * declared bound of its own.
 *
 * Runs the full report engine server-side over the internal catalog. Pure
 * compute with no upstream, but the largest report types walk every program
 * across every section, and an unbounded handler has no ceiling at all if a
 * pathological input ever finds a slow path.
 */
export const maxDuration = 30;

/**
 * POST /api/report/generate
 *
 * review6 S11 (CRITICAL, S1 reopened) — replaces app/report/page.tsx's
 * five `generateReportData(state, programs, ctx)` call sites (instant
 * mode, share mode, corridor mode, refine/compare, quick-refine), all of
 * which used to run the report engine CLIENT-SIDE against the full
 * internal catalog fetched from the now-removed
 * /api/programs/engine-source route — an unauthenticated endpoint
 * returning all 71 full internal Program records.
 *
 * `generateReportData()` now runs HERE, server-side, against the full
 * catalog (`getProgramsSync()`, never serialized to the network). Its
 * output (`GeneratedReport`) has no raw `Program` embed anywhere in its
 * type — it's already a flattened structure of labels/values/details
 * built at generation time — so it's safe to return directly, UNLIKE
 * `runConfidenceEngine()`'s `ProgramCheckResult` (see
 * app/api/programs/match/route.ts, which strips its own embed).
 *
 * `state` (WizardState) and `ctx` (ReportContext) are both already
 * client-side, non-catalog data — zones, census, cityZoning, parcel,
 * districts, stacking rules, community assets, local business support,
 * site signals, transport, mobility access, corridor metrics,
 * neighborhood economics — none of it is raw Program data; it's exactly
 * what the client already fetched from its own (already-public) API
 * routes before this call.
 *
 * R2 finding 2 — this paragraph used to end "Passed through largely as-is,
 * matching the trust level every other request body in this app already
 * gets", and that was exactly the problem: `state` and `ctx` were cast
 * (`body.state as unknown as WizardState`) after a single isPlainObject
 * check, the body was read with no size ceiling, and the most expensive
 * endpoint in the app had no rate limit of any kind. All three are addressed
 * below; see lib/report-request-schemas.ts for why the schemas are permissive
 * (app/report/page.tsx is outside this round's fence and must keep working
 * unchanged).
 *
 * DB: this route still generates reports from the static catalog with no
 * database involvement. The rate limiter is the one DB touch, and it FAILS
 * OPEN by design — see lib/report-generate-rate-limit.ts — so an outage
 * degrades the brake, never report generation itself.
 */

export async function POST(request: NextRequest) {
  // ── Size ceiling, before parsing ──────────────────────────────────────
  // `await request.json()` used to buffer and parse whatever arrived. Check
  // the declared length first, then the actual bytes, so an oversized or
  // lying Content-Length is refused either way.
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GENERATE_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 });
  }
  if (rawBody.length > MAX_GENERATE_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Shape validation ──────────────────────────────────────────────────
  const parsed = GenerateReportRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", detail: firstIssue(parsed.error) },
      { status: 400 },
    );
  }

  // ── Rate limit ────────────────────────────────────────────────────────
  const decision = await reserveReportGeneration(
    reportGenerateClientIdentifier(request.headers),
  );
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Too many reports were requested. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(decision.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  // The schemas are `.passthrough()`, so these carry every key the client
  // sent — validated in shape, unchanged in content.
  const state = parsed.data.state as unknown as WizardState;
  const ctx = (parsed.data.ctx ?? {}) as ReportContext;

  const programs: Program[] = getProgramsSync();

  // Gate finding 5 — supporter corridor-investment chart. Resolved HERE,
  // server-side (a Route Handler is never bundled into the client, unlike
  // lib/report-engine.ts), reading the REAL FFIEC CRA series for the
  // community area the client already resolved (ctx.localBusinessSupport,
  // the same source report-engine.ts's buildCommunityAssets uses). Omitted
  // entirely when there's no community area or the file has no series for
  // it — generateReportData's buildCorridorInvestmentContext already
  // treats absence as "render nothing," never a fabricated series.
  const communityArea = ctx.localBusinessSupport?.communityArea;
  if (communityArea) {
    const raw = loadCapitalContextForArea(communityArea);
    if (raw.cra && raw.cra.length > 0) {
      ctx.capitalContext = { communityArea, cra: raw.cra, sources: raw.sources };
    }
  }

  try {
    const report = generateReportData(state, programs, ctx);
    return NextResponse.json(report);
  } catch (err) {
    console.error("report/generate API error:", err);
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 });
  }
}
