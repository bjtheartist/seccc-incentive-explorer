import { NextRequest, NextResponse } from "next/server";
import { scoreSurveyWithPrograms } from "@/lib/survey-engine";
import { getProgramsSync } from "@/lib/programs-data";
import type { Program, SurveyAnswers } from "@/lib/types";

/**
 * POST /api/survey/score
 *
 * review6 S11 (CRITICAL, S1 reopened): the /qualify survey used to fetch
 * the FULL internal catalog client-side (via the now-removed
 * /api/programs/engine-source route) and score it in the browser. That
 * route was itself an unauthenticated public endpoint returning all 71
 * full internal Program records — reopening the exact exposure S1 was
 * meant to close. Scoring now runs HERE, server-side: the full catalog
 * (`getProgramsSync()`, server-only — same static-file read
 * lib/owner-file-letter-context.ts already uses for its own server-side
 * confidence-engine call) never leaves this process. Only the result of
 * `scoreSurveyWithPrograms()` — a `SurveyResult` whose `program` field is
 * always the narrow `{name, short, level}` shape and whose `explanation`
 * comes from `buildPublicMatchExplanation()`'s safe-transformation
 * boundary — is ever serialized to the response.
 *
 * No DB (Hard Rules): reads the static catalog directly, matching
 * lib/owner-file-letter-context.ts's own server-only pattern rather than
 * the old route's DB+static merge (this endpoint's data doesn't need to
 * reflect same-day DB edits any more than that comparable server path
 * does).
 */
function isSurveyAnswers(value: unknown): value is SurveyAnswers {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.industry !== undefined && typeof v.industry !== "string") return false;
  if (v.property !== undefined && typeof v.property !== "string") return false;
  if (v.size !== undefined && typeof v.size !== "string") return false;
  if (v.activities !== undefined) {
    if (!Array.isArray(v.activities)) return false;
    if (!v.activities.every((item) => typeof item === "string")) return false;
  }
  return true;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const answers = (body as { answers?: unknown } | null)?.answers;
  if (!isSurveyAnswers(answers)) {
    return NextResponse.json({ error: "Invalid survey answers" }, { status: 400 });
  }

  const programs: Program[] = getProgramsSync();
  const programDetails = new Map(programs.map((program) => [program.id, program]));

  const result = scoreSurveyWithPrograms(answers, programDetails);
  return NextResponse.json(result);
}
