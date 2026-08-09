import type {
  CityZoning,
  ZoningLookupResponse,
  ZoningSourceMetadata,
  ZoningUnavailableResponse,
} from "./types";

const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;

interface ZoningCacheEntry {
  value: Exclude<ZoningLookupResponse, ZoningUnavailableResponse>;
  cachedAt: number;
}

interface FetchZoningLookupOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

const zoningCache = new Map<string, ZoningCacheEntry>();

export function zoningApiUrl(lat: number, lon: number): string {
  return `/api/zoning?lat=${lat}&lon=${lon}&v=3`;
}

export function zoningLookupKey(lat: number, lon: number): string {
  return `${lat.toFixed(6)}:${lon.toFixed(6)}`;
}

export function zoningUnavailable(
  message = "Published Chicago zoning data is temporarily unavailable.",
): ZoningUnavailableResponse {
  return {
    status: "unavailable",
    zoneClass: null,
    zoneType: null,
    source: null,
    message,
  };
}

function isZoningSourceMetadata(value: unknown): value is ZoningSourceMetadata {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return (
    (source.id === "chicago-arcgis-zoning" ||
      source.id === "chicago-data-portal-zoning") &&
    typeof source.label === "string" &&
    source.label.trim().length > 0 &&
    typeof source.url === "string" &&
    source.url.trim().length > 0 &&
    typeof source.retrievedAt === "string" &&
    source.retrievedAt.trim().length > 0 &&
    (source.recordUpdatedAt === null ||
      typeof source.recordUpdatedAt === "string")
  );
}

export function normalizeZoningLookup(value: unknown): ZoningLookupResponse {
  if (!value || typeof value !== "object") return zoningUnavailable();

  const candidate = value as Record<string, unknown>;
  if (
    candidate.status === "available" &&
    typeof candidate.zoneClass === "string" &&
    candidate.zoneClass.trim().length > 0 &&
    isZoningSourceMetadata(candidate.source)
  ) {
    return candidate as unknown as ZoningLookupResponse;
  }
  if (
    candidate.status === "not_found" &&
    candidate.zoneClass === null &&
    isZoningSourceMetadata(candidate.source) &&
    typeof candidate.message === "string"
  ) {
    return candidate as unknown as ZoningLookupResponse;
  }
  if (candidate.status === "unavailable") {
    return zoningUnavailable(
      typeof candidate.message === "string" ? candidate.message : undefined,
    );
  }

  return zoningUnavailable("The zoning service returned an invalid response.");
}

export function clearZoningLookupCache(): void {
  zoningCache.clear();
}

export async function fetchZoningLookup(
  lat: number,
  lon: number,
  options: FetchZoningLookupOptions = {},
): Promise<ZoningLookupResponse> {
  const url = zoningApiUrl(lat, lon);
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const existing = zoningCache.get(url);
  if (existing && Date.now() - existing.cachedAt < cacheTtlMs) {
    return existing.value;
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, { signal: controller.signal });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return zoningUnavailable("The zoning service returned an invalid response.");
    }

    const result = normalizeZoningLookup(payload);
    if (!response.ok && result.status !== "unavailable") {
      return zoningUnavailable();
    }
    if (result.status !== "unavailable") {
      zoningCache.set(url, { value: result, cachedAt: Date.now() });
    }
    return result;
  } catch {
    return zoningUnavailable();
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export function cityZoningFromLookup(
  lookup: ZoningLookupResponse,
): CityZoning | undefined {
  return lookup.status === "available" ? lookup : undefined;
}
