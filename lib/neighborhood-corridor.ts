/**
 * Bridges the community-area neighborhood pages
 * (app/neighborhoods/[slug]/incentives/page.tsx) to the citywide corridor
 * signals dataset (lib/corridor-citywide.ts) via the centroid-based
 * community-area -> ZIP map (data/exports/community-area-zip.json, built by
 * scripts/build-ca-zip-map.ts).
 *
 * Both the map and the citywide metrics export are best-effort, batch-built
 * artifacts that may be missing or incomplete — every lookup here is
 * null-safe so a neighborhood page always renders even with zero corridor
 * data.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getCorridorCitywideMetric } from "@/lib/corridor-citywide";

/**
 * ZIP 60666 is O'Hare — the underlying parcel universe there is an
 * 18-parcel artifact (mostly airport/vacant-land classification quirks),
 * not a meaningful residential/commercial corridor. Excluded from display
 * everywhere this loader is used.
 */
const EXCLUDED_ZIPS = new Set(["60666"]);

const CA_ZIP_MAP_PATH = path.join(
  process.cwd(),
  "data/exports/community-area-zip.json",
);

type CommunityAreaZipMap = Record<string, string | undefined>;

let caZipCache: CommunityAreaZipMap | null | undefined = undefined;

function loadCommunityAreaZipMap(): CommunityAreaZipMap | null {
  if (caZipCache !== undefined) return caZipCache;

  try {
    if (!existsSync(CA_ZIP_MAP_PATH)) {
      caZipCache = null;
      return caZipCache;
    }
    const raw = readFileSync(CA_ZIP_MAP_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    caZipCache =
      parsed && typeof parsed === "object"
        ? (parsed as CommunityAreaZipMap)
        : null;
  } catch {
    caZipCache = null;
  }

  return caZipCache;
}

/** The representative ZIP for a community area, or `null` if unmapped. */
export function getZipForCommunityArea(caId: number): string | null {
  const map = loadCommunityAreaZipMap();
  if (!map) return null;
  const zip = map[String(caId)];
  return typeof zip === "string" ? zip : null;
}

export interface NeighborhoodCorridorSignals {
  zip: string;
  windowMonths: number;
  vacancy: {
    vacancyRate: number | null;
  };
  turnover: {
    openings: number | null;
    closures: number | null;
  };
  permits: {
    permitCount: number | null;
    demolitionCount: number | null;
  };
}

/**
 * Resolves a community area to its representative ZIP and pulls the three
 * public-facing corridor signals (vacancy, license turnover, permits) from
 * the citywide export. Returns `null` whenever the mapping, the metric
 * record, or its `details` payload is missing — callers must render fine
 * without the section in that case. Never surfaces healthScore or ownership
 * fields; see the "Corridor Signals" copy doctrine in app/corridors.
 */
export function getCorridorSignalsForCommunityArea(
  caId: number,
): NeighborhoodCorridorSignals | null {
  const zip = getZipForCommunityArea(caId);
  if (!zip || EXCLUDED_ZIPS.has(zip)) return null;

  const metric = getCorridorCitywideMetric(zip);
  const details = metric?.details;
  if (!details) return null;

  const vacancyRate = details.vacancy?.vacancyRate ?? null;
  const openings = details.turnover?.openings ?? null;
  const closures = details.turnover?.closures ?? null;
  const permitCount = details.permits?.permitCount ?? null;

  // If none of the three signal groups actually loaded, there's nothing to
  // show — treat it the same as "no data yet".
  if (vacancyRate == null && openings == null && closures == null && permitCount == null) {
    return null;
  }

  return {
    zip,
    windowMonths: details.windowMonths ?? 24,
    vacancy: { vacancyRate },
    turnover: { openings, closures },
    permits: {
      permitCount,
      demolitionCount: details.permits?.demolitionCount ?? null,
    },
  };
}
