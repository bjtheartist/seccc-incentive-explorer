/**
 * Shared types between the concierge client panel and the API route.
 */

/**
 * Lightweight context the CLIENT sends in the request body describing where the
 * visitor is. The server does NOT fetch anything for this — getPageContext just
 * returns what the client provided. Keep this small and non-sensitive.
 */
export interface ConciergePageContext {
  /** Current route path, e.g. "/report" or "/workspace". */
  route: string;
  /** Optional human label for the page, e.g. "Incentive report". */
  pageLabel?: string;
  /** Optional one-line summary of the report currently on screen. */
  reportSummary?: string;
  /** Optional address the current report/report-in-progress is about. */
  address?: string;
  /** Optional coordinates for the current report, for zone lookups. */
  lat?: number;
  lon?: number;
  /** Optional list of program names/ids currently surfaced to the visitor. */
  visiblePrograms?: string[];
  /** Place-based and specialist organizations already surfaced in the report. */
  localSupportOrganizations?: Array<{
    name: string;
    role?: string;
    supportTypes?: string;
    serviceGeography?: string;
    website?: string;
    supportLanes?: string[];
  }>;
  /** Public financing or development match selected by the report engine. */
  capitalSupportName?: string;
  /** Plain-language report reason for the financing/development match. */
  capitalSupportReason?: string;
  /** Public description of the organization's project focus. */
  capitalSupportFitNote?: string;
  /** Public intake path supplied by the curated partner registry. */
  capitalSupportIntakeUrl?: string;
}

export function sanitizePageContext(value: unknown): ConciergePageContext {
  const v = (value ?? {}) as Record<string, unknown>;
  const str = (x: unknown, max: number): string | undefined =>
    typeof x === "string" && x.trim() ? x.trim().slice(0, max) : undefined;
  const num = (x: unknown): number | undefined =>
    typeof x === "number" && Number.isFinite(x) ? x : undefined;
  const url = (x: unknown): string | undefined => {
    const value = str(x, 500);
    return value && /^https?:\/\//i.test(value) ? value : undefined;
  };

  const visiblePrograms = Array.isArray(v.visiblePrograms)
    ? v.visiblePrograms
        .filter((p): p is string => typeof p === "string")
        .slice(0, 40)
        .map((p) => p.slice(0, 120))
    : undefined;
  const localSupportOrganizations = Array.isArray(v.localSupportOrganizations)
    ? v.localSupportOrganizations
        .slice(0, 6)
        .map((item) => {
          const org = (item ?? {}) as Record<string, unknown>;
          const name = str(org.name, 200);
          if (!name) return null;
          return {
            name,
            role: str(org.role, 300),
            supportTypes: str(org.supportTypes, 1200),
            serviceGeography: str(org.serviceGeography, 500),
            website: url(org.website),
            supportLanes: Array.isArray(org.supportLanes)
              ? org.supportLanes
                  .filter((lane): lane is string => typeof lane === "string")
                  .slice(0, 8)
                  .map((lane) => lane.slice(0, 80))
              : undefined,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : undefined;

  return {
    route: str(v.route, 200) ?? "/",
    pageLabel: str(v.pageLabel, 120),
    reportSummary: str(v.reportSummary, 1500),
    address: str(v.address, 300),
    lat: num(v.lat),
    lon: num(v.lon),
    visiblePrograms,
    localSupportOrganizations,
    capitalSupportName: str(v.capitalSupportName, 200),
    capitalSupportReason: str(v.capitalSupportReason, 800),
    capitalSupportFitNote: str(v.capitalSupportFitNote, 1200),
    capitalSupportIntakeUrl: url(v.capitalSupportIntakeUrl),
  };
}
