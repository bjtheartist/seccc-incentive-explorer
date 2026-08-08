import { PERMIT_SINCE_DATE } from "./permit-match";
import type { PermitMapTypeKey } from "./permit-map";

export const PERMIT_AREA_HEADING = "Permit filings in this area";
export const PERMIT_AREA_SOURCE_LABEL =
  "City of Chicago Building Permits (ydr8-5enu)";
export const PERMIT_AREA_SOURCE_URL =
  "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu/about_data";
export const PERMIT_AREA_PORTAL_URL =
  "https://webapps1.chicago.gov/buildingrecords/";
export const PERMIT_AREA_DATA_WINDOW_LABEL = `${PERMIT_SINCE_DATE.slice(0, 4)}-present`;
export const PERMIT_AREA_RECORD_LIMIT = 250;

export const PERMIT_AREA_ACTIVITY_NOTE =
  "Permit records show filing activity, not that construction started or finished.";
export const PERMIT_AREA_COVERAGE_NOTE =
  `Drawn-area results include geocoded City building-permit filings issued ${PERMIT_AREA_DATA_WINDOW_LABEL}. ` +
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

export function permitAreaRequestPath(polygon: GeoJSON.Polygon): string {
  const params = new URLSearchParams({ polygon: JSON.stringify(polygon) });
  return `/api/permit-area?${params.toString()}`;
}

export async function fetchPermitArea(
  polygon: GeoJSON.Polygon,
  fetchImpl: typeof fetch = fetch,
): Promise<PermitAreaResult> {
  const response = await fetchImpl(permitAreaRequestPath(polygon));
  if (!response.ok) {
    throw new Error(`Permit area request failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as Partial<PermitAreaResult>;
  if (body.status !== "ready") {
    throw new Error("Permit area response was not ready");
  }
  return body as PermitAreaResult;
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

