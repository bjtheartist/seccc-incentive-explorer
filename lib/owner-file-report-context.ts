import type { OwnerClusterGeoFeature, OwnerClusterGeoFeatureCollection } from "./owner-cluster-geo";
import { normalizeOwnerAddress } from "./corridor-owners";

/**
 * Admin-only ownership context for a single address-report page
 * (components/report/AdminOwnershipPanel.tsx). Screen-only — this type is
 * deliberately NOT part of GeneratedReport (lib/report-engine.ts) and must
 * never be threaded into the PDF/email export path
 * (lib/__tests__/pdf-report-admin-ownership-exclusion.test.ts guards this).
 */
export interface OwnerFileReportMatch {
  pin: string;
  address: string | null;
  zip: string;
  clusterKey: string;
  ownerName: string | null;
  ownerType: string | null;
  clusterParcelCount: number;
  clusterVacantCount: number;
  confidence: string;
}

export interface OwnerFileReportTopCluster {
  clusterKey: string;
  zip: string;
  ownerName: string | null;
  ownerType: string | null;
  clusterParcelCount: number;
  clusterVacantCount: number;
  confidence: string;
}

function toMatch(feature: OwnerClusterGeoFeature): OwnerFileReportMatch {
  const p = feature.properties;
  return {
    pin: p.pin,
    address: p.address,
    zip: p.zip,
    clusterKey: p.clusterKey,
    ownerName: p.ownerName,
    ownerType: p.ownerType,
    clusterParcelCount: p.clusterParcelCount,
    clusterVacantCount: p.clusterVacantCount,
    confidence: p.confidence,
  };
}

/**
 * Best-match a report's plain-text address against the admin-only
 * per-parcel geo export. Exact normalized match wins; otherwise the first
 * parcel whose normalized address contains (or is contained by) the query
 * is used — a deliberately modest fuzzy tier, the same "reasonable but not
 * overconfident" approach lib/business-lookup.ts uses for site-address
 * matching. Returns `null` when nothing plausible matches; callers must
 * treat that as "no parcel-level record found," never as proof of no
 * ownership.
 */
export function matchReportAddressToOwnerParcel(
  fc: OwnerClusterGeoFeatureCollection,
  address: string
): OwnerFileReportMatch | null {
  const query = normalizeOwnerAddress(address);
  if (!query) return null;

  for (const feature of fc.features) {
    if (normalizeOwnerAddress(feature.properties.address) === query) {
      return toMatch(feature);
    }
  }

  for (const feature of fc.features) {
    const normAddr = normalizeOwnerAddress(feature.properties.address);
    if (!normAddr) continue;
    if (normAddr.includes(query) || query.includes(normAddr)) {
      return toMatch(feature);
    }
  }

  return null;
}

/**
 * Top clusters in a ZIP by vacant-parcel count (ties broken by parcel
 * count), deduplicated to one row per clusterKey. Feeds the report panel's
 * "top clusters in this ZIP" list, a citywide-context companion to any
 * direct address match.
 */
export function topOwnerClustersByVacancy(
  fc: OwnerClusterGeoFeatureCollection,
  zip: string,
  limit = 3
): OwnerFileReportTopCluster[] {
  const byCluster = new Map<string, OwnerFileReportTopCluster>();
  for (const feature of fc.features) {
    const p = feature.properties;
    if (p.zip !== zip) continue;
    if (byCluster.has(p.clusterKey)) continue;
    byCluster.set(p.clusterKey, {
      clusterKey: p.clusterKey,
      zip: p.zip,
      ownerName: p.ownerName,
      ownerType: p.ownerType,
      clusterParcelCount: p.clusterParcelCount,
      clusterVacantCount: p.clusterVacantCount,
      confidence: p.confidence,
    });
  }
  return Array.from(byCluster.values())
    .sort(
      (a, b) =>
        b.clusterVacantCount - a.clusterVacantCount || b.clusterParcelCount - a.clusterParcelCount
    )
    .slice(0, limit);
}

/**
 * One resolved load of the admin ownership context for a report view:
 * "idle" = viewer is not an Owner Files admin (probe != 204) — render
 * nothing; "ready" = context resolved (match may still be null);
 * "error" = the viewer IS an admin but the geo data could not be loaded.
 */
export interface AdminOwnershipContextResult {
  status: "idle" | "ready" | "error";
  match: OwnerFileReportMatch | null;
  topClusters: OwnerFileReportTopCluster[];
}

/**
 * The probe-then-fetch orchestration behind the report's admin-only
 * ownership panel, extracted from app/report/page.tsx's ReportDisplay
 * effect so the gate logic is unit-testable: probe /api/owner-file/session
 * first (a non-204 means "not an admin" — resolve idle WITHOUT ever
 * requesting geo data), then fetch /api/owner-file/geo for the report's
 * ZIP and derive the address match + top clusters.
 *
 * AbortErrors propagate (the calling effect ignores them on unmount);
 * every other failure resolves to status "error". `onAdminConfirmed` fires
 * between the probe and the geo fetch so the caller can flip a loading
 * state only for confirmed admins.
 */
export async function fetchAdminOwnershipContext(opts: {
  zip: string;
  address: string | null | undefined;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onAdminConfirmed?: () => void;
}): Promise<AdminOwnershipContextResult> {
  const doFetch = opts.fetchImpl ?? fetch;

  const sessionRes = await doFetch("/api/owner-file/session", { signal: opts.signal });
  if (sessionRes.status !== 204) {
    return { status: "idle", match: null, topClusters: [] };
  }

  opts.onAdminConfirmed?.();

  try {
    const geoRes = await doFetch(`/api/owner-file/geo?zips=${opts.zip}`, { signal: opts.signal });
    if (!geoRes.ok) throw new Error(`Ownership geo fetch failed (${geoRes.status})`);
    const fc = (await geoRes.json()) as OwnerClusterGeoFeatureCollection;

    return {
      status: "ready",
      match: opts.address ? matchReportAddressToOwnerParcel(fc, opts.address) : null,
      topClusters: topOwnerClustersByVacancy(fc, opts.zip, 3),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { status: "error", match: null, topClusters: [] };
  }
}
