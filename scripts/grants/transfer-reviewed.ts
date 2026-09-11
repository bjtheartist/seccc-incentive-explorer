/** Explicit record transfer for an authorized release; no fixture discovery or deletion. */
import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { schemas, type Resource } from "../../lib/grants/model";

async function main() {
  const {
    GRANTS_SOURCE_DATABASE_URL,
    GRANTS_RELEASE_DATABASE_URL,
    GRANTS_OWNER_USER_ID,
  } = process.env;
  if (
    !GRANTS_SOURCE_DATABASE_URL ||
    !GRANTS_RELEASE_DATABASE_URL ||
    !GRANTS_OWNER_USER_ID
  )
    throw new Error(
      "Source, destination, and verified owner configuration required",
    );
  if (GRANTS_SOURCE_DATABASE_URL === GRANTS_RELEASE_DATABASE_URL)
    throw new Error("Source and destination must differ");
  const source = neon(GRANTS_SOURCE_DATABASE_URL),
    target = neon(GRANTS_RELEASE_DATABASE_URL);
  const manifest = JSON.parse(
    await readFile(process.argv[2], "utf8"),
  ) as Partial<Record<Resource, string[]>>;
  const tableNames = {
    programs: "grants_programs",
    rounds: "grants_rounds",
    applicants: "grants_applicants",
    sources: "grants_sources",
  };
  if (
    Object.keys(manifest).some((key) => !(key in tableNames)) ||
    Object.values(manifest).some(
      (ids) => !Array.isArray(ids) || ids.some((id) => typeof id !== "string"),
    )
  )
    throw new Error("Invalid transfer manifest");
  const owner =
    await target`SELECT id FROM users WHERE id=${GRANTS_OWNER_USER_ID}`;
  if (owner.length !== 1)
    throw new Error("Owner must be an existing destination account");
  const records: { table: string; id: string; data: unknown }[] = [];
  for (const [resource, table] of Object.entries(tableNames)) {
    const key = resource as keyof typeof tableNames;
    for (const id of manifest[key] || []) {
      const rows = await source.query(`SELECT data FROM ${table} WHERE id=$1`, [
        id,
      ]);
      if (rows.length !== 1)
        throw new Error(`Missing selected ${resource} record`);
      records.push({ table, id, data: schemas[key].parse(rows[0].data) });
    }
  }
  if (process.argv.includes("--check")) {
    console.log(
      `Validated ${records.length} selected records and destination owner; no writes performed.`,
    );
    return;
  }
  await target.transaction([
    target.query(
      "INSERT INTO grants_members(user_id,role,active) VALUES($1,'owner',true) ON CONFLICT DO NOTHING",
      [GRANTS_OWNER_USER_ID],
    ),
    ...records.map((r) =>
      target.query(
        `INSERT INTO ${r.table}(id,data,updated_by) VALUES($1,$2::jsonb,$3) ON CONFLICT DO NOTHING`,
        [r.id, JSON.stringify(r.data), GRANTS_OWNER_USER_ID],
      ),
    ),
  ]);
  console.log(
    `Transferred ${records.length} explicitly selected records without overwriting destination edits.`,
  );
}
main().catch(() => {
  console.error(
    "Selected-record transfer failed. Check source/destination configuration and manifest; no credentials logged.",
  );
  process.exitCode = 1;
});
