/**
 * Map helper constants, types, and utility functions.
 * Extracted from MapView.tsx to keep the main component focused on rendering and state.
 */

import mapboxgl from "mapbox-gl";
import { POINT_DATA_ZONE_KEYS, ZONE_META, ZONING_CATEGORIES } from "@/lib/constants";
import { OWNER_TYPE_COLORS, OWNER_TYPE_LABELS, type OwnerType } from "@/lib/owner-classify";
import {
  CAPITAL_CLASS_MONEY_NOUN,
  FUNDER_TYPE_COLORS,
  FUNDER_TYPE_LABELS,
  INVESTMENT_FALLBACK_COLOR,
  investmentStatusLabel,
} from "@/lib/community-investment-layer";
import type { CapitalClass, FunderType } from "@/lib/community-investment";
import {
  GOVERNMENT_FUNDING_PURPOSE_LABELS,
  type GovernmentFundingPurpose,
} from "@/lib/government-funding-purpose";
import type { DistrictData, ParcelAddressMatch } from "@/lib/types";
import type { SiteSignals } from "@/lib/site-signals";
import type { TransportAccess } from "@/lib/transport-access";
import type { ParcelSpaceFacts } from "@/lib/parcel-space";
import { COOK_COUNTY_CURRENT_PARCELS_QUERY_URL } from "@/lib/cook-viewer";
import { cachedFetch } from "@/lib/fetch-cache";

/* ── Zone file mapping (static fallback for keys without DB data) ───── */
export const ZONE_FILES: Record<string, string> = {
  tif: "tif-districts.geojson",
  federalOZ: "federal-oz.geojson",
  enterprise: "enterprise-zones.geojson",
  stateIncentiveZones: "edge-zones.geojson",
  ssa: "special-service-areas.geojson",
  highUnemployment: "high-unemployment.geojson",
  landmarkDistricts: "landmark-districts.geojson",
  nrhpDistricts: "nrhp-districts.geojson",
  industrialCorridors: "industrial-corridors.geojson",
  microMarketRecovery: "micro-market-recovery.geojson",
  nof: "nof-corridors.geojson",
  ccsa: "ccsa-corridors.geojson",
  nmtcEligible: "nmtc-eligible.geojson",
  qct: "qct.geojson",
  brownfields: "brownfield-sites.geojson",
  energyCommunities: "energy-communities.geojson",
  hubzone: "hubzone.geojson",
  lustSites: "lust-sites.geojson",
  nofFundedProjects: "nof-funded-projects.geojson",
  countyIncentiveParcels: "county-incentive-parcels.geojson",
};

/** Zone keys that use Point geometry and need circle layers instead of fill/line. */
export const POINT_ZONE_KEYS = new Set<string>(POINT_DATA_ZONE_KEYS);

/** Helper: check if a zone should be hidden by default. */
export function isZoneDefaultHidden(key: string): boolean {
  return !ZONE_META[key]?.defaultVisible;
}

/** Heavy-coverage layers get reduced opacity to avoid blocking the map. */
export const HEAVY_COVERAGE_KEYS = new Set([
  "nmtcEligible", "qct", "landmarkDistricts", "nrhpDistricts",
  "highUnemployment", "industrialCorridors", "stateIncentiveZones",
  "energyCommunities", "hubzone",
]);

/** Chicago 77 community areas GeoJSON endpoint (Data Portal). */
export const COMMUNITY_AREAS_URL = "https://data.cityofchicago.org/resource/igwz-8jzy.geojson?$limit=100";

/** Chicago zoning districts GeoJSON endpoint (Data Portal). */
export const CHICAGO_ZONING_URL = "https://data.cityofchicago.org/resource/dj47-wfun.geojson?$limit=50000";

/** Empty GeoJSON FeatureCollection used as initial/cleared data. */
export const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Cook County's current CookViewer parcel feature service. */
export const PARCELS_QUERY_BASE = COOK_COUNTY_CURRENT_PARCELS_QUERY_URL;

export function buildZoningColorExpression(): mapboxgl.Expression {
  const zoneClassProp: mapboxgl.Expression = ["get", "zone_class"];
  const sortedEntries: { prefix: string; color: string }[] = [];
  for (const cat of ZONING_CATEGORIES) {
    for (const prefix of cat.prefixes) {
      sortedEntries.push({ prefix, color: cat.color });
    }
  }
  sortedEntries.sort((a, b) => b.prefix.length - a.prefix.length);
  const cases: mapboxgl.Expression = ["case"];
  for (const { prefix, color } of sortedEntries) {
    (cases as unknown[]).push(
      ["==", ["slice", ["to-string", zoneClassProp], 0, prefix.length], prefix],
      color
    );
  }
  (cases as unknown[]).push("#C7C7CC");
  return cases;
}

/** Chicago bounding box — reject data outside this range (bad projections). */
export const CHI_BOUNDS = { minLon: -88.0, maxLon: -87.4, minLat: 41.6, maxLat: 42.1 };

export function isFeatureInChicago(feature: GeoJSON.Feature): boolean {
  try {
    const geom = feature.geometry;
    if (!geom || !("coordinates" in geom)) return false;
    const coords = JSON.stringify(geom.coordinates);
    const nums = coords.match(/-?\d+\.\d+/g);
    if (!nums || nums.length < 2) return false;
    const lon = parseFloat(nums[0]);
    const lat = parseFloat(nums[1]);
    return lon >= CHI_BOUNDS.minLon && lon <= CHI_BOUNDS.maxLon &&
           lat >= CHI_BOUNDS.minLat && lat <= CHI_BOUNDS.maxLat;
  } catch {
    return false;
  }
}

/** Module-level cache so toggling layers on/off/on is instant. */
const zoneGeoJSONCache = new Map<string, GeoJSON.FeatureCollection>();

export async function fetchZoneGeoJSON(key: string): Promise<GeoJSON.FeatureCollection | null> {
  const cached = zoneGeoJSONCache.get(key);
  if (cached) return cached;
  const geojsonUrl =
    key === "nof"
      ? "/api/zones/geojson/nof?v=20260605-corridors"
      : `/api/zones/geojson/${key}`;

  try {
    const data = await cachedFetch<GeoJSON.FeatureCollection>(geojsonUrl);
    if (data?.features?.length > 0) {
      if (isFeatureInChicago(data.features[0])) {
        zoneGeoJSONCache.set(key, data);
        return data;
      }
      console.warn(`[MapView] DB data for "${key}" has out-of-range coordinates, falling back to static file`);
    }
  } catch {
    // Fall through to static
  }
  const file = ZONE_FILES[key];
  if (!file) return null;
  try {
    const data = await cachedFetch<GeoJSON.FeatureCollection>(`/data/zones/${file}`);
    if (data) {
      zoneGeoJSONCache.set(key, data);
      return data;
    }
  } catch {
    // No data available
  }
  return null;
}

/* ── POI layer config (Chicago Data Portal SODA) ─ */
export interface PoiConfig {
  label: string;
  color: string;
  icon: string;
  format: "geojson" | "json";
  url: string;
  latField?: string;
  lonField?: string;
  nameField?: string;
}

export const POI_LAYERS: Record<string, PoiConfig> = {
  ctaStations: {
    label: "CTA L Stations",
    color: "#e11d48",
    icon: "rail",
    format: "geojson",
    url: "https://data.cityofchicago.org/resource/8pix-ypme.geojson?$limit=400",
  },
  schools: {
    label: "K-12 Schools",
    color: "#d97706",
    icon: "school",
    format: "json",
    url: "https://data.cityofchicago.org/resource/kh4r-387c.json?$limit=800&$select=short_name,address,school_latitude,school_longitude,primary_category",
    latField: "school_latitude",
    lonField: "school_longitude",
    nameField: "short_name",
  },
  libraries: {
    label: "Libraries",
    color: "#7c3aed",
    icon: "library",
    format: "geojson",
    url: "https://data.cityofchicago.org/resource/x8fc-8rcq.geojson?$limit=100",
  },
};

/** Convert JSON array with lat/lon fields to GeoJSON FeatureCollection */
export function jsonToGeoJSON(
  rows: Record<string, string>[],
  latField: string,
  lonField: string
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows
      .filter((r) => r[latField] && r[lonField])
      .map((r) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [parseFloat(r[lonField]), parseFloat(r[latField])],
        },
        properties: r,
      })),
  };
}

/* ── Admin ownership-cluster popup (Owner Files) ─────────────── */

/**
 * Feature properties for one unclustered point of the admin-gated
 * ownership-cluster layer, as they arrive from Mapbox's feature.properties
 * (already JSON-primitive coerced). Matches OwnerClusterGeoFeatureProperties
 * (lib/owner-cluster-geo.ts).
 */
export interface OwnerClusterPopupProperties {
  pin?: string;
  address?: string | null;
  vacant?: boolean;
  zip?: string;
  clusterKey?: string;
  ownerName?: string | null;
  ownerType?: string | null;
  clusterParcelCount?: number;
  clusterVacantCount?: number;
  confidence?: string;
}

function escapePopupHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] as string);
}

/** Inline-style (bg;color) pair for a cluster's confidence badge, mirroring the CONFIDENCE_BADGE Tailwind map in app/admin/owner-files/[zip]/page.tsx — Low is the safe default for any unrecognized value. */
function confidenceBadgeStyle(confidence: string): string {
  if (confidence === "High") return "background:#DCFCE7;color:#16A34A";
  if (confidence === "Medium") return "background:#FEF3C7;color:#D97706";
  return "background:rgba(12,27,51,0.05);color:rgba(12,27,51,0.45)";
}

/**
 * Popup body for a clicked ownership-cluster parcel (MapView's
 * `map.on("click", "owner-clusters-unclustered")`). Extracted from the
 * inline handler so the content contract is unit-testable without a live
 * map. Row order mirrors the Owner Files cluster card
 * (app/admin/owner-files/[zip]/page.tsx / OwnerClusterListClient):
 *   1. owner name (bold) + owner-type chip, confidence badge right-aligned
 *   2. "X vacant / Y parcels" metric line
 *   3. this parcel's address
 *   4. the percent-encoded Owner File link (cluster keys contain ':')
 * Two card rows have no popup equivalent and are intentionally omitted:
 * taxpayer mailing address and building-violation count aren't part of
 * OwnerClusterGeoFeatureProperties (lib/owner-cluster-geo.ts) — the
 * per-parcel geo export is deliberately leaner than the full OwnerCluster
 * the card reads, so there's nothing to show without a data-pipeline
 * change (out of scope here). `address` here is this one parcel's site
 * address, not the cluster's sample-addresses list.
 * Owner-type labels/colors come from lib/owner-classify.ts, mirroring the
 * vacant-properties popup.
 */
export function buildOwnerClusterPopupHtml(p: OwnerClusterPopupProperties): string {
  const ownerType = (p.ownerType ?? null) as OwnerType | null;
  const ownerLabel = ownerType ? (OWNER_TYPE_LABELS[ownerType] || ownerType) : OWNER_TYPE_LABELS.unknown;
  const ownerColor = ownerType ? (OWNER_TYPE_COLORS[ownerType] || "#9CA3AF") : "#9CA3AF";
  const zip = p.zip || "";
  const clusterKey = p.clusterKey || "";
  const ownerFileHref = `/admin/owner-files/${zip}/${encodeURIComponent(clusterKey)}`;
  const ownerName = escapePopupHtml(p.ownerName || "Owner record unavailable");
  const address = p.address ? escapePopupHtml(p.address) : "";
  const confidenceBadge = p.confidence
    ? `<span style="flex-shrink:0;display:inline-block;${confidenceBadgeStyle(p.confidence)};padding:2px 6px;border-radius:2px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-left:8px">${escapePopupHtml(p.confidence)}</span>`
    : "";

  return `<div style="font-family:Inter,sans-serif">
    <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#7C3AED;margin-bottom:4px;font-weight:500">Admin · Ownership Cluster</div>
    <div style="display:flex;align-items:flex-start;justify-content:space-between">
      <div style="min-width:0">
        <div style="font-size:14px;font-weight:600;color:#0C1B33">${ownerName}</div>
        <span style="display:inline-block;margin-top:4px;background:${ownerColor}15;color:${ownerColor};border:1px solid ${ownerColor}30;padding:1px 6px;border-radius:2px;font-size:9px;font-weight:500">${escapePopupHtml(ownerLabel)}</span>
      </div>
      ${confidenceBadge}
    </div>
    <div style="font-size:11px;color:#5A6478;margin-top:8px;font-weight:600">${p.clusterVacantCount ?? 0} vacant / ${p.clusterParcelCount ?? 0} parcels</div>
    ${address ? `<div style="font-size:11px;color:#8A93A6;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${address}</div>` : ""}
    <a href="${ownerFileHref}" style="display:inline-block;margin-top:8px;font-size:10px;color:#2563EB;text-decoration:underline">Open Owner File &rarr;</a>
  </div>`;
}

/* ── Admin community-investment popup (Community Investment layer) ───── */

/**
 * Feature properties for one clicked community-investment point, as they arrive
 * from Mapbox's feature.properties (JSON-primitive coerced). Matches
 * InvestmentPointProps (lib/community-investment-layer.ts) with every field
 * optional/nullable to tolerate the coercion.
 */
export interface InvestmentPopupProperties {
  /** Record id — read only to power the deliverable-1 lazy-reveal button on a
   * LAZY_RECORD_SOURCES point (currently RRF) whose recipient was withheld. */
  id?: string;
  source?: string;
  recipient?: string;
  funderName?: string;
  funderType?: string;
  governmentFundingPurpose?: string | null;
  /** Capital class — picks the money noun + field so a TIF/federal/tax-credit dot
   * is never mislabeled "Awarded". Absent → treated as "grant". */
  capitalClass?: string;
  amountAwarded?: number | null;
  /** Council-authorized TIF ceiling / committed HUD allocation (tif_subsidy /
   * federal_program), a SEPARATE measure from amountAwarded. */
  authorizedAmount?: number | null;
  /** LIHTC/NMTC tax-credit capital (tax_credit) — a DIFFERENT instrument again. */
  creditAmount?: number | null;
  /** DCEO source-published appropriation balance; not an award or active opportunity. */
  publishedBalance?: number | null;
  /** Announced private DEVELOPMENT capital — a SEPARATE measure from amountAwarded. */
  announcedInvestment?: number | null;
  logLine?: string | null;
  year?: number | null;
  status?: string;
  /** Stamped Chicago community area — powers the "Analyze this community →" link. */
  communityArea?: string;
  sourceLink?: string;
  historicalRecoveryAmount?: number | null;
  recoverySourceId?: string;
}

/**
 * Format an awarded dollar figure for display. Real awarded dollars only —
 * a null/absent amount renders "Not disclosed" rather than a fabricated $0 or
 * any word implying a balance was received/remaining. Whole dollars, grouped.
 */
export function formatAwardedAmount(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "Not disclosed";
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

export interface CountyReliefPopupProperties {
  zipCode?: string;
  awardCount?: number | string;
  totalDisbursed?: number | string;
  sourceLink?: string;
}

/** ZIP-aggregate popup for Cook County's completed 2023 Source Grant program. */
export function buildCountyReliefPopupHtml(p: CountyReliefPopupProperties): string {
  const rawZipCode = String(p.zipCode || "");
  const canLoadRecipients = /^\d{5}$/.test(rawZipCode);
  const zipCode = escapePopupHtml(rawZipCode || "ZIP unavailable");
  const awardCount = Number(p.awardCount);
  const totalDisbursed = Number(p.totalDisbursed);
  const sourceLink =
    p.sourceLink && /^https?:\/\//i.test(p.sourceLink) ? escapePopupHtml(p.sourceLink) : "";
  return `<div style="font-family:Inter,sans-serif">
    <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#0E7490;margin-bottom:4px;font-weight:500">Admin · Historical county awards</div>
    <div style="font-size:14px;font-weight:600;color:#0C1B33">ZIP ${zipCode}</div>
    <div style="font-size:12px;color:#5A6478;margin-top:6px">${Number.isFinite(awardCount) ? Math.round(awardCount).toLocaleString("en-US") : "No"} small-business award${Number.isFinite(awardCount) && awardCount === 1 ? "" : "s"}</div>
    <div style="display:flex;align-items:baseline;gap:6px;margin-top:7px">
      <span style="font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#8A93A6">Disbursed in 2023 program</span>
      <span style="font-size:14px;font-weight:700;color:#0C1B33">${formatAwardedAmount(totalDisbursed)}</span>
    </div>
    <div style="font-size:10px;color:#8A93A6;margin-top:7px;line-height:1.4">ZIP-level source precision. This program is complete and is not an active funding opportunity.</div>
    ${canLoadRecipients ? `<button type="button" data-county-relief-recipients="${zipCode}" style="display:block;width:100%;margin-top:9px;padding:8px 10px;border:1px solid #0E749033;background:#0E74900D;color:#0E7490;font-size:10px;font-weight:600;cursor:pointer;text-align:center">View historical recipients</button>` : ""}
    ${sourceLink ? `<a href="${sourceLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;font-size:10px;color:#2563EB;text-decoration:underline">Source &rarr;</a>` : ""}
  </div>`;
}

export interface HistoricalRecoveryZipPopupProperties {
  sourceId?: string;
  programName?: string;
  zipCode?: string;
  awardCount?: number | string;
  totalDisbursed?: number | string;
  year?: number | string;
  sourceLink?: string;
}

/** ZIP-aggregate popup for a completed historical recovery program. */
export function buildHistoricalRecoveryZipPopupHtml(
  p: HistoricalRecoveryZipPopupProperties,
): string {
  const rawZipCode = String(p.zipCode || "");
  const sourceId = String(p.sourceId || "");
  const canLoadRecipients =
    /^\d{5}$/.test(rawZipCode) &&
    (sourceId === "cook-source-2023" ||
      sourceId === "illinois-big" ||
      sourceId === "illinois-b2b");
  const zipCode = escapePopupHtml(rawZipCode || "ZIP unavailable");
  const programName = escapePopupHtml(
    p.programName || "Historical recovery program",
  );
  const awardCount = Number(p.awardCount);
  const totalDisbursed = Number(p.totalDisbursed);
  const year = Number(p.year);
  const sourceLink =
    p.sourceLink && /^https?:\/\//i.test(p.sourceLink)
      ? escapePopupHtml(p.sourceLink)
      : "";
  return `<div style="font-family:Inter,sans-serif">
    <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#B45309;margin-bottom:4px;font-weight:500">Admin · Historical recovery grants</div>
    <div style="font-size:14px;font-weight:600;color:#0C1B33">ZIP ${zipCode}</div>
    <div style="font-size:11px;color:#5A6478;margin-top:4px">${programName}</div>
    <div style="font-size:12px;color:#5A6478;margin-top:6px">${Number.isFinite(awardCount) ? Math.round(awardCount).toLocaleString("en-US") : "No"} historical award${Number.isFinite(awardCount) && awardCount === 1 ? "" : "s"}</div>
    <div style="display:flex;align-items:baseline;gap:6px;margin-top:7px">
      <span style="font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#8A93A6">Source-reported historical total${Number.isFinite(year) ? ` · ${Math.round(year)}` : ""}</span>
      <span style="font-size:14px;font-weight:700;color:#0C1B33">${formatAwardedAmount(totalDisbursed)}</span>
    </div>
    <div style="font-size:10px;color:#8A93A6;margin-top:7px;line-height:1.4">ZIP-level source precision. This program is complete and is not an active funding opportunity.</div>
    ${canLoadRecipients ? `<button type="button" data-historical-recovery-recipients="${escapePopupHtml(sourceId)}" data-recovery-zip="${zipCode}" style="display:block;width:100%;margin-top:9px;padding:8px 10px;border:1px solid #B4530933;background:#B453090D;color:#92400E;font-size:10px;font-weight:600;cursor:pointer;text-align:center">View historical recipients</button>` : ""}
    ${sourceLink ? `<a href="${sourceLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;font-size:10px;color:#2563EB;text-decoration:underline">Source &rarr;</a>` : ""}
  </div>`;
}

/**
 * Popup body for a clicked community-investment point (MapView's
 * `map.on("click", "community-investment-points")`). Extracted so the content
 * contract is unit-testable without a live map, and styled to match the
 * ownership-cluster popup above (same Inter stack, admin eyebrow, ink/slate
 * scale, funder-type chip in place of the owner-type chip).
 *
 * The dollar figure is labeled "Awarded" — deliberately NEVER "received": every
 * amount here is a real awarded/reported figure, and the received/available/
 * remaining/unspent vocabulary is banned repo-wide (see the banned-figure rail
 * in lib/community-investment.ts). Funder label/color come from
 * lib/community-investment-layer.ts.
 */
export function buildInvestmentPopupHtml(p: InvestmentPopupProperties): string {
  const funderType = (p.funderType ?? "") as FunderType;
  const accent = FUNDER_TYPE_COLORS[funderType] ?? INVESTMENT_FALLBACK_COLOR;
  const funderTypeLabel = FUNDER_TYPE_LABELS[funderType] ?? "Investment";
  const fundingPurpose = (p.governmentFundingPurpose ??
    "unclassified") as GovernmentFundingPurpose;
  const fundingPurposeLabel =
    funderType === "government"
      ? GOVERNMENT_FUNDING_PURPOSE_LABELS[fundingPurpose] ??
        GOVERNMENT_FUNDING_PURPOSE_LABELS.unclassified
      : "";
  // Deliverable 1 (audit finding 9 / consult F6 + Q2): a LAZY_RECORD_SOURCES
  // point (RRF) ships with an EMPTY recipient string in the bulk payload —
  // never the real name — so the popup shows a lazy-reveal action instead of
  // "Recipient unavailable" (which would misreport a genuine data gap). The
  // reveal button's click is wired by the map click handler, which fetches
  // exactly this one record (fetchInvestmentRecipientRecord) and re-renders
  // this same function with the real name filled in.
  const isWithheldIdentity = p.source === "sba-rrf" && !p.recipient;
  const recipient = escapePopupHtml(p.recipient || "Recipient unavailable");
  const funderName = p.funderName ? escapePopupHtml(p.funderName) : "";

  // Pick the CORRECT money noun + field per capital class so nothing is ever
  // mislabeled:
  //   • private_development → "Announced" + announcedInvestment (a development is
  //     capitalClass "grant" but reports an announced price tag, not a grant).
  //   • grant           → "Awarded" + amountAwarded (unchanged).
  //   • tif_subsidy     → "Authorized" + authorizedAmount (a council ceiling).
  //   • federal_program → "Federal program funding" + authorizedAmount.
  //   • tax_credit      → "Tax-credit allocation" + creditAmount.
  //   • state_appropriation → "Published appropriation balance" + publishedBalance.
  // The five money fields are mutually exclusive per record, so exactly one is
  // shown — never two, never summed.
  const isDevelopment = funderType === "private_development";
  const capitalClass = (p.capitalClass ?? "grant") as CapitalClass;
  const isHistoricalRecovery =
    p.recoverySourceId === "sba-rrf" || p.source === "sba-rrf";
  let moneyLabel: string;
  let moneyValue: number | null | undefined;
  if (isHistoricalRecovery) {
    moneyLabel = "Historical grant";
    moneyValue = p.historicalRecoveryAmount;
  } else if (isDevelopment) {
    moneyLabel = "Announced";
    moneyValue = p.announcedInvestment;
  } else if (capitalClass === "tif_subsidy" || capitalClass === "federal_program") {
    moneyLabel = CAPITAL_CLASS_MONEY_NOUN[capitalClass];
    moneyValue = p.authorizedAmount;
  } else if (capitalClass === "tax_credit") {
    moneyLabel = CAPITAL_CLASS_MONEY_NOUN.tax_credit;
    moneyValue = p.creditAmount;
  } else if (capitalClass === "state_appropriation") {
    moneyLabel = CAPITAL_CLASS_MONEY_NOUN.state_appropriation;
    moneyValue = p.publishedBalance;
  } else {
    moneyLabel = CAPITAL_CLASS_MONEY_NOUN.grant; // "Awarded"
    moneyValue = p.amountAwarded;
  }
  const amount = escapePopupHtml(formatAwardedAmount(moneyValue));

  const year = p.year != null ? String(p.year) : "";
  const status = p.status ? escapePopupHtml(investmentStatusLabel(String(p.status))) : "";
  const logLine = p.logLine ? escapePopupHtml(p.logLine) : "";
  const link = p.sourceLink && /^https?:\/\//i.test(p.sourceLink) ? p.sourceLink : "";
  const metaRow = [year, status].filter(Boolean);
  // Cross-link into the per-community analysis (Sol #1). Only when the record was
  // stamped with a community area — an internal admin route, same Owner Files gate.
  const communityArea = p.communityArea ? String(p.communityArea).trim() : "";
  const analyzeHref = communityArea ? `/investment/${encodeURIComponent(communityArea)}` : "";

  const recipientLine = isWithheldIdentity
    ? `<button type="button" data-investment-reveal-recipient="${escapePopupHtml(String(p.id || ""))}" style="display:block;width:100%;margin-top:0;padding:6px 8px;border:1px solid #BE123C33;background:#BE123C0D;color:#9F1239;font-size:11px;font-weight:600;cursor:pointer;text-align:left">Reveal recipient name</button>`
    : `<div style="font-size:14px;font-weight:600;color:#0C1B33">${recipient}</div>`;

  return `<div style="font-family:Inter,sans-serif">
    <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:${accent};margin-bottom:4px;font-weight:500">Admin · Community Investment</div>
    ${recipientLine}
    ${funderName ? `<div style="font-size:11px;color:#5A6478;margin-top:4px">${funderName}</div>` : ""}
    <div style="display:flex;align-items:baseline;gap:6px;margin-top:8px">
      <span style="font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#8A93A6">${escapePopupHtml(moneyLabel)}</span>
      <span style="font-size:14px;font-weight:700;color:#0C1B33">${amount}</span>
    </div>
    <div style="margin-top:8px">
      <span style="display:inline-block;background:${accent}15;color:${accent};border:1px solid ${accent}30;padding:1px 6px;border-radius:2px;font-size:9px;font-weight:500">${escapePopupHtml(funderTypeLabel)}</span>
      ${fundingPurposeLabel ? `<span style="display:inline-block;margin-left:4px;background:#0C1B3308;color:#5A6478;border:1px solid #0C1B3320;padding:1px 6px;border-radius:2px;font-size:9px;font-weight:500">${escapePopupHtml(fundingPurposeLabel)}</span>` : ""}
      ${metaRow.length ? `<span style="font-size:11px;color:#5A6478;margin-left:6px">${metaRow.join(" · ")}</span>` : ""}
    </div>
    ${logLine ? `<div style="font-size:11px;color:#8A93A6;margin-top:6px;line-height:1.4">${logLine}</div>` : ""}
    <div style="margin-top:8px;display:flex;gap:12px;align-items:baseline">
      ${analyzeHref ? `<a href="${escapePopupHtml(analyzeHref)}" style="font-size:10px;color:#2563EB;text-decoration:underline;font-weight:600">Analyze this community &rarr;</a>` : ""}
      ${link ? `<a href="${escapePopupHtml(link)}" target="_blank" rel="noopener noreferrer" style="font-size:10px;color:#2563EB;text-decoration:underline">Source &rarr;</a>` : ""}
    </div>
  </div>`;
}

/* ── Neighborhood stats type ─────────────── */
export interface AreaStats {
  medianHomePrice: string;
  medianIncome: string;
  walkScore: number;
  parcelPin?: string;
  /** County-published address of the resolved parcel (the parcel's own record). */
  parcelAddress?: string;
  /** Address-guard verdict from /api/parcel — "mismatch" means the parcel
   *  record does NOT belong to the searched address and must be caveated. */
  parcelAddressMatch?: ParcelAddressMatch;
  /** The address the lookup was asked to resolve, when one was named. */
  parcelRequestedAddress?: string | null;
  parcelClass?: string;
  parcelClassDescription?: string;
  parcelValue?: string;
  parcelTaxCode?: string;
  parcelTownship?: string;
  parcelType?: string;
  space?: ParcelSpaceFacts;
  districts?: DistrictData;
  districtsLoading?: boolean;
  assessedLand?: number | null;
  assessedBuilding?: number | null;
  assessedTotal?: number | null;
  taxYear?: string | null;
  priorYearTax?: number | null;
  ownerName?: string | null;
  ownerType?: string | null;
  siteSignals?: SiteSignals | null;
  transport?: TransportAccess | null;
}

export const DEFAULT_STATS: AreaStats = {
  medianHomePrice: "$142,000",
  medianIncome: "$38,500",
  walkScore: 11,
};

/* ── Map Presets ──────────────────────────── */
export interface MapPreset {
  id: string;
  label: string;
  zones?: string[] | "location" | "all";
  zoning?: boolean;
  vacancy?: boolean;
  parcels?: boolean;
}

export const MAP_PRESETS: MapPreset[] = [
  {
    id: "city",
    label: "City",
    zones: ["tif", "ssa", "nof", "ccsa", "industrialCorridors", "microMarketRecovery", "landmarkDistricts"],
    zoning: false,
    vacancy: false,
    parcels: false,
  },
  {
    id: "state",
    label: "State",
    zones: ["enterprise", "stateIncentiveZones", "lustSites"],
    zoning: false,
    vacancy: false,
    parcels: false,
  },
  {
    id: "federal",
    label: "Federal",
    zones: ["federalOZ", "highUnemployment", "nmtcEligible", "qct", "nrhpDistricts", "hubzone", "energyCommunities", "brownfields"],
    zoning: false,
    vacancy: false,
    parcels: false,
  },
  {
    id: "environmental",
    label: "Environmental",
    zones: ["brownfields", "lustSites", "energyCommunities", "enterprise", "stateIncentiveZones", "industrialCorridors", "countyIncentiveParcels"],
    zoning: false,
    vacancy: false,
    parcels: true,
  },
  {
    id: "zoning",
    label: "Zoning",
    zones: [],
    zoning: true,
    vacancy: false,
    parcels: true,
  },
  {
    id: "vacancy",
    label: "Vacancy",
    zones: [],
    zoning: false,
    vacancy: true,
    parcels: true,
  },
];
