import { PERMIT_SINCE_DATE } from "./permit-match";
import { PERMIT_MAP_TYPES, type PermitMapTypeKey } from "./permit-map";

export const PERMIT_AREA_HEADING = "Permit filings in this area";
export const PERMIT_AREA_SOURCE_LABEL =
  "City of Chicago Building Permits (ydr8-5enu)";
export const PERMIT_AREA_SOURCE_URL =
  "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu/about_data";
export const PERMIT_AREA_PORTAL_URL =
  "https://webapps1.chicago.gov/buildingrecords/";
export const PERMIT_AREA_DATA_WINDOW_LABEL = `Since ${PERMIT_SINCE_DATE.slice(0, 4)}`;
export const PERMIT_AREA_RECORD_LIMIT = 250;
export const PERMIT_AREA_REQUEST_TIMEOUT_MS = 15_000;

export const PERMIT_AREA_ACTIVITY_NOTE =
  "Permit records show filing activity, not that construction started or finished.";
export const PERMIT_AREA_COVERAGE_NOTE =
  `Drawn-area results include geocoded City building-permit filings issued since ${PERMIT_SINCE_DATE.slice(0, 4)}. ` +
  "Records without a map location cannot be assigned to the shape.";

export interface PermitAreaTypeCount {
  key: PermitMapTypeKey | null;
  label: string;
  sourceValue: string | null;
  color: string;
  count: number;
}

export interface PermitAreaYearCount {
  year: number;
  count: number;
}

export interface PermitAreaStatusCount {
  status: string;
  count: number;
}

export interface PermitAreaRecord {
  permitId: string;
  permitTypeKey: PermitMapTypeKey | null;
  permitTypeLabel: string;
  rawPermitType: string | null;
  address: string | null;
  issueDate: string | null;
  permitStatus: string | null;
  permitMilestone: string | null;
  workType: string | null;
  workDescription: string | null;
}

export interface PermitAreaResult {
  status: "ready";
  source: {
    label: string;
    url: string;
    portalUrl: string;
  };
  dataWindow: string;
  sourceRefresh: {
    asOf: string | null;
    asOfBasis: "latest_queried_row_fetched_at" | null;
  };
  locatedRecordsOnly: true;
  totalFilings: number;
  distinctAddresses: number;
  issueDateSpan: {
    first: string;
    latest: string;
  } | null;
  typeBreakdown: PermitAreaTypeCount[];
  yearBreakdown: PermitAreaYearCount[];
  statusBreakdown: PermitAreaStatusCount[];
  records: PermitAreaRecord[];
  recordsReturned: number;
  recordsTruncated: boolean;
}

export interface PermitAreaFetchOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const PERMIT_MAP_TYPE_KEYS = new Set<string>(PERMIT_MAP_TYPES.map((type) => type.key));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPermitMapTypeKey(value: unknown): value is PermitMapTypeKey | null {
  return value === null || (typeof value === "string" && PERMIT_MAP_TYPE_KEYS.has(value));
}

function isPermitAreaTypeCount(value: unknown): value is PermitAreaTypeCount {
  if (!isRecord(value)) return false;
  return (
    isPermitMapTypeKey(value.key) &&
    isString(value.label) &&
    isNullableString(value.sourceValue) &&
    isString(value.color) &&
    isNonnegativeInteger(value.count)
  );
}

function isPermitAreaYearCount(value: unknown): value is PermitAreaYearCount {
  if (!isRecord(value)) return false;
  return (
    typeof value.year === "number" &&
    Number.isInteger(value.year) &&
    value.year > 0 &&
    isNonnegativeInteger(value.count)
  );
}

function isPermitAreaStatusCount(value: unknown): value is PermitAreaStatusCount {
  return (
    isRecord(value) &&
    isString(value.status) &&
    isNonnegativeInteger(value.count)
  );
}

function isPermitAreaRecord(value: unknown): value is PermitAreaRecord {
  if (!isRecord(value)) return false;
  return (
    isString(value.permitId) &&
    isPermitMapTypeKey(value.permitTypeKey) &&
    isString(value.permitTypeLabel) &&
    isNullableString(value.rawPermitType) &&
    isNullableString(value.address) &&
    isNullableString(value.issueDate) &&
    isNullableString(value.permitStatus) &&
    isNullableString(value.permitMilestone) &&
    isNullableString(value.workType) &&
    isNullableString(value.workDescription)
  );
}

/** Reject a partial or malformed 200 response before any panel or CSV sees it. */
export function parsePermitAreaResult(value: unknown): PermitAreaResult | null {
  if (!isRecord(value) || value.status !== "ready") return null;
  if (!isRecord(value.source) || !isRecord(value.sourceRefresh)) return null;

  const source = value.source;
  const sourceRefresh = value.sourceRefresh;
  const issueDateSpan = value.issueDateSpan;
  const validIssueDateSpan =
    issueDateSpan === null ||
    (isRecord(issueDateSpan) &&
      isString(issueDateSpan.first) &&
      isString(issueDateSpan.latest));

  if (
    !isString(source.label) ||
    !isString(source.url) ||
    !isString(source.portalUrl) ||
    !isString(value.dataWindow) ||
    !isNullableString(sourceRefresh.asOf) ||
    !(
      sourceRefresh.asOfBasis === null ||
      sourceRefresh.asOfBasis === "latest_queried_row_fetched_at"
    ) ||
    value.locatedRecordsOnly !== true ||
    !isNonnegativeInteger(value.totalFilings) ||
    !isNonnegativeInteger(value.distinctAddresses) ||
    !validIssueDateSpan ||
    !Array.isArray(value.typeBreakdown) ||
    !value.typeBreakdown.every(isPermitAreaTypeCount) ||
    !Array.isArray(value.yearBreakdown) ||
    !value.yearBreakdown.every(isPermitAreaYearCount) ||
    !Array.isArray(value.statusBreakdown) ||
    !value.statusBreakdown.every(isPermitAreaStatusCount) ||
    !Array.isArray(value.records) ||
    !value.records.every(isPermitAreaRecord) ||
    !isNonnegativeInteger(value.recordsReturned) ||
    value.recordsReturned !== value.records.length ||
    typeof value.recordsTruncated !== "boolean"
  ) {
    return null;
  }

  return value as unknown as PermitAreaResult;
}

export function permitAreaRequestPath(polygon: GeoJSON.Polygon): string {
  const params = new URLSearchParams({ polygon: JSON.stringify(polygon) });
  return `/api/permit-area?${params.toString()}`;
}

export async function fetchPermitArea(
  polygon: GeoJSON.Polygon,
  options: PermitAreaFetchOptions = {},
): Promise<PermitAreaResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const relayAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    relayAbort();
  } else {
    options.signal?.addEventListener("abort", relayAbort, { once: true });
  }
  const timeoutId = setTimeout(
    () => controller.abort(new DOMException("Permit area request timed out", "TimeoutError")),
    options.timeoutMs ?? PERMIT_AREA_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetchImpl(permitAreaRequestPath(polygon), {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Permit area request failed with HTTP ${response.status}`);
    }

    const body: unknown = await response.json();
    const result = parsePermitAreaResult(body);
    if (!result) {
      throw new Error("Permit area response was not ready");
    }
    return result;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", relayAbort);
  }
}

export function formatPermitAreaDate(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatPermitAreaCoverageLabel(
  permitArea: Pick<PermitAreaResult, "dataWindow" | "sourceRefresh">,
): string {
  const refreshedAt = permitArea.sourceRefresh.asOf;
  return refreshedAt
    ? `${permitArea.dataWindow}; database updated ${formatPermitAreaDate(refreshedAt)}`
    : `${permitArea.dataWindow}; database update date unavailable`;
}
