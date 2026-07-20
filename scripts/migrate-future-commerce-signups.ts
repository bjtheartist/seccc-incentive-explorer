/** Create storage for the Future of Commerce event email list. */
import { neon } from "@neondatabase/serverless";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  await sql`
    CREATE TABLE IF NOT EXISTS future_commerce_signups (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      email TEXT NOT NULL UNIQUE,
      neighborhood TEXT NOT NULL,
      street_address TEXT NOT NULL,
      zip_code TEXT NOT NULL,
      marketing_consent BOOLEAN NOT NULL DEFAULT TRUE,
      consent_version TEXT NOT NULL,
      source TEXT NOT NULL,
      subscribed BOOLEAN NOT NULL DEFAULT TRUE,
      consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      unsubscribed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS future_commerce_signups_created_at_idx
    ON future_commerce_signups (created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS future_commerce_signups_zip_idx
    ON future_commerce_signups (zip_code)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS future_commerce_signup_attempts (
      id BIGSERIAL PRIMARY KEY,
      client_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS future_commerce_signup_attempts_created_at_idx
    ON future_commerce_signup_attempts (created_at DESC)
  `;

  console.log("Future of Commerce signup storage is ready.");
}

main().catch((error) => {
  console.error("Future of Commerce signup migration failed:", error);
  process.exit(1);
});
