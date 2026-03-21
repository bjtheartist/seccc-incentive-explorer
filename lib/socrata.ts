/**
 * Shared Socrata API utility.
 * Attaches optional X-App-Token header from SOCRATA_APP_TOKEN env var.
 * Free tokens give 10x the default rate limit.
 */

export function socrataHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
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
