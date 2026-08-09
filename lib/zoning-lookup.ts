import type {
  ChicagoZbaCase,
  ChicagoZbaLookupResponse,
  ChicagoZbaSourceMetadata,
  CityZoning,
  ZoningLookupResponse,
  ZoningSourceMetadata,
  ZoningUnavailableResponse,
  ZoningVintage,
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
  // v5 matches the server cache key. Both move together or a warm entry serves
  // a payload shaped for the previous contract.
  return `/api/zoning?lat=${lat}&lon=${lon}&v=5`;
}

export function zoningLookupKey(lat: number, lon: number): string {
  return `${lat.toFixed(6)}:${lon.toFixed(6)}`;
}

export function zoningUnavailable(
  message = "Published Chicago zoning data is temporarily unavailable.",
  zba?: ChicagoZbaLookupResponse,
  vintage?: ZoningVintage,
): ZoningUnavailableResponse {
  return {
    status: "unavailable",
    zoneClass: null,
    zoneType: null,
    source: null,
    ...(vintage ? { vintage } : {}),
    message,
    zba,
  };
}

const REQUIRED_MIRROR_IDS = [
  "chicago-arcgis-zoning",
  "chicago-data-portal-zoning",
] as const;

const QUERY_OUTCOMES = ["answered", "empty", "failed", "not_queried"];
const DATASET_OUTCOMES = [
  "published",
  "not_published",
  "unreachable",
  "not_waited",
];

/** A published timestamp must name its field and what it covers. */
function isZoningTimestamp(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const stamp = value as Record<string, unknown>;
  return (
    typeof stamp.field === "string" &&
    stamp.field.trim().length > 0 &&
    (stamp.scope === "record" || stamp.scope === "dataset") &&
    (stamp.updatedAt === null || typeof stamp.updatedAt === "string")
  );
}

function isZoningMirrorVintage(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry.id === "chicago-arcgis-zoning" ||
      entry.id === "chicago-data-portal-zoning") &&
    typeof entry.label === "string" &&
    QUERY_OUTCOMES.includes(String(entry.queryOutcome)) &&
    DATASET_OUTCOMES.includes(String(entry.datasetOutcome)) &&
    isZoningTimestamp(entry.record) &&
    isZoningTimestamp(entry.dataset) &&
    typeof entry.note === "string" &&
    // A record timestamp may only ride on a mirror that returned a record.
    (entry.record === null || entry.queryOutcome === "answered")
  );
}

/**
 * Accept a vintage block only when BOTH mirrors are described. A partial block
 * would let one mirror's silence read as the whole picture, and an empty
 * `mirrors` array satisfies `every()` vacuously — so presence of each required
 * id is checked explicitly rather than inferred from the entries that happen to
 * be there.
 */
function isZoningVintage(value: unknown): value is ZoningVintage {
  if (!value || typeof value !== "object") return false;
  const vintage = value as Record<string, unknown>;
  if (
    typeof vintage.retrievedAt !== "string" ||
    typeof vintage.comparabilityNote !== "string" ||
    !Array.isArray(vintage.mirrors)
  ) {
    return false;
  }
  if (
    vintage.answeredBy !== null &&
    vintage.answeredBy !== "chicago-arcgis-zoning" &&
    vintage.answeredBy !== "chicago-data-portal-zoning"
  ) {
    return false;
  }
  if (
    vintage.answerKind !== null &&
    vintage.answerKind !== "zoning" &&
    vintage.answerKind !== "no_zoning"
  ) {
    return false;
  }
  // Nobody answered, so nothing can have been established, and vice versa.
  if ((vintage.answeredBy === null) !== (vintage.answerKind === null)) {
    return false;
  }
  if (!vintage.mirrors.every(isZoningMirrorVintage)) return false;
  const presentIds = new Set(
    vintage.mirrors.map((mirror) => (mirror as Record<string, unknown>).id),
  );
  return REQUIRED_MIRROR_IDS.every((id) => presentIds.has(id));
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

/**
 * Carry a vintage block through only when it passes `isZoningVintage`, and drop
 * the key entirely otherwise. The available and not_found paths are the ones
 * that actually carry zoning data, so an unvalidated block is most dangerous
 * exactly there — a bare spread would publish whatever the server sent.
 */
function withValidatedVintage(
  candidate: Record<string, unknown>,
  zba: ChicagoZbaLookupResponse | undefined,
): ZoningLookupResponse {
  const { vintage, ...rest } = candidate;
  return {
    ...rest,
    ...(isZoningVintage(vintage) ? { vintage } : {}),
    zba,
  } as unknown as ZoningLookupResponse;
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
    return withValidatedVintage(candidate, zba);
  }
  if (
    candidate.status === "not_found" &&
    candidate.zoneClass === null &&
    isZoningSourceMetadata(candidate.source) &&
    typeof candidate.message === "string"
  ) {
    return withValidatedVintage(candidate, zba);
  }
  if (candidate.status === "unavailable") {
    return zoningUnavailable(
      typeof candidate.message === "string" ? candidate.message : undefined,
      zba,
      isZoningVintage(candidate.vintage) ? candidate.vintage : undefined,
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
