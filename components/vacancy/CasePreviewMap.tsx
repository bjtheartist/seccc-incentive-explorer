"use client";

/**
 * CasePreviewMap — the compact, REAL basemap behind the Case Workbench's
 * "Geographic preview" panel (app/vacancy/[zip]/page.tsx). It replaces the
 * dependency-free inline SVG dot map that used to sit there: same match set,
 * same honesty line (rendered by the page, over this map), same footprint —
 * but on an actual Mapbox basemap with the ZIP boundary drawn, so the dots
 * land on real streets instead of an abstract grid.
 *
 * Deliberately a PREVIEW, not the property map:
 *   - scrollZoom is OFF (the workbench is a scrolling page; the map must never
 *     swallow the wheel), dragPan stays ON, rotate/pitch are off.
 *   - No legend, no view toggle, no popups, no owner-type ramp. Dots carry the
 *     SAME key the SVG used — land ink, reported buildings gray — because a
 *     CasePoint carries only {lat, lon, universe}: no address, PIN, or owner
 *     detail travels to this component.
 *   - The full experience lives one click away behind the panel's
 *     "Open the property map →" link (/vacancy/[zip]/map).
 *
 * Raw mapbox-gl (repo convention — react-map-gl is NOT a dependency), same
 * clustered-source playbook as components/vacancy/VacancyReportMap.tsx. All
 * data arrives as props from the server component; nothing is fetched here.
 *
 * REPO GOTCHA (see VacancyReportMap): mapbox-gl.css — imported globally in
 * app/globals.css — overrides Tailwind's absolute positioning on the map
 * container, so the container needs BOTH `absolute inset-0` and explicit
 * `h-full w-full`, inside a parent with a real height. Do not "simplify" it.
 *
 * SSR: never import this module from a Server Component. It is mounted through
 * CasePreviewMapIsland, which loads it with next/dynamic + `ssr: false` (the
 * components/map/MapShell.tsx pattern).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
// Type-only: lib/vacancy-cases is the client-safe half of the case model, but
// importing types alone keeps even that out of the client bundle.
import type { CasePoint } from "@/lib/vacancy-cases";

/** Land dots ink, reported-building dots gray — the SVG preview's key, kept. */
const INK = "#0C1B33";
const BUILDING_GRAY = "#8A8A8A";
/** Last-resort center (Chicago) when neither a centroid nor a mapped point is
 *  available — the map still renders rather than throwing on a bad center. */
const CHICAGO = { lat: 41.8781, lon: -87.6298 };

export interface CasePreviewMapProps {
  zip: string;
  /** The active case's MAPPED matches — the same array the SVG preview drew. */
  points: readonly CasePoint[];
  /** Simplified ZIP ring + bbox from the edition; null renders no boundary. */
  boundary: { rings: [number, number][][]; bbox: [number, number, number, number] } | null;
  /** Edition centroid — the initial center before the bbox fit. */
  centroid: { lat: number; lon: number } | null;
}

/** One Point feature per mapped match; `universe` is the only property carried
 *  (it drives the dot color and nothing else). */
function toFeatureCollection(points: readonly CasePoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { universe: p.universe },
    })),
  };
}

/** Bounding box of the mapped points, or null when there are none. */
function pointsBbox(
  points: readonly CasePoint[],
): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

export default function CasePreviewMap({ zip, points, boundary, centroid }: CasePreviewMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Same token resolution as the report map — a PUBLIC map page reusing the
  // public token already shipped to /map and /vacancy/[zip]/map.
  const token =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN : undefined;

  const collection = useMemo(() => toFeatureCollection(points), [points]);

  // First-render props for the mount-once init effect, held in a ref so the
  // effect can stay dependency-free (VacancyReportMap's dataRef pattern). No
  // re-assignment on later renders — and none is needed: the boundary and
  // centroid are fixed per ZIP (a different ZIP is a different route, i.e. a
  // remount), and later `points` changes are handled by the re-plot effect
  // below. Writing a ref during render is also a react-hooks/refs error.
  const initialDataRef = useRef({ boundary, centroid, collection, points });

  useEffect(() => {
    if (!containerRef.current || !token) return;

    const {
      boundary: bnd,
      centroid: ctr,
      collection: initialData,
      points: pts,
    } = initialDataRef.current;

    const fallbackCenter = (() => {
      if (ctr) return ctr;
      const bb = pointsBbox(pts);
      if (bb) return { lon: (bb[0] + bb[2]) / 2, lat: (bb[1] + bb[3]) / 2 };
      return CHICAGO;
    })();

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [fallbackCenter.lon, fallbackCenter.lat],
      zoom: 11.5,
      // Preview posture: the wheel belongs to the page, not the map. Panning
      // (and pinch/keyboard zoom) stay available; rotate/pitch do not.
      scrollZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    // Compact zoom control only — scrollZoom is off, so this is the desktop
    // way to zoom without stealing the page's wheel.
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      // ── ZIP boundary — the honest edition geography, drawn beneath the dots ──
      if (bnd && bnd.rings.length > 0) {
        map.addSource("case-preview-boundary", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: bnd.rings },
            properties: {},
          },
        });
        map.addLayer({
          id: "case-preview-boundary-line",
          type: "line",
          source: "case-preview-boundary",
          paint: { "line-color": INK, "line-width": 1.75, "line-opacity": 0.75 },
        });
      }

      // ── Clustered dots for the active case's mapped matches ──
      map.addSource("case-preview-points", {
        type: "geojson",
        data: initialData,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 45,
      });

      map.addLayer({
        id: "case-preview-clusters",
        type: "circle",
        source: "case-preview-points",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": INK,
          "circle-opacity": 0.9,
          "circle-radius": ["step", ["get", "point_count"], 13, 25, 18, 100, 23],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "case-preview-cluster-count",
        type: "symbol",
        source: "case-preview-points",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-size": 10,
        },
        paint: { "text-color": "#ffffff" },
      });

      map.addLayer({
        id: "case-preview-unclustered",
        type: "circle",
        source: "case-preview-points",
        filter: ["!", ["has", "point_count"]],
        paint: {
          // The SVG preview's key, unchanged: land ink, reported buildings gray.
          "circle-color": [
            "match",
            ["get", "universe"],
            "building_report", BUILDING_GRAY,
            INK,
          ],
          "circle-radius": 5,
          "circle-opacity": 0.85,
          "circle-stroke-width": 1.2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // ── Fit the ZIP, not the case: the panel's geography stays comparable as
      //    the user switches cases; the caption carries what changed. ──
      const fitBox = bnd?.bbox ?? pointsBbox(pts);
      if (fitBox) {
        map.fitBounds(
          [
            [fitBox[0], fitBox[1]],
            [fitBox[2], fitBox[3]],
          ],
          { padding: 18, duration: 0 },
        );
      }

      setLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Mount-once: all data is read from dataRef; token drives the guard above.
  }, [token]);

  // ── Case switch (`?case=` soft navigation re-renders this island in place):
  //    re-plot the clustered source rather than remounting the map. ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const src = map.getSource("case-preview-points") as mapboxgl.GeoJSONSource | undefined;
    src?.setData(collection);
  }, [collection, loaded]);

  if (!token) {
    return (
      <div className="flex h-[260px] w-full items-center justify-center bg-white px-6 text-center sm:h-[290px]">
        <div className="max-w-xs">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/40">
            Map unavailable
          </span>
          <p className="mt-2 text-[12px] leading-relaxed text-[#0C1B33]/50">
            The Mapbox token (<code>NEXT_PUBLIC_MAPBOX_TOKEN</code>) is not configured, so the
            preview cannot render. The case counts above are complete without it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[260px] w-full overflow-hidden bg-white sm:h-[290px]">
      {/* REPO GOTCHA: mapbox-gl.css needs BOTH absolute inset-0 AND h-full w-full. */}
      <div ref={containerRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <span className="sr-only">
        {points.length === 0
          ? `No mapped matches in this case for ZIP ${zip}`
          : `Map of ${points.length} mapped matches in ZIP ${zip}`}
      </span>
      {points.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="border border-[#0C1B33]/12 bg-white/90 px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
            No mapped matches in this case
          </span>
        </div>
      )}
    </div>
  );
}
