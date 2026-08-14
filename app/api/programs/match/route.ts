import { NextRequest, NextResponse } from "next/server";
import { runConfidenceEngine } from "@/lib/confidence-engine";
import { getProgramsSync } from "@/lib/programs-data";
import type { ParcelData, Program, ProgramCheckResult, SafeMapProgramMatch } from "@/lib/types";

/**
 * POST /api/programs/match
 *
 * review6 S11 (CRITICAL, S1 reopened) — replaces components/map/MapView.tsx's
 * client-side `runConfidenceEngine()` call, which used to fetch the FULL
 * internal catalog from the now-removed /api/programs/engine-source route
 * (an unauthenticated endpoint returning all 71 full Program records —
 * reopening the exact exposure S1 was meant to close).
 *
 * `runConfidenceEngine()` now runs HERE, server-side, against the full
 * catalog (`getProgramsSync()`, never serialized to the network). Its raw
 * output (`ProgramCheckResult[]`) embeds a full `Program` per match — that
 * embed is stripped down to `SafeMapProgramMatch` (lib/types.ts) before
 * this route returns anything: `{id, name, level, zoneKey, url,
 * sourceUrl}` only, exactly the fields
 * components/map/MapDossierCard.tsx / MapSnapshotPanel.tsx actually read.
 * Filtering to positives (`relevance !== "not_mapped_at_location"`) and
 * capping to the top 3 also happens here — the client never sees the full
 * ranked/unfiltered list.
 */
function toSafeMapProgramMatch(result: ProgramCheckResult): SafeMapProgramMatch {
  return {
    programId: result.programId,
    program: {
      id: result.program.id,
      name: result.program.name,
      level: result.program.level,
      zoneKey: result.program.zoneKey ?? "",
      url: result.program.url ?? "",
      sourceUrl: result.program.sourceUrl,
    },
  };
}

interface MatchRequestBody {
  zones?: unknown;
  zoneNames?: unknown;
  parcel?: unknown;
}

function isRecordOfBoolean(value: unknown): value is Record<string, boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === "boolean");
}

function isRecordOfString(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === "string");
}

export async function POST(request: NextRequest) {
  let body: MatchRequestBody;
  try {
    body = (await request.json()) as MatchRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRecordOfBoolean(body.zones)) {
    return NextResponse.json({ error: "Invalid or missing zones" }, { status: 400 });
  }
  const zones = body.zones;
  const zoneNames = isRecordOfString(body.zoneNames) ? body.zoneNames : {};
  // `parcel` is client-fetched public parcel-record data (never catalog
  // data) — passed through untyped-but-trusted, matching how every other
  // route in this app treats already-public request-body payloads.
  const parcel = (body.parcel ?? undefined) as ParcelData | undefined;

  const programs: Program[] = getProgramsSync();
  const results = runConfidenceEngine(programs, zones, zoneNames, undefined, parcel);
  const topMatches = results
    .filter((r) => r.relevance !== "not_mapped_at_location")
    .slice(0, 3)
    .map(toSafeMapProgramMatch);

  return NextResponse.json({ programs: topMatches });
}
