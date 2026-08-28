import {
  isValidInstantCoordinatePair,
  parseInstantCoordinateParam,
} from "@/lib/instant-report-coords";

export type LegacyCheckSearchParams = Record<
  string,
  string | string[] | undefined
>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Preserve the retired surface's exact site-activity coverage guard. */
function isPlausibleChicagoPoint(lat: number, lon: number): boolean {
  return lat > 41.6 && lat < 42.1 && lon > -87.95 && lon < -87.5;
}

/**
 * Preserve the useful context in an old Quick Address Check link while
 * carrying it into the canonical Site Incentive Analysis flow.
 */
export function buildRetiredCheckDestination(
  params: LegacyCheckSearchParams,
): string {
  const rawLat = first(params.lat);
  const rawLon = first(params.lon);
  const lat = parseInstantCoordinateParam(rawLat);
  const lon = parseInstantCoordinateParam(rawLon);

  if (lat == null || lon == null) return "/report";
  if (
    !isValidInstantCoordinatePair(lat, lon) ||
    !isPlausibleChicagoPoint(lat, lon)
  ) {
    return "/report";
  }

  const query = new URLSearchParams({
    instant: "true",
    lat: String(lat),
    lon: String(lon),
  });
  const address = first(params.addr) || first(params.address);
  if (address) query.set("addr", address);
  const sector = first(params.sector);
  if (sector) query.set("sector", sector);
  const surveyAnswers = first(params.sa);
  if (surveyAnswers) query.set("sa", surveyAnswers);
  query.set("src", "address_search");

  return `/report?${query.toString()}`;
}
