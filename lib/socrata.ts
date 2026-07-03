/**
 * Shared Socrata API utility.
 * Prefers an API key pair (SOCRATA_KEY_ID + SOCRATA_KEY_SECRET, sent as HTTP
 * Basic auth) and falls back to an app token (SOCRATA_APP_TOKEN, sent as
 * X-App-Token). Either lifts requests out of the shared anonymous rate-limit
 * pool; un-tokened county-portal queries run 30s+ per page vs sub-second.
 */

export function socrataHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const keyId = process.env.SOCRATA_KEY_ID;
  const keySecret = process.env.SOCRATA_KEY_SECRET;
  if (keyId && keySecret) {
    headers.Authorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
    return headers;
  }
  const token = process.env.SOCRATA_APP_TOKEN;
  if (token) {
    headers["X-App-Token"] = token;
  }
  return headers;
}

/**
 * Fetch from a Socrata endpoint with app token and timeout.
 * Returns parsed JSON or null on failure.
 */
export async function socrataFetch<T>(
  url: string,
  timeoutMs = 10000
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: socrataHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
