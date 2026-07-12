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
}

export function sanitizePageContext(value: unknown): ConciergePageContext {
  const v = (value ?? {}) as Record<string, unknown>;
  const str = (x: unknown, max: number): string | undefined =>
    typeof x === "string" && x.trim() ? x.trim().slice(0, max) : undefined;
  const num = (x: unknown): number | undefined =>
    typeof x === "number" && Number.isFinite(x) ? x : undefined;

  const visiblePrograms = Array.isArray(v.visiblePrograms)
    ? v.visiblePrograms
        .filter((p): p is string => typeof p === "string")
        .slice(0, 40)
        .map((p) => p.slice(0, 120))
    : undefined;

  return {
    route: str(v.route, 200) ?? "/",
    pageLabel: str(v.pageLabel, 120),
    reportSummary: str(v.reportSummary, 1500),
    address: str(v.address, 300),
    lat: num(v.lat),
    lon: num(v.lon),
    visiblePrograms,
  };
}
