import { toDigitsOnlyPin } from "@/lib/ingest/pin-batch";
import { normalizeChicagoSourceCalendarDate } from "@/lib/vacancy-evidence";

export const COLS_DATASET_ID = "aksk-kvfp" as const;
export const COLS_API_URL =
  `https://data.cityofchicago.org/resource/${COLS_DATASET_ID}.json` as const;
export const COLS_LANDING_URL =
  `https://data.cityofchicago.org/Community-Economic-Development/City-Owned-Land-Inventory/${COLS_DATASET_ID}` as const;

/**
 * Anonymous published-inventory endpoint linked from CCLBA's current website.
 * The separate Tolemi publiCity API exposes only program-visible assets and is
 * not a complete public inventory source.
 */
export const CCLBA_PUBLIC_PORTAL_URL =
  "https://public-cclba.epropertyplus.com/" as const;
export const CCLBA_PUBLIC_API_URL =
  `${CCLBA_PUBLIC_PORTAL_URL}landmgmtpub/remote/public/property/getPublishedProperties` as const;
export const CCLBA_PUBLIC_DATASET_ID =
  "epropertyplus-published-properties" as const;
export const CCLBA_STABLE_SORT = [{ property: "id", direction: "asc" }] as const;

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function sourceUrlOrNull(value: unknown): string | null {
  const candidate = typeof value === "string"
    ? textOrNull(value)
    : value && typeof value === "object"
      ? textOrNull((value as { url?: unknown }).url)
      : null;
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? candidate
      : null;
  } catch {
    return null;
  }
}

function sourceCalendarDay(value: unknown): string | null {
  const normalized = normalizeChicagoSourceCalendarDate(value);
  if (normalized) return normalized;
  if (typeof value !== "string") return null;
  const compact = /^(\d{4})(\d{2})(\d{2})(?:\s|$)/.exec(value.trim());
  if (compact) {
    return normalizeChicagoSourceCalendarDate(
      `${compact[1]}-${compact[2]}-${compact[3]}`,
    );
  }
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, month, day, year] = match;
  return normalizeChicagoSourceCalendarDate(`${year}-${month}-${day}`);
}

function isChicagoPoint(lat: number, lon: number): boolean {
  return lat >= 41.6 && lat <= 42.1 && lon >= -88 && lon <= -87.4;
}

export interface ColsSourceRecord {
  id?: string;
  pin?: string;
  address?: string;
  dir?: string;
  street?: string;
  type?: string;
  property_name?: string;
  managing_organization?: string;
  property_status?: string;
  sales_status?: string;
  sale_offering_status?: string;
  sale_offering_reason?: string;
  application_use?: string;
  application_opens?: string;
  application_deadline?: string;
  offer_round?: string;
  application_url?: string | { url?: string };
  last_update?: string;
  ward?: string;
  community_area_name?: string;
  community_area_number?: string;
  zoning_classification?: string;
  sq_ft?: string;
  square_footage_city_estimate?: string;
  latitude?: string;
  longitude?: string;
}

export interface NormalizedColsInventoryRecord {
  /** Backward-compatible Explorer primary key; sourceRowId is the upstream ID. */
  id: string;
  sourceRowId: string | null;
  pin: string | null;
  pinDigits: string | null;
  address: string;
  lat: number;
  lon: number;
  ward: string | null;
  communityArea: string | null;
  zoningClass: string | null;
  squareFeet: number | null;
  managingOrganization: string | null;
  propertyStatus: string | null;
  salesStatus: string | null;
  saleOfferingStatus: string | null;
  saleOfferingReason: string | null;
  applicationUse: string | null;
  applicationOpens: string | null;
  applicationDeadline: string | null;
  offerRound: string | null;
  applicationUrl: string | null;
  programName: string | null;
  programKey: string | null;
  sourceAsOf: string | null;
  sourceRetrievedAt: string;
  sourceUrl: string;
}

function isChiBlockBuilderContext(values: readonly (string | null)[]): boolean {
  return values.some(
    (value) =>
      value !== null && /(?:\bcbb\b|chi\s*block\s*builder)/i.test(value),
  );
}

export function normalizeColsInventoryRecord(
  record: ColsSourceRecord,
  sourceRetrievedAt: string,
): NormalizedColsInventoryRecord | null {
  const lat = finiteNumberOrNull(record.latitude);
  const lon = finiteNumberOrNull(record.longitude);
  if (lat === null || lon === null || !isChicagoPoint(lat, lon)) return null;

  const pin = textOrNull(record.pin);
  const pinDigitsValue = toDigitsOnlyPin(pin ?? "");
  const sourceRowId = textOrNull(record.id);
  const address =
    textOrNull(record.address) ??
    textOrNull([record.dir, record.street, record.type].filter(Boolean).join(" ")) ??
    "Unknown";
  const managingOrganization = textOrNull(record.managing_organization);
  const propertyStatus = textOrNull(record.property_status);
  const salesStatus = textOrNull(record.sales_status);
  const saleOfferingStatus = textOrNull(record.sale_offering_status);
  const saleOfferingReason = textOrNull(record.sale_offering_reason);
  const applicationUse = textOrNull(record.application_use);
  const offerRound = textOrNull(record.offer_round);
  const applicationUrl = sourceUrlOrNull(record.application_url);
  const chiBlockBuilder = isChiBlockBuilderContext([
    managingOrganization,
    salesStatus,
    saleOfferingStatus,
    saleOfferingReason,
    offerRound,
    applicationUrl,
  ]);
  const cityEstimate = finiteNumberOrNull(record.square_footage_city_estimate);
  const publishedSquareFeet = finiteNumberOrNull(record.sq_ft);
  const squareFeet =
    cityEstimate !== null && cityEstimate > 0
      ? cityEstimate
      : publishedSquareFeet !== null && publishedSquareFeet > 0
        ? publishedSquareFeet
        : null;

  return {
    id: `cols-${pin ?? sourceRowId ?? `${lat.toFixed(6)}-${lon.toFixed(6)}`}`,
    sourceRowId,
    pin,
    pinDigits: pinDigitsValue.length === 14 ? pinDigitsValue : null,
    address,
    lat,
    lon,
    ward: textOrNull(record.ward),
    communityArea: textOrNull(record.community_area_name),
    zoningClass: textOrNull(record.zoning_classification),
    squareFeet,
    managingOrganization,
    propertyStatus,
    salesStatus,
    saleOfferingStatus,
    saleOfferingReason,
    applicationUse,
    applicationOpens: sourceCalendarDay(record.application_opens),
    applicationDeadline: sourceCalendarDay(record.application_deadline),
    offerRound,
    applicationUrl,
    programName: chiBlockBuilder ? "Chi Block Builder" : null,
    programKey: chiBlockBuilder ? "chi_block_builder" : null,
    sourceAsOf: sourceCalendarDay(record.last_update),
    sourceRetrievedAt,
    sourceUrl: sourceRowId
      ? `${COLS_API_URL}?id=${encodeURIComponent(sourceRowId)}`
      : COLS_LANDING_URL,
  };
}

export interface ColsOwnershipRecord {
  ownerName: string;
  mailingAddress: string;
  ownerType: string;
}

export type NormalizedColsSnapshotRecord = NormalizedColsInventoryRecord & {
  ownerName: string;
  ownerMailingAddress: string | null;
  ownerType: string;
  ownerJurisdiction: string | null;
};

function colsStillHeldByCity(propertyStatus: string | null): boolean {
  return propertyStatus?.trim().toLowerCase() === "owned by city";
}

/**
 * Managing organization is program/administrative context, never owner-of-record.
 * When a historical COLS row is sold and Assessor lookup is unavailable, owner is
 * deliberately unknown rather than falsely restored to City ownership.
 */
export function attachColsOwnership(
  records: readonly NormalizedColsInventoryRecord[],
  ownershipMap: ReadonlyMap<string, ColsOwnershipRecord>,
): NormalizedColsSnapshotRecord[] {
  return records.map((record) => {
    const ownership = record.pin ? ownershipMap.get(record.pin) : undefined;
    if (ownership?.ownerName.trim()) {
      const publicOwner = ownership.ownerType === "city_public";
      const cookCounty = /cook county|cclba|land bank/i.test(ownership.ownerName);
      const chicago = /city of chicago/i.test(ownership.ownerName);
      return {
        ...record,
        ownerName: ownership.ownerName,
        ownerMailingAddress: ownership.mailingAddress || null,
        ownerType: ownership.ownerType,
        ownerJurisdiction: publicOwner
          ? cookCounty
            ? "cook_county"
            : chicago
              ? "city_of_chicago"
              : "other_public"
          : null,
      };
    }
    if (colsStillHeldByCity(record.propertyStatus)) {
      return {
        ...record,
        ownerName: "City of Chicago",
        ownerMailingAddress: null,
        ownerType: "city_public",
        ownerJurisdiction: "city_of_chicago",
      };
    }
    return {
      ...record,
      ownerName: "Unknown",
      ownerMailingAddress: null,
      ownerType: "unknown",
      ownerJurisdiction: null,
    };
  });
}

export interface CclbaSourceAsset {
  id?: number | string;
  parcelNumber?: string;
  propertyAddress1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  currentStatus?: string;
  propertyClass?: string;
  inventoryType?: string;
  parcelSquareFootage?: number | null;
  structureSquareFootage?: number | null;
  structureType?: string | null;
  occupied?: string | null;
  askingPrice?: number | null;
  minimumBid?: number | null;
  neighborhood?: string | null;
  comments?: string | null;
}

export interface CclbaInventoryContext {
  sourceRowId: string;
  currentStatus: string | null;
  inventoryType: string | null;
  propertyClass: string | null;
  structureType: string | null;
  occupied: string | null;
  askingPrice: number | null;
  minimumBid: number | null;
  neighborhood: string | null;
  comments: string | null;
}

export interface NormalizedCclbaInventoryRecord {
  id: string;
  sourceRowId: string;
  pinDigits: string | null;
  address: string;
  lat: number;
  lon: number;
  propertyType: "vacant_land" | "vacant_building";
  squareFeet: number | null;
  /** Preserve the upstream public inventory status verbatim. */
  status: string;
  inventoryType: string | null;
  propertyClass: string | null;
  ownerName: "Cook County Land Bank Authority" | "Unknown";
  ownerType: "city_public" | "unknown";
  ownerJurisdiction: "cook_county" | null;
  programName: string | null;
  programKey: string | null;
  applicationOpens: string | null;
  applicationDeadline: string | null;
  applicationUrl: string | null;
  /** Upstream inventory context, retained through the existing JSONB seam. */
  programContext: CclbaInventoryContext[];
  sourceDatasetId: typeof CCLBA_PUBLIC_DATASET_ID;
  sourceUrl: typeof CCLBA_PUBLIC_PORTAL_URL;
  sourceAsOf: null;
  sourceRetrievedAt: string;
}

function cclbaSourceRowId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

function isChicagoCclbaAsset(asset: CclbaSourceAsset): boolean {
  return textOrNull(asset.city)?.toLowerCase() === "chicago";
}

function isLocatedCclbaAsset(asset: CclbaSourceAsset): boolean {
  const lat = finiteNumberOrNull(asset.latitude);
  const lon = finiteNumberOrNull(asset.longitude);
  return lat !== null && lon !== null && isChicagoPoint(lat, lon);
}

function cclbaStatusAssertsHeld(status: string | null): boolean {
  return status?.toLowerCase() === "acquired";
}

function cclbaPropertyType(
  propertyClass: string | null,
  inventoryType: string | null,
  structureType: string | null,
): "vacant_land" | "vacant_building" {
  if (propertyClass && /\bland\b/i.test(propertyClass)) return "vacant_land";
  if (inventoryType && /\bvacant\s+land\b/i.test(inventoryType)) {
    return "vacant_land";
  }
  return propertyClass || inventoryType || structureType
    ? "vacant_building"
    : "vacant_land";
}

export function normalizeCclbaInventoryAsset(
  asset: CclbaSourceAsset,
  sourceRetrievedAt: string,
): NormalizedCclbaInventoryRecord | null {
  const sourceRowId = cclbaSourceRowId(asset.id);
  const address = textOrNull(asset.propertyAddress1);
  const lat = finiteNumberOrNull(asset.latitude);
  const lon = finiteNumberOrNull(asset.longitude);
  if (
    !sourceRowId ||
    !address ||
    lat === null ||
    lon === null ||
    !isChicagoCclbaAsset(asset) ||
    !isChicagoPoint(lat, lon)
  ) {
    return null;
  }
  const pinDigitsValue = toDigitsOnlyPin(textOrNull(asset.parcelNumber) ?? "");
  const status = textOrNull(asset.currentStatus) ?? "Published inventory record";
  const inventoryType = textOrNull(asset.inventoryType);
  const propertyClass = textOrNull(asset.propertyClass);
  const structureType = textOrNull(asset.structureType);
  const held = cclbaStatusAssertsHeld(status);
  const parcelSquareFootage = finiteNumberOrNull(asset.parcelSquareFootage);
  const structureSquareFootage = finiteNumberOrNull(asset.structureSquareFootage);
  const context: CclbaInventoryContext = {
    sourceRowId,
    currentStatus: textOrNull(asset.currentStatus),
    inventoryType,
    propertyClass,
    structureType,
    occupied: textOrNull(asset.occupied),
    askingPrice: finiteNumberOrNull(asset.askingPrice),
    minimumBid: finiteNumberOrNull(asset.minimumBid),
    neighborhood: textOrNull(asset.neighborhood),
    comments: textOrNull(asset.comments),
  };

  return {
    id: `cclba-${sourceRowId}`,
    sourceRowId,
    pinDigits: pinDigitsValue.length === 14 ? pinDigitsValue : null,
    address,
    lat,
    lon,
    propertyType: cclbaPropertyType(propertyClass, inventoryType, structureType),
    squareFeet:
      parcelSquareFootage !== null && parcelSquareFootage > 0
        ? parcelSquareFootage
        : structureSquareFootage !== null && structureSquareFootage > 0
          ? structureSquareFootage
          : null,
    status,
    inventoryType,
    propertyClass,
    ownerName: held ? "Cook County Land Bank Authority" : "Unknown",
    ownerType: held ? "city_public" : "unknown",
    ownerJurisdiction: held ? "cook_county" : null,
    programName: null,
    programKey: null,
    applicationOpens: null,
    applicationDeadline: null,
    // The public portal is source provenance, not a row-specific program or
    // application link. Keep it in sourceUrl so downstream copy cannot call it
    // a published program record.
    applicationUrl: null,
    programContext: [context],
    sourceDatasetId: CCLBA_PUBLIC_DATASET_ID,
    sourceUrl: CCLBA_PUBLIC_PORTAL_URL,
    sourceAsOf: null,
    sourceRetrievedAt,
  };
}

export interface CclbaPublicInventorySnapshot {
  assets: CclbaSourceAsset[];
  expectedCount: number;
  chicagoCount: number;
  locatedChicagoCount: number;
  unlocatedChicagoCount: number;
  sourceAsOf: null;
  retrievedAt: string;
}

export interface FetchCclbaPublicInventoryOptions {
  fetchImpl?: typeof fetch;
  pageSize?: number;
  timeoutMs?: number;
  now?: () => Date;
}

export function buildCclbaPublicInventoryPageUrl(
  offset: number,
  limit: number,
): string {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    offset % limit !== 0
  ) {
    throw new Error("CCLBA page offset and limit must describe a complete page");
  }
  const url = new URL(CCLBA_PUBLIC_API_URL);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sEcho", "1");
  url.searchParams.set("iColumns", "1");
  url.searchParams.set("sColumns", "");
  url.searchParams.set("iDisplayStart", String(offset));
  url.searchParams.set("iDisplayLength", String(limit));
  url.searchParams.set("mDataProp_0", "parcelNumber");
  url.searchParams.set("page", String(offset / limit + 1));
  url.searchParams.set("json", JSON.stringify({ criterias: [] }));
  url.searchParams.set("customFields", JSON.stringify([]));
  url.searchParams.set("sort", JSON.stringify(CCLBA_STABLE_SORT));
  url.searchParams.set("favoriteProperties", "");
  return url.toString();
}

/** Retrieve one complete anonymous public-inventory snapshot or throw. */
export async function fetchCclbaPublicInventory(
  options: FetchCclbaPublicInventoryOptions = {},
): Promise<CclbaPublicInventorySnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pageSize = options.pageSize ?? 250;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new Error("CCLBA page size must be an integer from 1 to 1000");
  }
  const retrievedAt = (options.now?.() ?? new Date()).toISOString();
  let expectedCount: number | null = null;
  const assets: CclbaSourceAsset[] = [];
  for (let offset = 0; expectedCount === null || offset < expectedCount; offset += pageSize) {
    const response = await fetchImpl(
      buildCclbaPublicInventoryPageUrl(offset, pageSize),
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) {
      throw new Error(`CCLBA public inventory returned HTTP ${response.status}`);
    }
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") {
      throw new Error("CCLBA public inventory returned a non-object response");
    }
    const pageBody = value as Record<string, unknown>;
    if (pageBody.success !== true || !Array.isArray(pageBody.rows)) {
      throw new Error(`CCLBA public inventory returned a malformed page at offset ${offset}`);
    }
    const pageCount = Number(pageBody.size);
    if (!Number.isSafeInteger(pageCount) || pageCount < 0) {
      throw new Error("CCLBA public inventory returned an invalid asset count");
    }
    if (expectedCount === null) expectedCount = pageCount;
    if (pageCount !== expectedCount) {
      throw new Error(
        `CCLBA public inventory count changed during fetch: expected ${expectedCount}, received ${pageCount}`,
      );
    }
    const page = pageBody.rows as CclbaSourceAsset[];
    const expectedPageLength = Math.min(pageSize, expectedCount - offset);
    if (page.length !== expectedPageLength) {
      throw new Error(`CCLBA public inventory ended before count at offset ${offset}`);
    }
    assets.push(...page);
  }

  if (expectedCount === null) {
    throw new Error("CCLBA public inventory did not return a first page");
  }
  if (assets.length !== expectedCount) {
    throw new Error(
      `CCLBA public inventory count changed during fetch: expected ${expectedCount}, received ${assets.length}`,
    );
  }
  const ids = assets.map((asset) => cclbaSourceRowId(asset.id));
  const uniqueIds = new Set(ids);
  if (uniqueIds.has(null) || uniqueIds.size !== assets.length) {
    throw new Error("CCLBA public inventory returned missing or duplicate source IDs");
  }
  if (
    ids.some((id, index) =>
      index > 0 && Number(ids[index - 1]) >= Number(id),
    )
  ) {
    throw new Error("CCLBA public inventory did not honor stable source-ID order");
  }
  const chicagoAssets = assets.filter(isChicagoCclbaAsset);
  const locatedChicagoCount = chicagoAssets.filter(isLocatedCclbaAsset).length;
  return {
    assets,
    expectedCount,
    chicagoCount: chicagoAssets.length,
    locatedChicagoCount,
    unlocatedChicagoCount: chicagoAssets.length - locatedChicagoCount,
    sourceAsOf: null,
    retrievedAt,
  };
}
