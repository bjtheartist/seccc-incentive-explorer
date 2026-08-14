import { NextRequest } from "next/server";
import { GET as geocodeGET } from "@/app/api/geocode/route";
import { GET as zonesCheckV2GET } from "@/app/api/zones/check/v2/route";
import { normalizeZoneEvidenceV2 } from "@/lib/zone-response";
import { bridgeZoneEvidenceV2ToBooleanMap, zoneCoverageCaveat } from "@/lib/zone-evidence-bridge";
import { runConfidenceEngine } from "@/lib/confidence-engine";
import { getProgramsSync } from "@/lib/programs-data";

/**
 * Server-only per-parcel incentive-program resolution for the outreach
 * letter (lib/outreach-letter.ts). Kept in its own module — rather than
 * inside lib/outreach-letter.ts itself — because it imports `next/server`
 * and calls route handlers in-process; lib/outreach-letter.ts's jsPDF
 * builder is imported directly by client components (the ".save()" download
 * button) and must stay free of server-only imports.
 *
 * Reuses the exact in-process geocode -> zones/check -> confidence-engine
 * pipeline app/api/cron/watchlist-digest/route.ts already uses for watched-
 * area assessments (see lib/watchlist-digest.ts assessWatchedArea /
 * checkZonesAtPoint) — calling the route handlers directly instead of a
 * network round trip, and reusing runConfidenceEngine + getProgramsSync so
 * the letter's program list is computed by the exact same logic as the rest
 * of the product, not a re-derived approximation.
 */

export interface ParcelProgramMention {
  id: string;
  name: string;
  level: string;
  url: string;
  summary: string;
}

export interface ParcelProgramContext {
  address: string;
  lat: number | null;
  lon: number | null;
  programs: ParcelProgramMention[];
  /** Human-readable reason nothing could be resolved for this address; null when resolution succeeded (with or without matches). */
  resolutionNote: string | null;
}

async function geocodeAddressInProcess(address: string): Promise<{ lat: number; lon: number } | null> {
  const res = await geocodeGET(
    new NextRequest(`http://localhost/api/geocode?address=${encodeURIComponent(address)}`)
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || typeof data.lat !== "number" || typeof data.lon !== "number") return null;
  return { lat: data.lat, lon: data.lon };
}

async function checkZonesInProcess(lat: number, lon: number): Promise<unknown> {
  // review5 S2: v2 in-process route, not v1 — v1 cannot distinguish "this
  // layer failed to resolve" from "this layer genuinely does not match",
  // which is exactly how this file used to justify emitting "No mapped
  // incentive zones matched this address" on outreach letters for
  // addresses where a relevant layer simply never resolved.
  const res = await zonesCheckV2GET(
    new NextRequest(`http://localhost/api/zones/check/v2?lat=${lat}&lon=${lon}`)
  );
  if (!res.ok) return null;
  return res.json();
}

/**
 * Per-parcel incentive-program context for the outreach letter — resolved
 * per known sample address, never one representative address standing in
 * for the whole ownership cluster. `addresses` are the cluster's
 * `sampleAddresses` (already capped at 5 by the corridor-owners cluster
 * query); the full `pins[]` list is not individually geocoded in the
 * MVP — the static export has no per-pin coordinates yet, so resolving all
 * of a large cluster's parcels (e.g. U.S. Steel's 43) is a Phase-2-scale
 * enrichment, not this letter's job.
 *
 * Every per-address lookup degrades independently on failure (mirrors
 * assessWatchedArea's per-area degrade) — one bad address must never sink
 * the whole letter.
 */
export async function resolveParcelProgramContext(addresses: string[]): Promise<ParcelProgramContext[]> {
  const programs = getProgramsSync();
  const results: ParcelProgramContext[] = [];

  for (const address of addresses) {
    try {
      const geo = await geocodeAddressInProcess(address);
      if (!geo) {
        results.push({
          address,
          lat: null,
          lon: null,
          programs: [],
          resolutionNote: "Address could not be located for zone matching.",
        });
        continue;
      }

      const zoneData = await checkZonesInProcess(geo.lat, geo.lon);
      const evidence = normalizeZoneEvidenceV2(zoneData);
      if (!evidence) {
        results.push({
          address,
          lat: geo.lat,
          lon: geo.lon,
          programs: [],
          resolutionNote: "Zone lookup returned no data for this location.",
        });
        continue;
      }

      const { zones, zoneNames, unknownKeys } = bridgeZoneEvidenceV2ToBooleanMap(evidence);
      const matched = runConfidenceEngine(programs, zones, zoneNames).filter(
        (result) => result.relevance !== "not_mapped_at_location"
      );

      // review5 S2: never claim "No mapped incentive zones matched" when
      // the reason the list is empty might be that a layer FAILED to
      // resolve rather than genuinely not matching — the exact false
      // negative this finding named. Only assert absence when every
      // requested layer actually resolved.
      const resolutionNote =
        matched.length > 0
          ? null
          : unknownKeys.length > 0
            ? `${zoneCoverageCaveat(unknownKeys)} No confirmed incentive-zone match either way for this address.`
            : "No mapped incentive zones matched this address.";

      results.push({
        address,
        lat: geo.lat,
        lon: geo.lon,
        programs: matched.map((result) => ({
          id: result.program.id,
          name: result.program.name,
          level: result.program.level,
          url: result.program.url,
          summary: result.program.summary,
        })),
        resolutionNote,
      });
    } catch (err) {
      console.error("resolveParcelProgramContext: parcel lookup failed for", address, err);
      results.push({
        address,
        lat: null,
        lon: null,
        programs: [],
        resolutionNote: "Program lookup failed for this parcel.",
      });
    }
  }

  return results;
}
