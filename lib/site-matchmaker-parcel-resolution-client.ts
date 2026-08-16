"use client";

import {
  isChicagoParcelCoordinate,
  normalizedParcelStreetAddress,
  parseCandidateParcelResolution,
  resolvedParcelIdentityFromCandidate,
  type CandidateParcelResolution,
  type ParcelResolutionCandidate,
} from "./site-matchmaker-parcel-resolution";

const RESOLUTION_TTL_MS = 30 * 60 * 1000;
const MAX_RESOLUTION_CACHE_ENTRIES = 100;

type ResolvedResolution = Extract<CandidateParcelResolution, { status: "resolved" }>;
type CachedResolution = { value: ResolvedResolution; expiresAt: number };

const resolved = new Map<string, CachedResolution>();
const inFlight = new Map<string, Promise<CandidateParcelResolution>>();

function requestKey(buildId: string, candidate: ParcelResolutionCandidate): string {
  return [
    buildId.trim(),
    candidate.key,
    candidate.lat?.toFixed(6) ?? "",
    candidate.lon?.toFixed(6) ?? "",
    normalizedParcelStreetAddress(candidate.address),
  ].join("|");
}

function remember(key: string, value: ResolvedResolution): void {
  resolved.delete(key);
  resolved.set(key, { value, expiresAt: Date.now() + RESOLUTION_TTL_MS });
  while (resolved.size > MAX_RESOLUTION_CACHE_ENTRIES) {
    const oldest = resolved.keys().next().value as string | undefined;
    if (!oldest) break;
    resolved.delete(oldest);
  }
}

export function cachedCandidateParcelResolution(
  buildId: string,
  candidate: ParcelResolutionCandidate,
): ResolvedResolution | null {
  // A PIN already known at load short-circuits the network entirely — but it
  // is reported with ITS OWN provenance: a precomputed exact-intersection
  // match is never labeled as a saved-snapshot publication.
  const known = resolvedParcelIdentityFromCandidate(candidate);
  if (known) return known;
  const key = requestKey(buildId, candidate);
  const cached = resolved.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    resolved.delete(key);
    return null;
  }
  return cached.value;
}

/** Resolve only the selected candidate. Successful exact matches are cached; every failure stays retryable. */
export function resolveCandidateParcelIdentity(
  buildId: string,
  candidate: ParcelResolutionCandidate,
): Promise<CandidateParcelResolution> {
  const known = resolvedParcelIdentityFromCandidate(candidate);
  if (known) return Promise.resolve(known);
  if (
    !buildId.trim() ||
    !candidate.key ||
    !isChicagoParcelCoordinate(candidate.lat, candidate.lon) ||
    normalizedParcelStreetAddress(candidate.address).length < 6
  ) {
    return Promise.resolve({ status: "no_match", reason: "invalid_location", checkedAt: null });
  }

  const key = requestKey(buildId, candidate);
  const cached = cachedCandidateParcelResolution(buildId, candidate);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const search = new URLSearchParams({
    lat: candidate.lat!.toFixed(6),
    lon: candidate.lon!.toFixed(6),
    address: candidate.address ?? "",
  });
  const request = fetch(`/api/shortlist/resolve-parcel?${search.toString()}`, {
    cache: "no-store",
  })
    .then(async (response): Promise<CandidateParcelResolution> => {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { status: "malformed" };
      }
      const parsed = parseCandidateParcelResolution(payload);
      if (!parsed) return { status: "malformed" };
      // The dedicated route deliberately uses distinct non-2xx statuses for
      // honest terminal outcomes (404 no exact match, 409 ambiguous, 502
      // malformed, 503 unavailable). Preserve that parsed state; only reject
      // the impossible case where a non-OK response claims a successful PIN.
      if (!response.ok && parsed.status === "resolved") return { status: "unavailable" };
      if (parsed.status === "resolved") remember(key, parsed);
      return parsed;
    })
    .catch((): CandidateParcelResolution => ({ status: "unavailable" }))
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

export function clearCandidateParcelResolutionCacheForTests(): void {
  resolved.clear();
  inFlight.clear();
}
