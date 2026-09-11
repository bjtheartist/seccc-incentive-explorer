import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
// Local workspace uses an isolated branch. No credentials are printed or copied.
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
process.env.BRANCH_DATABASE_URL = process.env.DATABASE_URL;
await import("../grants-db/load_neon.mjs");
