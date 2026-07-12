#!/usr/bin/env npx tsx
/**
 * Deletes documents whose retention window has passed: hard-deletes the private
 * blob first, then removes the row (blob delete is idempotent, so a re-run after
 * a partial failure safely finishes the job). Script only — no cron wiring.
 *
 * Requires DATABASE_URL and BLOB_READ_WRITE_TOKEN. Run on a schedule of your
 * choosing once the document feature is provisioned.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." BLOB_READ_WRITE_TOKEN="..." \
 *     npx tsx scripts/cleanup-expired-documents.ts
 */

import { neon } from "@neondatabase/serverless";
import { del } from "@vercel/blob";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  console.log("Cleaning up expired Business File documents...\n");

  const expired = (await sql`
    SELECT id, blob_path
    FROM packet_documents
    WHERE retention_expires_at <= NOW()
  `) as Array<{ id: string; blob_path: string }>;

  console.log(`Found ${expired.length} expired document(s).`);

  let deleted = 0;
  let failed = 0;
  for (const row of expired) {
    try {
      await del(row.blob_path);
      await sql`DELETE FROM packet_documents WHERE id = ${row.id}`;
      deleted += 1;
    } catch (err) {
      failed += 1;
      console.error(`Failed to delete document ${row.id}:`, err);
    }
  }

  console.log(`\nDeleted ${deleted} document(s); ${failed} failure(s).`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Document cleanup failed:", err);
  process.exit(1);
});
