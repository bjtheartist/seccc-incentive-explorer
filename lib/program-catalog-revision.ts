/**
 * Server-only: SHA-256 hex digest of raw catalog bytes — mirrors
 * shortlistUniverseChecksum (lib/shortlist-universe-schema.ts).
 *
 * Lives apart from lib/program-public.ts deliberately: that module is
 * imported by client-reachable pages (FAQ via programFact), and a
 * node:crypto import there breaks the webpack client build (CI run
 * 31789392780's sibling). Only the export script and artifact checks
 * need the hash.
 */
import { createHash } from "node:crypto";

export function catalogRevisionFromRaw(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
