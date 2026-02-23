import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { ProgramSchema, safeParseArray } from "@/lib/schemas";

/**
 * GET /api/programs
 *
 * Returns all programs with enhanced fields (contacts, eligibility rules, etc.).
 * DB-first with static JSON fallback.
 */
export async function GET() {
  const sql = getSQL();
  if (!sql) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  try {
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
      lastVerifiedAt: r.last_verified_at ?? null,
      benefitRange: r.benefit_range ?? null,
      fastestConfirmingStep: r.fastest_confirming_step ?? null,
    }));

    const validated = safeParseArray(ProgramSchema, programs, "programs-api");

    return NextResponse.json(validated, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    console.error("programs API error:", err);
    return NextResponse.json(
      { error: "Database query failed" },
      { status: 500 }
    );
  }
}
