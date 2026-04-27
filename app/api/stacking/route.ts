import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { StackingRuleSchema, safeParseArray } from "@/lib/schemas";
import { cached } from "@/lib/redis";
import type { StackingRule } from "@/lib/types";
import { readFile } from "fs/promises";
import { join } from "path";

/**
 * GET /api/stacking?program=tif
 *
 * Returns stacking rules for a given program.
 * DB-first with static JSON fallback.
 */
async function getStaticStackingRules(programId: string | null): Promise<StackingRule[]> {
  const file = join(process.cwd(), "public", "data", "stacking-rules.json");
  const data = JSON.parse(await readFile(file, "utf8")) as StackingRule[];
  const validated = safeParseArray(
    StackingRuleSchema,
    data,
    "stacking-static"
  ) as StackingRule[];

  if (!programId) return validated;
  return validated.filter(
    (rule) => rule.programId === programId || rule.otherProgramId === programId
  );
}

export async function GET(request: NextRequest) {
  const programId = request.nextUrl.searchParams.get("program");

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json(await getStaticStackingRules(programId), {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  }

  try {
    const cacheKey = `stacking:${programId || "all"}`;

    const validated = await cached(cacheKey, 86400, async () => {
      let rows;
      if (programId) {
        rows = await sql`
          SELECT
            rule_id, program_id, other_program_id, relationship, scope,
            conditions_json, reason, authority_source, confidence, last_verified_at
          FROM program_stacking_rules
          WHERE program_id = ${programId} OR other_program_id = ${programId}
          ORDER BY confidence DESC, relationship
        `;
      } else {
        rows = await sql`
          SELECT
            rule_id, program_id, other_program_id, relationship, scope,
            conditions_json, reason, authority_source, confidence, last_verified_at
          FROM program_stacking_rules
          ORDER BY confidence DESC, relationship
        `;
      }

      const rules = rows.map((r: Record<string, unknown>) => ({
        id: r.rule_id,
        programId: r.program_id,
        otherProgramId: r.other_program_id,
        relationship: r.relationship,
        scope: r.scope,
        conditionsJson: r.conditions_json ?? null,
        reason: r.reason ?? "",
        authoritySource: r.authority_source ?? "",
        confidence: r.confidence ?? "low",
        lastVerifiedAt: r.last_verified_at ?? null,
      }));

      return safeParseArray(StackingRuleSchema, rules, "stacking-api");
    });

    return NextResponse.json(validated, {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    console.error("stacking API error:", err);
    return NextResponse.json(await getStaticStackingRules(programId), {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  }
}
