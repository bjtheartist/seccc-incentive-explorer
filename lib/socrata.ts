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

export interface SocrataFetchOptions {
  /**
   * Opt this request into Next's Data Cache for N seconds
   * (`next: { revalidate: N }`). Unlike the per-instance in-memory caches
   * this repo uses elsewhere, the Data Cache is SHARED across serverless
   * instances, so a cold start does not re-pay a slow Socrata round trip.
   * Omit to keep the default (uncached) behavior every existing caller has.
   */
  revalidateSeconds?: number;
}

/**
 * Why a discriminated result exists here (R1 finding 4, the false-claims
 * class): a bare `null` cannot tell a caller whether the portal answered
 * "no rows" or never answered at all. Callers that could not tell rendered
 * an OUTAGE as an authoritative negative finding ("no annual finance row
 * was matched", "no rail stations nearby"). `socrataFetchResult` carries the
 * reason so a caller can render "temporarily unavailable" instead of a
 * false absence. Modelled on lib/shortlist-universe.ts's typed-failure
 * pattern, which is the house style for this.
 */
export type SocrataFailureReason =
  /** Upstream answered with a non-2xx status. */
  | "http_error"
  /** `AbortSignal.timeout` fired before a response arrived. */
  | "timeout"
  /** `fetch` itself rejected (DNS, TLS, connection reset). */
  | "network_error"
  /** A 2xx body that was not parseable JSON. */
  | "invalid_json";

export type SocrataResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: SocrataFailureReason; detail?: string };

/**
 * Fetch from a Socrata endpoint with app token and timeout, reporting the
 * failure MODE rather than collapsing every outcome to `null`. Never throws.
 */
export async function socrataFetchResult<T>(
  url: string,
  timeoutMs = 10000,
  options: SocrataFetchOptions = {},
): Promise<SocrataResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: socrataHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
      ...(options.revalidateSeconds != null
        ? { next: { revalidate: options.revalidateSeconds } }
        : {}),
    });
  } catch (err) {
    // `AbortSignal.timeout` rejects with a DOMException named TimeoutError;
    // everything else here is a genuine transport failure.
    const name = err instanceof Error ? err.name : "";
    const detail = err instanceof Error ? err.message : String(err);
    return name === "TimeoutError" || name === "AbortError"
      ? { ok: false, reason: "timeout", detail }
      : { ok: false, reason: "network_error", detail };
  }

  if (!res.ok) {
    return { ok: false, reason: "http_error", detail: `HTTP ${res.status}` };
  }

  try {
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return {
      ok: false,
      reason: "invalid_json",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Null-returning wrapper over `socrataFetchResult`, kept for callers that
 * genuinely cannot distinguish (and never publish an absence claim from) a
 * failed fetch. Prefer `socrataFetchResult` in anything that RENDERS a
 * finding — a caller that only sees `null` cannot be honest about an outage.
 * Returns parsed JSON or null on failure.
 */
export async function socrataFetch<T>(
  url: string,
  timeoutMs = 10000,
  options: SocrataFetchOptions = {},
): Promise<T | null> {
  const result = await socrataFetchResult<T>(url, timeoutMs, options);
  return result.ok ? result.data : null;
}
