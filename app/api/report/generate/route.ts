import { NextRequest, NextResponse } from "next/server";
import { generateReportData, type ReportContext } from "@/lib/report-engine";
import { getProgramsSync } from "@/lib/programs-data";
import { loadCapitalContextForArea } from "@/lib/investment-analysis";
import type { WizardState } from "@/lib/report-wizard-config";
import type { Program } from "@/lib/types";

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
 * routes before this call. Passed through largely as-is, matching the
 * trust level every other request body in this app already gets.
 *
 * No DB (Hard Rules): reads the static catalog directly, matching
 * lib/owner-file-letter-context.ts's own server-only pattern.
 */
interface GenerateRequestBody {
  state?: unknown;
  ctx?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  let body: GenerateRequestBody;
  try {
    body = (await request.json()) as GenerateRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isPlainObject(body.state)) {
    return NextResponse.json({ error: "Missing or invalid state" }, { status: 400 });
  }
  const state = body.state as unknown as WizardState;
  const ctx = (isPlainObject(body.ctx) ? body.ctx : {}) as ReportContext;

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
