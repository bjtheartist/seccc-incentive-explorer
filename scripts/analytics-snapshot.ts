#!/usr/bin/env npx tsx
/**
 * Prints aggregate usage counts from existing Neon tables.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/analytics-snapshot.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function count(label: string, query: () => Promise<Record<string, unknown>[]>) {
  try {
    const rows = await query();
    console.log(`${label}: ${rows[0]?.count ?? 0}`);
  } catch {
    console.log(`${label}: table not found`);
  }
}

async function main() {
  console.log("Chicago Incentive Explorer usage snapshot\n");

  await count("Users", () => sql`SELECT COUNT(*)::int AS count FROM users`);
  await count("Saved reports", () => sql`SELECT COUNT(*)::int AS count FROM saved_reports`);
  await count("Business projects", () => sql`SELECT COUNT(*)::int AS count FROM business_projects`);
  await count("Lead/download inquiries", () => sql`SELECT COUNT(*)::int AS count FROM report_leads`);
  await count("Tracked product events", () => sql`SELECT COUNT(*)::int AS count FROM report_events`);

  try {
    const rows = await sql`
      SELECT event_type, COUNT(*)::int AS count
      FROM report_events
      GROUP BY event_type
      ORDER BY count DESC, event_type ASC
    `;
    if (rows.length > 0) {
      console.log("\nEvents by type");
      for (const row of rows) {
        console.log(`- ${row.event_type}: ${row.count}`);
      }
    }
  } catch {
    // The migration may not have run yet.
  }
}

main().catch((err) => {
  console.error("Analytics snapshot failed:", err);
  process.exit(1);
});
