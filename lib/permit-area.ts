import { PERMIT_SINCE_DATE } from "./permit-match";
import type { PermitMapTypeKey } from "./permit-map";

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

    const body = (await response.json()) as Partial<PermitAreaResult>;
    if (
      body.status !== "ready" ||
      !body.sourceRefresh ||
      !(body.sourceRefresh.asOf === null || typeof body.sourceRefresh.asOf === "string") ||
      !(
        body.sourceRefresh.asOfBasis === null ||
        body.sourceRefresh.asOfBasis === "latest_queried_row_fetched_at"
      )
    ) {
      throw new Error("Permit area response was not ready");
    }
    return body as PermitAreaResult;
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
