/**
 * Honest failure copy for report generation and address lookup (R1 finding 1).
 *
 * WHY THIS EXISTS. Every `generateReportRemote` call site in
 * app/report/page.tsx used to catch its error with `console.error` +
 * `trackEvent` and nothing else — one of them says so out loud: "Stay on
 * loading". The reader was left on an animated spinner that would never
 * resolve, with no statement that anything had gone wrong and no way to try
 * again. These strings are the honest replacement, kept in one module so a
 * test can pin the shipped copy rather than a test-local duplicate.
 *
 * Voice: the Warm Bureau register the app already uses for its unavailable
 * states (app/vacancy/[zip]/shortlist/page.tsx's UnavailableState). Rules:
 *   - Say plainly that WE failed. Never imply the reader did something wrong.
 *   - Never dress a failure as a finding, and never make it eligibility-shaped.
 *   - Always leave a working way forward.
 */

/** Which generation path failed. Each has its own copy and its own retry. */
export type ReportGenerationFailureSource =
  | "instant"
  | "corridor"
  | "shared_report"
  | "wizard"
  | "comparison";

export interface ReportGenerationFailureCopy {
  /** Small uppercase eyebrow. */
  eyebrow: string;
  /** The headline. */
  heading: string;
  /** One or two plain sentences saying what happened and what survives. */
  body: string;
  /** Label for the retry control, which re-runs the SAME generation path. */
  retryLabel: string;
}

export const REPORT_GENERATION_FAILURE_COPY: Record<
  ReportGenerationFailureSource,
  ReportGenerationFailureCopy
> = {
  instant: {
    eyebrow: "Report not generated",
    heading: "We couldn't generate your report",
    body:
      "Something failed on our side while building this location snapshot. Your address is still here and nothing you entered was lost — trying again usually works.",
    retryLabel: "Try again",
  },
  corridor: {
    eyebrow: "Report not generated",
    heading: "We couldn't generate your report",
    body:
      "Something failed on our side while building this corridor intelligence report. The area you asked about is still here — trying again usually works.",
    retryLabel: "Try again",
  },
  shared_report: {
    eyebrow: "Report not generated",
    heading: "We couldn't open this shared report",
    body:
      "Something failed on our side while rebuilding the report behind this link. The link itself is fine — trying again usually works.",
    retryLabel: "Try again",
  },
  wizard: {
    eyebrow: "Report not generated",
    heading: "We couldn't generate your report",
    body:
      "Something failed on our side after you hit generate. Every answer you gave is still filled in below — nothing needs re-entering. Try again.",
    retryLabel: "Generate again",
  },
  comparison: {
    eyebrow: "Comparison not generated",
    heading: "We couldn't generate the comparison",
    body:
      "Your own report is unaffected and still on screen. The second address could not be built into a comparable report just then.",
    retryLabel: "Try the comparison again",
  },
};

// ── Address lookup ──────────────────────────────────────────────────────────

/**
 * R1 finding 1, second half. `/api/geocode` failing was indistinguishable
 * from an address it genuinely could not find, so BOTH rendered "Could not
 * find that address. Please try a more specific Chicago address." — blaming
 * the reader's typing for our own outage. The route now answers 404
 * `not_found` vs 503 `unavailable`, and these are the two messages.
 */
export const GEOCODE_NOT_FOUND_MESSAGE =
  "Could not find that address. Please try a more specific Chicago address.";

export const GEOCODE_SERVICE_UNAVAILABLE_MESSAGE =
  "The address service is temporarily unavailable — try again in a moment. This is on our side, not your address.";

/**
 * Recover the upstream HTTP status from a `cachedFetch` rejection.
 *
 * `lib/fetch-cache.ts` reports a non-2xx only as `Fetch failed: <status>
 * <statusText>` and is owned by a parallel branch, so it cannot be widened to
 * carry a structured status. Returns `null` when no status is present — which
 * is itself meaningful: a transport failure (offline, DNS, connection reset)
 * never got a status at all, and that is a service failure, not a not-found.
 */
export function httpStatusFromFetchError(err: unknown): number | null {
  const message = err instanceof Error ? err.message : String(err);
  const match = /Fetch failed:\s*(\d{3})\b/.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * Pick the honest message for a failed address lookup. Only a status the
 * service actually returned as a client-side "we looked and found nothing"
 * (404, or a 400 rejecting the query) may blame the address; everything
 * else — 5xx, a timeout, no status at all — is our outage.
 */
export function geocodeFailureMessage(err: unknown): string {
  const status = httpStatusFromFetchError(err);
  if (status === 404 || status === 400) return GEOCODE_NOT_FOUND_MESSAGE;
  return GEOCODE_SERVICE_UNAVAILABLE_MESSAGE;
}
