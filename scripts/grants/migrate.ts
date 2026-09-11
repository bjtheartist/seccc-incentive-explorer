import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = neon(process.env.DATABASE_URL);
// Split only at SQL statement boundaries, preserving dollar-quoted function bodies.
export function statements(input: string) {
  const parts: string[] = [];
  let start = 0,
    dollar = false,
    quote = false;
  for (let i = 0; i < input.length; i++) {
    if (!quote && input.slice(i, i + 2) === "$$") {
      dollar = !dollar;
      i++;
      continue;
    }
    if (!dollar && input[i] === "'") {
      if (quote && input[i + 1] === "'") {
        i++;
        continue;
      }
      quote = !quote;
    }
    if (!dollar && !quote && input[i] === ";") {
      parts.push(input.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (input.slice(start).trim()) parts.push(input.slice(start));
  return parts;
}
async function main() {
  const ddl = await readFile(
    new URL("../../lib/grants/schema.sql", import.meta.url),
    "utf8",
  );
  await sql.transaction(
    statements(ddl).map((statement) => sql.query(statement, [])),
  );
  console.log("Grants schema migrated successfully (additive, transactional).");
}
main().catch((error) => {
  console.error("Grants operation failed:", error.message);
  process.exitCode = 1;
});
