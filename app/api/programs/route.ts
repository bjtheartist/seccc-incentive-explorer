import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { ProgramSchema, safeParseArray } from "@/lib/schemas";
import { memCached } from "@/lib/redis";
import type { Program } from "@/lib/types";
import { readFile } from "fs/promises";
import { join } from "path";
import { preferStaticProgramDefinitions } from "@/lib/programs-merge";
import { toPublicProgramView, type PublicProgramView } from "@/lib/program-public";

const PROGRAMS_CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=3600";

/**
 * review5 S1 (CRITICAL): this route previously returned raw `Program[]` —
 * every internal-only field (whoQualifies, benefits, requiredDocs,
 * verificationSteps, applicationPortals, contacts, howToApply,
 * boundaryDisclaimer, sunsetWarning, ...) over the wire to any client. It
 * now projects every record through `toPublicProgramView()` before
 * returning — this is the ONE public HTTP boundary every remaining client
 * fetch of program data goes through, so it is the actual enforcement
 * point of the "hard cutover", not just a relocated file read.
 */
function toPublicView(program: Program, asOf: string): PublicProgramView {
  return toPublicProgramView(program, asOf);
}

/**
 * GET /api/programs
 *
 * Returns the public program projection (PublicProgramView[]) — DB-first
 * with static JSON fallback, sourced from data/programs-internal.json
 * server-side only.
 */
async function getStaticPrograms(): Promise<Program[]> {
  // build-spec.md 2.2 (hard cutover): public/data/programs.json is deleted;
  // data/programs-internal.json (server-only, PR1 section 1.2) is the
  // source of truth. This route is the one server boundary every client
  // surface now fetches from instead of reading the deleted public file.
  const file = join(process.cwd(), "data", "programs-internal.json");
  const data = JSON.parse(await readFile(file, "utf8")) as Program[];
  return safeParseArray(ProgramSchema, data, "programs-static") as Program[];
}

function projectAll(programs: Program[]): PublicProgramView[] {
  const asOf = new Date().toISOString();
  return programs.map((p) => toPublicView(p, asOf));
}

export async function GET() {
  const sql = getSQL();
  if (!sql) {
    return NextResponse.json(projectAll(await getStaticPrograms()), {
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

    return NextResponse.json(
      projectAll(preferStaticProgramDefinitions(staticPrograms, databasePrograms)),
      {
        headers: {
          "Cache-Control": PROGRAMS_CACHE_CONTROL,
        },
      },
    );
  } catch (err) {
    console.error("programs API error:", err);
    return NextResponse.json(projectAll(await getStaticPrograms()), {
      headers: {
        "Cache-Control": PROGRAMS_CACHE_CONTROL,
      },
    });
  }
}
