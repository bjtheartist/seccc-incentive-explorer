import "server-only";

/**
 * Server-only loaders for the Site Shortlist's DISPLAY-ONLY facts —
 * expressway proximity, and nearest-school/nearest-library distance (see
 * lib/shortlist-criteria.ts and lib/shortlist-engine.ts for why these three
 * can never screen or score a candidate).
 *
 * All three read committed files under public/data/, exactly like
 * lib/rail-stations.ts already does for the shortlist's rail data — no
 * network, no per-candidate API calls, and a missing/malformed file
 * degrades to "no display fact available" rather than throwing.
 *
 * The expressway fact reuses the SAME committed per-ZIP snapshot and key
 * scheme the existing Site Matchmaker Results Table already built
 * (public/data/site-matchmaker-context/<zip>.json,
 * lib/site-matchmaker-context.ts's `siteMatchmakerContextKey` convention,
 * lib/site-matchmaker-results.ts's `parseSiteMatchmakerContextPayload`) —
 * this is the "existing straight-line measure" the gpt5.6 matchmaker
 * consult pointed at for expressway proximity, reused here rather than
 * recomputed.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSiteMatchmakerContextPayload } from "./site-matchmaker-results";
import type { AmenityPoint, ExpresswayContextFact } from "./shortlist-engine";

const DATA_DIR = path.join(process.cwd(), "public", "data");

function readJsonFile(filePath: string): unknown | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

const amenityPointsCache = new Map<string, AmenityPoint[]>();

/** Read one of the committed amenity point files (school-points.json,
 *  library-points.json) into plain {name, lat, lon} points. `[]` on any
 *  failure — an unreadable file is an empty display layer, never a thrown
 *  error and never a fabricated point. */
export function loadShortlistAmenityPoints(fileName: string): AmenityPoint[] {
  const cached = amenityPointsCache.get(fileName);
  if (cached) return cached;

  const parsed = readJsonFile(path.join(DATA_DIR, fileName)) as
    | { points?: { name?: unknown; lat?: unknown; lon?: unknown }[] }
    | null;
  const points: AmenityPoint[] = [];
  for (const raw of parsed?.points ?? []) {
    if (
      typeof raw.name === "string" &&
      raw.name.trim().length > 0 &&
      typeof raw.lat === "number" &&
      typeof raw.lon === "number" &&
      Number.isFinite(raw.lat) &&
      Number.isFinite(raw.lon)
    ) {
      points.push({ name: raw.name, lat: raw.lat, lon: raw.lon });
    }
  }
  amenityPointsCache.set(fileName, points);
  return points;
}

const expresswayContextCache = new Map<string, ReadonlyMap<string, ExpresswayContextFact>>();

/** The committed per-ZIP expressway-proximity snapshot, keyed exactly like
 *  lib/site-matchmaker-context.ts's `siteMatchmakerContextKey` — `pin:<pin>`
 *  when a PIN is known, else `coord:<lat,lon>|addr:<normalized address>`.
 *  Returns an empty map (never throws) when the ZIP has no committed
 *  snapshot yet — every consumer already treats a missing map entry as "no
 *  expressway fact for this record", the honest display-only default. */
export function loadShortlistExpresswayContext(zip: string): ReadonlyMap<string, ExpresswayContextFact> {
  const cached = expresswayContextCache.get(zip);
  if (cached) return cached;

  const parsed = readJsonFile(path.join(DATA_DIR, "site-matchmaker-context", `${zip}.json`));
  const context = parsed ? parseSiteMatchmakerContextPayload(parsed, zip) : null;

  const byKey = new Map<string, ExpresswayContextFact>();
  if (context) {
    for (const [key, metric] of context.contextByKey) {
      byKey.set(key, { name: metric.nearestExpresswayName, miles: metric.nearestExpresswayMiles });
    }
  }
  expresswayContextCache.set(zip, byKey);
  return byKey;
}
