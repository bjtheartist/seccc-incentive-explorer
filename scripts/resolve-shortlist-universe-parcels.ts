/**
 * resolve-shortlist-universe-parcels.ts
 *
 * Precompute exact County parcel identity (PIN) for every shortlist-universe
 * row that has no published PIN, so the shortlist never has to hit the Cook
 * County GIS service at request time just to learn WHICH parcel a record is.
 *
 * Method — AT LEAST AS STRICT AS /api/shortlist/resolve-parcel, run offline
 * (never more permissive: a precomputed answer is committed and then trusted
 * without re-checking, so every condition the live route calls "malformed"
 * must produce NO ENTRY here and fall back to the live route at request
 * time). The decision rules and the containment test live in the importable,
 * unit-tested lib/shortlist-parcel-identity-resolver.ts — see its header for
 * the full parity doctrine.
 *   1. Page the County "parcel_current_beta" polygons for each ZIP's bounding
 *      box (2,000 per page, geometry in WGS84).
 *   2. For each PIN-less row with a usable Chicago coordinate + street
 *      address, find every parcel FEATURE that intersects the point —
 *      per-feature even-odd, boundary INCLUDED, so a point on a shared lot
 *      line belongs to both parcels exactly as esriSpatialRelIntersects says.
 *   3. Exactly one intersecting PIN whose County-published street address
 *      matches the record's address (lib parcelAddressesMatch) → resolved.
 *      Zero → no_match/no_intersection. >1 distinct PIN → ambiguous.
 *      One, wrong address → no_match/address_mismatch. Never nearest-neighbor.
 *      An unparseable PIN14, a same-PIN address disagreement, or a blank
 *      County street address on any intersecting feature → no entry at all.
 *
 * Output — one sidecar per ZIP, keyed by the universe row's canonicalKey and
 * bound to the universe buildId it was computed against:
 *   data/exports/shortlist-universe/parcel-identity/<zip>.json
 * plus parcel-identity/manifest.json (checksums). The runtime loader
 * (lib/shortlist-parcel-identity.ts) fails closed on any buildId or checksum
 * mismatch and simply falls back to on-demand resolution.
 *
 * Usage:
 *   npx tsx scripts/resolve-shortlist-universe-parcels.ts            # all ZIPs in the manifest
 *   npx tsx scripts/resolve-shortlist-universe-parcels.ts 60619 60623
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { COOK_COUNTY_CURRENT_PARCELS_QUERY_URL, normalizePin14 } from "../lib/cook-viewer";
import {
  normalizeCountyArea,
  normalizeCountyClass,
  normalizeCountyTaxYear,
} from "../lib/county-parcel-facts";
import {
  isChicagoParcelCoordinate,
  normalizedParcelStreetAddress,
} from "../lib/site-matchmaker-parcel-resolution";
import {
  resolveRow,
  ringsBbox,
  type CountyParcelFeature,
  type ParcelIdentityEntry,
  type Ring,
} from "../lib/shortlist-parcel-identity-resolver";

export type { ParcelIdentityEntry };

const UNIVERSE_DIR = join(process.cwd(), "data", "exports", "shortlist-universe");
const OUT_DIR = join(UNIVERSE_DIR, "parcel-identity");
const PAGE_SIZE = 2000;
const REQUEST_TIMEOUT_MS = 90_000;
const REQUEST_ATTEMPTS = 4;
const INTER_REQUEST_DELAY_MS = 350;

export const PARCEL_IDENTITY_SCHEMA_VERSION = 1;
export const PARCEL_IDENTITY_SOURCE = "cook_county_current_parcels";
export const PARCEL_IDENTITY_METHOD = "exact_intersection";

export interface PrecomputedCountyParcelFacts {
  countyClass: string | null;
  lotAreaSqft: number | null;
  assessorBuildingSqft: number | null;
  assessorBuildingYear: string | null;
  checkedAt: string;
}

interface CountyParcel extends CountyParcelFeature {
  facts: Omit<PrecomputedCountyParcelFacts, "checkedAt">;
}

interface UniverseRow {
  canonicalKey: string;
  pin: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
}

export interface ParcelIdentityFile {
  schemaVersion: typeof PARCEL_IDENTITY_SCHEMA_VERSION;
  zip: string;
  universeBuildId: string;
  generatedAt: string;
  source: typeof PARCEL_IDENTITY_SOURCE;
  matchMethod: typeof PARCEL_IDENTITY_METHOD;
  counts: {
    candidates: number;
    resolved: number;
    noIntersection: number;
    ambiguous: number;
    addressMismatch: number;
    skippedInvalidLocation: number;
    /** Rows the strict parity rules refused to answer for — no entry
     *  written, resolved live at request time instead. */
    unresolvableRecord: number;
    factsByPin: number;
  };
  entries: Record<string, ParcelIdentityEntry>;
  /**
   * County parcel facts (CookViewer attributes) for every PIN this ZIP's
   * universe rows carry — published or precomputed — so the enrich route
   * never has to call the County ArcGIS server at request time for them.
   */
  factsByPin: Record<string, PrecomputedCountyParcelFacts>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchJsonWithRetry(url: string): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { error?: unknown };
      if (payload && typeof payload === "object" && "error" in payload && payload.error) {
        throw new Error(`County error: ${JSON.stringify(payload.error).slice(0, 200)}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      const backoff = 2_000 * attempt;
      console.warn(`    request failed (attempt ${attempt}/${REQUEST_ATTEMPTS}): ${String(error)} — retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw new Error(`County request failed after ${REQUEST_ATTEMPTS} attempts: ${String(lastError)}`);
}

async function fetchParcelsInBbox(bbox: [number, number, number, number]): Promise<CountyParcel[]> {
  const parcels: CountyParcel[] = [];
  let offset = 0;
  for (;;) {
    const url = new URL(COOK_COUNTY_CURRENT_PARCELS_QUERY_URL);
    url.searchParams.set("where", "1=1");
    url.searchParams.set(
      "geometry",
      JSON.stringify({ xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3], spatialReference: { wkid: 4326 } }),
    );
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "PIN14,street_address,city_state_zip,BCLASS,LANDSF,BLDGSQFT,TAXYR");
    url.searchParams.set("returnGeometry", "true");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("geometryPrecision", "7");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
    url.searchParams.set("f", "json");

    const payload = (await fetchJsonWithRetry(url.toString())) as {
      features?: Array<{ attributes?: Record<string, unknown>; geometry?: { rings?: Ring[] } }>;
      exceededTransferLimit?: boolean;
    };
    const features = Array.isArray(payload.features) ? payload.features : [];
    for (const feature of features) {
      const attributes = feature.attributes ?? {};
      const street = typeof attributes.street_address === "string" ? attributes.street_address : "";
      const cityStateZip = typeof attributes.city_state_zip === "string" ? attributes.city_state_zip : "";
      const rings = feature.geometry?.rings;
      // A feature with an UNPARSEABLE PIN14 is deliberately kept: the
      // resolver must SEE it to refuse the row (dropping it here could turn
      // a genuinely ambiguous point into a confident single match). Only a
      // feature with no geometry at all is useless for containment.
      if (!Array.isArray(rings) || rings.length === 0) continue;
      const address = [street, cityStateZip].filter(Boolean).join(", ");
      parcels.push({
        rawPin: attributes.PIN14,
        address,
        facts: {
          countyClass: normalizeCountyClass(attributes.BCLASS),
          lotAreaSqft: normalizeCountyArea(attributes.LANDSF),
          assessorBuildingSqft: normalizeCountyArea(attributes.BLDGSQFT),
          assessorBuildingYear: normalizeCountyTaxYear(attributes.TAXYR),
        },
        rings,
        bbox: ringsBbox(rings),
      });
    }
    process.stdout.write(`    page offset=${offset} → ${features.length} features (running total ${parcels.length})\n`);
    if (features.length < PAGE_SIZE && payload.exceededTransferLimit !== true) break;
    if (features.length === 0) break;
    offset += features.length;
    await sleep(INTER_REQUEST_DELAY_MS);
  }
  return parcels;
}

async function main() {
  const manifestPath = join(UNIVERSE_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`FATAL: universe manifest missing at ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { buildId: string; zips: string[] };
  const requestedZips = process.argv.slice(2).length > 0 ? process.argv.slice(2) : manifest.zips;
  console.log("=== Shortlist universe parcel-identity precompute ===");
  console.log(`universe buildId: ${manifest.buildId}`);
  console.log(`ZIPs: ${requestedZips.join(", ")}\n`);
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const outManifest: {
    schemaVersion: number;
    universeBuildId: string;
    generatedAt: string;
    files: Record<string, { path: string; checksum: string; entryCount: number }>;
  } = {
    schemaVersion: PARCEL_IDENTITY_SCHEMA_VERSION,
    universeBuildId: manifest.buildId,
    generatedAt: new Date().toISOString(),
    files: {},
  };
  const existingManifestPath = join(OUT_DIR, "manifest.json");
  if (existsSync(existingManifestPath)) {
    const existing = JSON.parse(readFileSync(existingManifestPath, "utf8")) as typeof outManifest;
    if (existing.universeBuildId === manifest.buildId) outManifest.files = existing.files ?? {};
  }

  for (const zip of requestedZips) {
    console.log(`\n── ${zip} ──`);
    const universeFile = JSON.parse(readFileSync(join(UNIVERSE_DIR, `${zip}.json`), "utf8")) as {
      buildId: string;
      rows: UniverseRow[];
    };
    if (universeFile.buildId !== manifest.buildId) {
      console.error(`FATAL: ${zip}.json buildId ${universeFile.buildId} !== manifest ${manifest.buildId}`);
      process.exit(1);
    }
    const candidates = universeFile.rows.filter((row) => !normalizePin14(row.pin));
    const usable = candidates.filter(
      (row) => isChicagoParcelCoordinate(row.lat, row.lon) && normalizedParcelStreetAddress(row.address).length >= 6,
    );
    console.log(`  rows ${universeFile.rows.length} · PIN-less ${candidates.length} · usable for exact check ${usable.length}`);
    const located = universeFile.rows.filter((row) => isChicagoParcelCoordinate(row.lat, row.lon));
    if (located.length === 0) continue;

    const lons = located.map((r) => r.lon as number);
    const lats = located.map((r) => r.lat as number);
    const pad = 0.0005;
    const bbox: [number, number, number, number] = [
      Math.min(...lons) - pad,
      Math.min(...lats) - pad,
      Math.max(...lons) + pad,
      Math.max(...lats) + pad,
    ];
    console.log(`  fetching County parcels in bbox ${bbox.map((n) => n.toFixed(5)).join(", ")}`);
    const parcels = await fetchParcelsInBbox(bbox);
    console.log(`  ${parcels.length} parcel polygons loaded`);

    const checkedAt = new Date().toISOString();
    const entries: Record<string, ParcelIdentityEntry> = {};
    const counts = { candidates: candidates.length, resolved: 0, noIntersection: 0, ambiguous: 0, addressMismatch: 0, skippedInvalidLocation: candidates.length - usable.length, unresolvableRecord: 0, factsByPin: 0 };
    for (const row of usable) {
      const entry = resolveRow(row, parcels, checkedAt);
      // `null` = a condition the live route calls malformed. Writing NO
      // entry hands the row back to the live resolver at request time
      // instead of committing a guess.
      if (!entry) {
        counts.unresolvableRecord += 1;
        continue;
      }
      entries[row.canonicalKey] = entry;
      if (entry.status === "resolved") counts.resolved += 1;
      else if (entry.status === "ambiguous") counts.ambiguous += 1;
      else if (entry.reason === "no_intersection") counts.noIntersection += 1;
      else counts.addressMismatch += 1;
    }
    const factsByCountyPin = new Map<string, CountyParcel["facts"]>();
    for (const parcel of parcels) {
      const parcelPin = normalizePin14(typeof parcel.rawPin === "string" ? parcel.rawPin : null);
      if (parcelPin && !factsByCountyPin.has(parcelPin)) factsByCountyPin.set(parcelPin, parcel.facts);
    }
    const factsByPin: Record<string, PrecomputedCountyParcelFacts> = {};
    const universePins = new Set<string>();
    for (const row of universeFile.rows) {
      const published = normalizePin14(row.pin);
      if (published) universePins.add(published);
    }
    for (const entry of Object.values(entries)) if (entry.status === "resolved") universePins.add(entry.pin);
    for (const pin of [...universePins].sort()) {
      const facts = factsByCountyPin.get(pin);
      if (facts) factsByPin[pin] = { ...facts, checkedAt };
    }
    counts.factsByPin = Object.keys(factsByPin).length;
    console.log(
      `  resolved ${counts.resolved} · no intersection ${counts.noIntersection} · address mismatch ${counts.addressMismatch} · ambiguous ${counts.ambiguous} · skipped ${counts.skippedInvalidLocation} · strict-refused ${counts.unresolvableRecord}`,
    );
    console.log(`  County facts captured for ${counts.factsByPin} of ${universePins.size} universe PINs`);

    const file: ParcelIdentityFile = {
      schemaVersion: PARCEL_IDENTITY_SCHEMA_VERSION,
      zip,
      universeBuildId: manifest.buildId,
      generatedAt: checkedAt,
      source: PARCEL_IDENTITY_SOURCE,
      matchMethod: PARCEL_IDENTITY_METHOD,
      counts,
      entries,
      factsByPin,
    };
    const serialized = JSON.stringify(file, null, 1) + "\n";
    writeFileSync(join(OUT_DIR, `${zip}.json`), serialized);
    outManifest.files[zip] = { path: `${zip}.json`, checksum: sha256(serialized), entryCount: Object.keys(entries).length };
    // Checkpoint the manifest after every ZIP so a dead run loses one ZIP, not the run.
    writeFileSync(existingManifestPath, JSON.stringify(outManifest, null, 2) + "\n");
  }

  console.log(`\nWrote ${Object.keys(outManifest.files).length} sidecar file(s) + manifest to ${OUT_DIR}`);
}

// Only run when invoked directly (`npx tsx scripts/...`), never on import —
// the pure resolver lives in lib/shortlist-parcel-identity-resolver.ts and is
// imported by tests, which must not trigger a County crawl.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
