import { neon } from "@neondatabase/serverless";
import { loadEnvConfig } from "@next/env";
import { starterPrograms, starterSources } from "../../lib/grants/seed";
import { programSchema, sourceSchema } from "../../lib/grants/model";
loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = neon(process.env.DATABASE_URL);
async function main() {
  for (const p of starterPrograms)
    await sql`INSERT INTO grants_programs(id,data,updated_by) VALUES(${p.id},${JSON.stringify(programSchema.parse(p.data))}::jsonb,'starter-import') ON CONFLICT DO NOTHING`;
  for (const s of starterSources)
    await sql`INSERT INTO grants_sources(id,data,updated_by) VALUES(${s.id},${JSON.stringify(sourceSchema.parse(s.data))}::jsonb,'starter-import') ON CONFLICT DO NOTHING`;
  console.log(
    "Starter programs and sources loaded without overwriting staff edits. No rounds marked open.",
  );
}
main().catch((error) => {
  console.error("Grants operation failed:", error.message);
  process.exitCode = 1;
});
