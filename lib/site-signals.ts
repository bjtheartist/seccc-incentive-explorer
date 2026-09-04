import * as turf from "@turf/turf";
import type { FeatureCollection, Feature, Point } from "geojson";

/**
 * Site signals — proximity intelligence from point-data layers. These are
 * discovery and due-diligence context, not eligibility determinations.
 */

/**
 * One traceable public record behind a nearby-record count. The counts alone
 * ("1 open tank-leak record within 1/4 mi") are not back-traceable; these
 * carry the identifier and the agency source a reader needs to look the
 * record up themselves.
 */
export interface SiteSignalRecord {
  /** Stable id built from the record's own public identifier where one exists. */
  id: string;
  name: string;
  address: string | null;
  miles: number;
  /** Short, already-formatted lines: identifiers, status, dates, class. */
  facts: string[];
  /** The agency/dataset the record comes from. */
  sourceLabel: string;
  /**
   * Where a reader can look this record up. A confirmed per-record deep link
   * where the agency publishes one (Cook County Assessor PIN page, EPA FRS
   * facility page); otherwise the agency's own lookup/dataset page, with the
   * identifier carried in `facts` so the reader can find the row. Never a
   * guessed deep-link pattern.
   */
  sourceUrl: string | null;
}

/** A capped, distance-sorted list of records plus how many were dropped. */
export interface SiteSignalRecordGroup {
  records: SiteSignalRecord[];
  /** Records inside the threshold that did not fit under the cap. */
  truncated: number;
}

export interface SiteSignalRecords {
  openLust: SiteSignalRecordGroup;
  nofAwards: SiteSignalRecordGroup;
  incentiveParcels: SiteSignalRecordGroup;
  brownfields: SiteSignalRecordGroup;
}

export interface SiteSignals {
  /** Nearest EPA ACRES brownfield site. */
  brownfield: { name: string; miles: number } | null;
  /** Open leaking-UST incidents within a quarter mile. */
  openLustNearby: number;
  /** Nearest open leaking-UST incident. */
  nearestOpenLust: { name: string; miles: number } | null;
  /** NOF grants awarded within a half mile. */
  nofAwardsNearby: number;
  /** Cook County incentive-classified parcels within a quarter mile. */
  incentiveParcelsNearby: number;
  /** Nearest county incentive parcel and its classification. */
  nearestIncentiveParcel: { name: string; miles: number } | null;
  /**
   * The individual records behind the counts above, so a reader can back-trace
   * a signal to its source record. Optional because `SiteSignals` is persisted
   * inside saved-report jsonb: snapshots written before this field existed
   * deserialize without it, and every reader must tolerate that.
   */
  records?: SiteSignalRecords;
}

const SIGNAL_FILES = {
  brownfields: "/data/zones/brownfield-sites.geojson",
  lust: "/data/zones/lust-sites.geojson",
  nofProjects: "/data/zones/nof-funded-projects.geojson",
  countyParcels: "/data/zones/county-incentive-parcels.geojson",
} as const;

/**
 * Illinois EPA's Leaking UST incident lookup. Verified 2026-09-04: the page is
 * a DataTables app served from webapps.illinois.gov's LustIncidentTracking API
 * and accepts NO incident query parameter, so there is no per-incident deep
 * link to link to. The incident number travels in the record's facts instead.
 */
const IEPA_LUST_LOOKUP_URL =
  "https://epa.illinois.gov/topics/cleanup-programs/bol-database/leaking-ust.html";

/**
 * City of Chicago data portal NOF completion datasets (dataset ids from
 * scripts/refresh/refresh-live-sources.ts and
 * data/curated/investment-inputs/manifest.json). Verified 2026-09-04. Socrata
 * does not publish a stable per-row permalink for these views, so we link to
 * the dataset page and carry the project name and approval date in the facts.
 */
const NOF_DATASET_URLS = {
  large: "https://data.cityofchicago.org/d/j7ew-b73u",
  small: "https://data.cityofchicago.org/d/rym7-49n8",
} as const;

/** Max records kept per signal type; the rest are reported as `truncated`. */
export const SITE_SIGNAL_RECORD_CAP = 12;

const cache = new Map<string, Promise<FeatureCollection | null>>();

function loadLayer(url: string): Promise<FeatureCollection | null> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    cache.set(url, pending);
  }
  return pending;
}

interface Nearest {
  name: string;
  miles: number;
}

function scan(
  fc: FeatureCollection | null,
  lon: number,
  lat: number,
  withinMiles: number,
  filter?: (props: Record<string, unknown>) => boolean
): { nearest: Nearest | null; withinCount: number } {
  if (!fc?.features?.length) return { nearest: null, withinCount: 0 };

  const from = turf.point([lon, lat]);
  let nearest: Nearest | null = null;
  let withinCount = 0;

  for (const feature of fc.features) {
    if (feature.geometry?.type !== "Point") continue;
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    if (filter && !filter(props)) continue;

    const miles = turf.distance(from, turf.point(feature.geometry.coordinates), {
      units: "miles",
    });
    if (miles <= withinMiles) withinCount += 1;
    if (!nearest || miles < nearest.miles) {
      nearest = { name: String(props.name ?? ""), miles };
    }
  }

  return { nearest, withinCount };
}

const EMPTY_GROUP: SiteSignalRecordGroup = { records: [], truncated: 0 };

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dollars(value: unknown): string | null {
  const amount = typeof value === "number" ? value : Number(text(value) ?? NaN);
  if (!Number.isFinite(amount)) return null;
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/**
 * Distance-sorted, threshold-filtered, capped record list for one layer.
 * `toRecord` returns everything but `miles`, which is measured here.
 */
function collectRecords(
  fc: FeatureCollection | null,
  lon: number,
  lat: number,
  withinMiles: number,
  toRecord: (props: Record<string, unknown>, index: number) => Omit<SiteSignalRecord, "miles">,
  filter?: (props: Record<string, unknown>) => boolean
): SiteSignalRecordGroup {
  if (!fc?.features?.length) return { records: [], truncated: 0 };

  const from = turf.point([lon, lat]);
  const matched: SiteSignalRecord[] = [];

  fc.features.forEach((feature: Feature, index: number) => {
    if (feature.geometry?.type !== "Point") return;
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    if (filter && !filter(props)) return;

    const miles = turf.distance(from, turf.point((feature.geometry as Point).coordinates), {
      units: "miles",
    });
    if (miles > withinMiles) return;

    matched.push({ ...toRecord(props, index), miles });
  });

  matched.sort((a, b) => a.miles - b.miles);

  return {
    records: matched.slice(0, SITE_SIGNAL_RECORD_CAP),
    truncated: Math.max(0, matched.length - SITE_SIGNAL_RECORD_CAP),
  };
}

function lustRecord(props: Record<string, unknown>, index: number): Omit<SiteSignalRecord, "miles"> {
  const incident = text(props.incident);
  const status = text(props.status);
  const nfrDate = text(props.nfrDate);

  return {
    id: incident ? `lust-${incident}` : `lust-${index}`,
    name: text(props.name) ?? "Unnamed leaking-UST incident",
    address: text(props.address),
    facts: [
      incident ? `Incident no. ${incident}` : null,
      status ? `Status: ${status}` : null,
      nfrDate ? `No Further Remediation letter: ${nfrDate}` : null,
    ].filter((line): line is string => Boolean(line)),
    sourceLabel: "Illinois EPA leaking-UST incident lookup",
    sourceUrl: IEPA_LUST_LOOKUP_URL,
  };
}

function nofRecord(props: Record<string, unknown>, index: number): Omit<SiteSignalRecord, "miles"> {
  const grantType = text(props.grantType)?.toLowerCase();
  const isLarge = grantType === "large";
  const amount = dollars(props.grantAmount);
  const approvalDate = text(props.approvalDate);
  const completionDate = text(props.completionDate);
  const ward = text(props.ward);
  const communityArea = text(props.communityArea);
  const name = text(props.name) ?? "Unnamed NOF project";
  const place = [ward ? `Ward ${ward}` : null, communityArea].filter(Boolean).join(" · ");

  return {
    id: `nof-${approvalDate ?? "undated"}-${index}`,
    // The awarded business/project, which is what the layer's `name` carries.
    name,
    address: text(props.address),
    facts: [
      [isLarge ? "NOF Large grant" : "NOF Small grant", amount].filter(Boolean).join(": "),
      approvalDate ? `Approved ${approvalDate}` : null,
      completionDate ? `Completed ${completionDate}` : null,
      place.length > 0 ? place : null,
    ].filter((line): line is string => typeof line === "string" && line.length > 0),
    sourceLabel: isLarge
      ? "Chicago Data Portal — NOF Large financial incentive projects"
      : "Chicago Data Portal — NOF Small financial incentive projects",
    sourceUrl: isLarge ? NOF_DATASET_URLS.large : NOF_DATASET_URLS.small,
  };
}

function parcelRecord(props: Record<string, unknown>, index: number): Omit<SiteSignalRecord, "miles"> {
  const pin = text(props.pin);
  const incentiveClass = text(props.incentiveClass);
  const classCode = text(props.classCode);

  return {
    id: pin ? `parcel-${pin}` : `parcel-${index}`,
    name: text(props.name) ?? incentiveClass ?? "Cook County incentive parcel",
    address: text(props.address),
    facts: [
      incentiveClass
        ? `${incentiveClass}${classCode ? ` (class code ${classCode})` : ""}`
        : classCode
          ? `Class code ${classCode}`
          : null,
      pin ? `PIN ${pin}` : null,
    ].filter((line): line is string => Boolean(line)),
    sourceLabel: "Cook County Assessor parcel record",
    sourceUrl: text(props.reportUrl),
  };
}

function brownfieldRecord(
  props: Record<string, unknown>,
  index: number
): Omit<SiteSignalRecord, "miles"> {
  const registryId = text(props.registryId);
  const acresId = text(props.acresId);
  const lastReported = text(props.lastReported);

  return {
    id: registryId ? `brownfield-${registryId}` : `brownfield-${index}`,
    name: text(props.name) ?? "Unnamed brownfield site",
    address: text(props.address),
    facts: [
      registryId ? `EPA registry ID ${registryId}` : null,
      acresId ? `ACRES ID ${acresId}` : null,
      lastReported ? `Last reported ${lastReported}` : null,
    ].filter((line): line is string => Boolean(line)),
    sourceLabel: "EPA Facility Registry Service (ACRES brownfields)",
    sourceUrl: text(props.reportUrl),
  };
}

export async function getSiteSignals(lat: number, lon: number): Promise<SiteSignals | null> {
  const [brownfields, lust, nofProjects, countyParcels] = await Promise.all([
    loadLayer(SIGNAL_FILES.brownfields),
    loadLayer(SIGNAL_FILES.lust),
    loadLayer(SIGNAL_FILES.nofProjects),
    loadLayer(SIGNAL_FILES.countyParcels),
  ]);

  if (!brownfields && !lust && !nofProjects && !countyParcels) return null;

  const isOpenLust = (props: Record<string, unknown>) =>
    props.status !== undefined && String(props.status).startsWith("Open");

  const brownfieldScan = scan(brownfields, lon, lat, 0.25);
  const lustScan = scan(lust, lon, lat, 0.25, isOpenLust);
  const nofScan = scan(nofProjects, lon, lat, 0.5);
  const parcelScan = scan(countyParcels, lon, lat, 0.25);

  return {
    brownfield: brownfieldScan.nearest,
    openLustNearby: lustScan.withinCount,
    nearestOpenLust: lustScan.nearest,
    nofAwardsNearby: nofScan.withinCount,
    incentiveParcelsNearby: parcelScan.withinCount,
    nearestIncentiveParcel: parcelScan.nearest,
    records: {
      openLust: collectRecords(lust, lon, lat, 0.25, lustRecord, isOpenLust),
      nofAwards: collectRecords(nofProjects, lon, lat, 0.5, nofRecord),
      incentiveParcels: collectRecords(countyParcels, lon, lat, 0.25, parcelRecord),
      brownfields: collectRecords(brownfields, lon, lat, 0.5, brownfieldRecord),
    },
  };
}

/** Safe accessor for a possibly-absent record group (older persisted shapes). */
export function siteSignalRecordGroup(
  signals: SiteSignals | null | undefined,
  key: keyof SiteSignalRecords
): SiteSignalRecordGroup {
  return signals?.records?.[key] ?? EMPTY_GROUP;
}
