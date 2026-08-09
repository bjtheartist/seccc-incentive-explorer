import type {
  ChicagoZbaCase,
  ChicagoZbaLookupResponse,
  ChicagoZbaSourceMetadata,
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
  return `/api/zoning?lat=${lat}&lon=${lon}&v=4`;
}

export function zoningLookupKey(lat: number, lon: number): string {
  return `${lat.toFixed(6)}:${lon.toFixed(6)}`;
}

export function zoningUnavailable(
  message = "Published Chicago zoning data is temporarily unavailable.",
  zba?: ChicagoZbaLookupResponse,
): ZoningUnavailableResponse {
  return {
    status: "unavailable",
    zoneClass: null,
    zoneType: null,
    source: null,
    message,
    zba,
  };
}

function isChicagoZbaSourceMetadata(
  value: unknown,
): value is ChicagoZbaSourceMetadata {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return (
    source.id === "chicago-zba-arcgis" &&
    typeof source.label === "string" &&
    typeof source.url === "string" &&
    typeof source.boardUrl === "string" &&
    typeof source.retrievedAt === "string" &&
    source.sourceUpdatedAt === null &&
    typeof source.freshnessNote === "string"
  );
}

function isChicagoZbaCase(value: unknown): value is ChicagoZbaCase {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    (item.globalId === null || typeof item.globalId === "string") &&
    (item.caseReference === null || typeof item.caseReference === "string") &&
    (item.caseYear === null || typeof item.caseYear === "number") &&
    (item.caseSequence === null || typeof item.caseSequence === "number") &&
    ["special_use", "variation", "administrative_appeal", "unknown"].includes(
      String(item.caseType),
    ) &&
    (item.caseTypeRaw === null || typeof item.caseTypeRaw === "string") &&
    (item.address === null || typeof item.address === "string") &&
    (item.judgment === null || typeof item.judgment === "string") &&
    (item.description === null || typeof item.description === "string") &&
    (item.pin10 === null || typeof item.pin10 === "string") &&
    (item.pinAccuracy === null || typeof item.pinAccuracy === "string") &&
    (item.publishedYearField === null || typeof item.publishedYearField === "string") &&
    (item.publishedCaseField === null || typeof item.publishedCaseField === "string")
  );
}

function invalidChicagoZbaLookup(
  source?: ChicagoZbaSourceMetadata,
): ChicagoZbaLookupResponse {
  return {
    status: "unavailable",
    cases: [],
    source: source ?? {
      id: "chicago-zba-arcgis",
      label: "City of Chicago Zoning Board of Appeals case layer",
      url: "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning_update/MapServer/16",
      boardUrl:
        "https://www.chicago.gov/city/en/depts/dcd/zoning-board-of-appeals.html",
      retrievedAt: new Date().toISOString(),
      sourceUpdatedAt: null,
      freshnessNote:
        "The City layer does not publish a refresh timestamp. Retrieval time is not a source-update date.",
    },
    message: "The City Zoning Board of Appeals source returned an invalid response.",
  };
}

function normalizeChicagoZbaLookup(value: unknown): ChicagoZbaLookupResponse | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") return invalidChicagoZbaLookup();
  const candidate = value as Record<string, unknown>;
  const validSource = isChicagoZbaSourceMetadata(candidate.source)
    ? candidate.source
    : undefined;
  if (!validSource || !Array.isArray(candidate.cases)) {
    return invalidChicagoZbaLookup(validSource);
  }
  if (candidate.status === "unavailable" && typeof candidate.message === "string") {
    return {
      status: "unavailable",
      cases: [],
      source: validSource,
      message: candidate.message,
    };
  }
  if (
    candidate.status === "not_found" &&
    candidate.cases.length === 0 &&
    candidate.returnedCount === 0 &&
    candidate.coverage === "complete" &&
    typeof candidate.message === "string"
  ) {
    return candidate as unknown as ChicagoZbaLookupResponse;
  }
  if (
    candidate.status === "available" &&
    candidate.cases.every(isChicagoZbaCase) &&
    typeof candidate.returnedCount === "number" &&
    candidate.returnedCount === candidate.cases.length &&
    (candidate.coverage === "complete" || candidate.coverage === "partial") &&
    typeof candidate.message === "string"
  ) {
    return candidate as unknown as ChicagoZbaLookupResponse;
  }
  return invalidChicagoZbaLookup(validSource);
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
  const zba = normalizeChicagoZbaLookup(candidate.zba);
  if (
    candidate.status === "available" &&
    typeof candidate.zoneClass === "string" &&
    candidate.zoneClass.trim().length > 0 &&
    isZoningSourceMetadata(candidate.source)
  ) {
    return { ...candidate, zba } as unknown as ZoningLookupResponse;
  }
  if (
    candidate.status === "not_found" &&
    candidate.zoneClass === null &&
    isZoningSourceMetadata(candidate.source) &&
    typeof candidate.message === "string"
  ) {
    return { ...candidate, zba } as unknown as ZoningLookupResponse;
  }
  if (candidate.status === "unavailable") {
    return zoningUnavailable(
      typeof candidate.message === "string" ? candidate.message : undefined,
      zba,
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
    if (result.status !== "unavailable" && result.zba?.status !== "unavailable") {
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
