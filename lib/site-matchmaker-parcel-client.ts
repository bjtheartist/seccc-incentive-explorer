"use client";

import { normalizePin14 } from "./cook-viewer";
import {
  parseCandidateParcelEnrichmentResponse,
  type CandidateParcelEnrichmentState,
} from "./site-matchmaker-results";

type CheckedParcelEnrichment = Extract<CandidateParcelEnrichmentState, { status: "checked" }>;

const resolved = new Map<string, CheckedParcelEnrichment>();
const inFlight = new Map<string, Promise<CandidateParcelEnrichmentState>>();

function requestKey(buildId: string, pin14: string): string {
  return `${buildId}|${pin14}`;
}

/** Synchronous state for a parcel already resolved in this browser session. */
export function cachedCandidateParcelEnrichment(
  buildId: string,
  pin: unknown,
): CheckedParcelEnrichment | null {
  const pin14 = normalizePin14(pin);
  if (!buildId.trim() || pin14 === null) return null;
  return resolved.get(requestKey(buildId, pin14)) ?? null;
}

/**
 * Check exactly one normalized PIN. Concurrent table/popup requests share one
 * browser promise; successful results share one cache entry. Failed or partial
 * source checks are not retained, so an explicit later retry can recover.
 */
export function fetchCandidateParcelEnrichment(
  buildId: string,
  pin: unknown,
): Promise<CandidateParcelEnrichmentState> {
  const pin14 = normalizePin14(pin);
  const trimmedBuildId = buildId.trim();
  if (!trimmedBuildId || pin14 === null) {
    return Promise.resolve({ status: "not_requested" });
  }

  const key = requestKey(trimmedBuildId, pin14);
  const cached = resolved.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = fetch("/api/shortlist/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      buildId: trimmedBuildId,
      items: [{ key: pin14, pin: pin14, address: null }],
    }),
  })
    .then(async (response): Promise<CandidateParcelEnrichmentState> => {
      if (!response.ok) return { status: "unavailable" };
      const payload: unknown = await response.json();
      const parsed = parseCandidateParcelEnrichmentResponse(payload, pin14);
      if (parsed === null) return { status: "unavailable" };
      if (!parsed.sourceUnavailable) resolved.set(key, parsed);
      return parsed;
    })
    .catch((): CandidateParcelEnrichmentState => ({ status: "unavailable" }))
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

/** Test-only reset; deliberately not called by product code. */
export function clearCandidateParcelEnrichmentCacheForTests(): void {
  resolved.clear();
  inFlight.clear();
}
