import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { ProgramSchema, safeParseArray } from "@/lib/schemas";
import { memCached } from "@/lib/redis";
import type { Program } from "@/lib/types";
import { readFile } from "fs/promises";
import { join } from "path";
import { preferStaticProgramDefinitions } from "@/lib/programs-merge";

const PROGRAMS_CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=3600";

/**
 * GET /api/programs
 *
 * Returns all programs with enhanced fields (contacts, eligibility rules, etc.).
 * DB-first with static JSON fallback.
 */
async function getStaticPrograms(): Promise<Program[]> {
  const file = join(process.cwd(), "public", "data", "programs.json");
  const data = JSON.parse(await readFile(file, "utf8")) as Program[];
  return safeParseArray(ProgramSchema, data, "programs-static") as Program[];
}

export async function GET() {
  const sql = getSQL();
  if (!sql) {
    return NextResponse.json(await getStaticPrograms(), {
      headers: {
        "Cache-Control": PROGRAMS_CACHE_CONTROL,
      },
    });
  }

  try {
    const staticPrograms = await getStaticPrograms();
    const databasePrograms = await memCached("programs:all:v2", 86400, async () => {
      const rows = await sql`
        SELECT
          id, name, level, zone_key, summary, who_qualifies,
          benefits, how_to_apply, required_docs, contact, url,
          contacts, eligibility_rules, last_verified_at,
          benefit_range, fastest_confirming_step
        FROM programs
        ORDER BY
          CASE level
            WHEN 'City' THEN 1
            WHEN 'County' THEN 2
            WHEN 'State' THEN 3
            WHEN 'Federal' THEN 4
          END,
          name
      `;

      const programs = rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        name: r.name,
        level: r.level,
        zoneKey: r.zone_key ?? "",
        summary: r.summary,
        whoQualifies: r.who_qualifies,
        benefits: r.benefits ?? [],
        howToApply: r.how_to_apply ?? [],
        requiredDocs: r.required_docs ?? [],
        contact: r.contact ?? "",
        url: r.url ?? "",
        contacts: r.contacts ?? [],
        eligibilityRules: r.eligibility_rules ?? [],
        lastVerifiedAt:
          r.last_verified_at instanceof Date
            ? r.last_verified_at.toISOString().slice(0, 10)
            : r.last_verified_at ?? null,
        benefitRange: r.benefit_range ?? null,
        fastestConfirmingStep: r.fastest_confirming_step ?? null,
      }));

      return safeParseArray(ProgramSchema, programs, "programs-api") as Program[];
    });

    return NextResponse.json(preferStaticProgramDefinitions(staticPrograms, databasePrograms), {
      headers: {
        "Cache-Control": PROGRAMS_CACHE_CONTROL,
      },
    });
  } catch (err) {
    console.error("programs API error:", err);
    return NextResponse.json(await getStaticPrograms(), {
      headers: {
        "Cache-Control": PROGRAMS_CACHE_CONTROL,
      },
    });
  }
}
