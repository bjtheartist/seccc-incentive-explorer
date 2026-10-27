import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for a request-supplied secret (bearer token, admin
 * key) against the configured one. Hashing both sides first makes the
 * buffers equal-length, so neither the content nor the length of the
 * expected secret leaks through response timing. Same approach as
 * safeEqual in lib/analytics-admin-auth.ts.
 */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
