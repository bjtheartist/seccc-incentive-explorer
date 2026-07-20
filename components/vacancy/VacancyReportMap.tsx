"use client";

/**
 * VacancyReportMap — the live, clustered dot map that anchors the Vacancy
 * Opportunity Index WEB report (app/vacancy/[zip]/page.tsx). It is the
 * web-canonical echo of the PDF's static locator map, built on the same
 * CommuniData playbook the admin owner-cluster map uses (see
 * components/map/MapView.tsx lines ~1176–1275): a clustered GeoJSON source,
 * a match-expression color ramp keyed on ownerType, a ZIP boundary line
 * layer, numbered priority markers, and a collapsible owner-type legend.
 *
 * Raw mapbox-gl (repo convention — react-map-gl is NOT a dependency). All
 * data arrives as props from the server component; this component NEVER
 * fetches the multi-megabyte vacancy-index.json client-side. mapbox-gl's CSS
 * is imported globally in app/globals.css, so popups/controls are styled.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import {
  OWNER_TYPE_COLORS,
  OWNER_TYPE_LABELS,
  presentOwnerTypesInOrder,
  type OwnerType,
} from "@/lib/owner-classify";
import { trackEvent } from "@/lib/analytics-events";
import type {
  VacancyPriorityTier,
  VacancyPropertyType,
  VacancySiteIndexRow,
  VacancySitePoint,
} from "@/lib/vacancy-index";

const INK = "#111111";

const PROPERTY_TYPE_LABELS: Record<VacancyPropertyType, string> = {
  vacant_land: "Vacant Land",
  vacant_building: "Vacant Building",
};

const PRIORITY_TIER_LABELS: Record<VacancyPriorityTier, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface VacancyReportMapProps {
  zip: string;
  boundary: { rings: [number, number][][]; bbox: [number, number, number, number] } | null;
  bbox: [number, number, number, number] | null;
  centroid: { lat: number; lon: number };
  sitePoints: VacancySitePoint[];
  siteIndex: VacancySiteIndexRow[];
  /** The true total tracked-site count for the ZIP; sitePoints is capped at
   *  2000, so this drives the "SHOWING N OF TOTAL" honesty line. */
  totalCount: number;
}

export default function VacancyReportMap({
  zip,
  boundary,
  bbox,
  centroid,
  sitePoints,
  siteIndex,
  totalCount,
}: VacancyReportMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);

  const token =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN : undefined;

  // Owner types genuinely present in this edition's dots (OWNER_TYPE_ORDER).
  const presentTypes = useMemo(
    () => presentOwnerTypesInOrder(sitePoints.map((p) => p.ownerType)),
    [sitePoints],
  );

  // Live per-type counts for the legend (from the loaded points, not a query).
  const typeCounts = useMemo(() => {
    const counts = new Map<OwnerType, number>();
    for (const p of sitePoints) counts.set(p.ownerType, (counts.get(p.ownerType) ?? 0) + 1);
    return counts;
  }, [sitePoints]);

  const [activeTypes, setActiveTypes] = useState<Set<OwnerType>>(new Set());
  // Seed the active set once the present types are known (all on by default).
  useEffect(() => {
    setActiveTypes(new Set(presentTypes));
  }, [presentTypes]);

  const [legendOpen, setLegendOpen] = useState(true);

  // Fire the view event once on mount (client-side; mirrors the PDF button's
  // trackEvent shape and the funnel's other view events).
  useEffect(() => {
    trackEvent("vacancy_web_report_viewed", {
      source: "vacancy_web_report",
      metadata: { zip, siteCount: sitePoints.length, truncated: sitePoints.length < totalCount },
    });
    // Once per mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Latest props for the mount-once init effect (read through a ref so the
  // effect can stay dependency-free without going stale).
  const dataRef = useRef({ boundary, bbox, centroid, sitePoints, siteIndex });
  dataRef.current = { boundary, bbox, centroid, sitePoints, siteIndex };

  useEffect(() => {
    if (!containerRef.current || !token) return;

    const { boundary: bnd, bbox: bb, centroid: ctr, sitePoints: pts, siteIndex: idx } =
      dataRef.current;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [ctr.lon, ctr.lat],
      zoom: 12,
    });
    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    mapRef.current = map;

    // Join marker labels (address, next step) from siteIndex to the dots.
    const markerRows = idx.filter((r) => r.markerNumber != null);
    const markerByNumber = new Map<number, VacancySiteIndexRow>();
    for (const r of markerRows) if (r.markerNumber != null) markerByNumber.set(r.markerNumber, r);

    const dotFeatures: GeoJSON.Feature[] = pts.map((p) => {
      const joined = p.markerNumber != null ? markerByNumber.get(p.markerNumber) : undefined;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: {
          ownerType: p.ownerType,
          propertyType: p.propertyType,
          priorityTier: p.priorityTier,
          markerNumber: p.markerNumber ?? null,
          address: joined?.address ?? null,
          nextStep: joined?.nextStep ?? null,
        },
      };
    });

    const markerFeatures: GeoJSON.Feature[] = markerRows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lon, r.lat] },
      properties: {
        ownerType: r.ownerType,
        propertyType: r.propertyType,
        priorityTier: r.priorityTier,
        markerNumber: r.markerNumber,
        address: r.address,
        nextStep: r.nextStep,
      },
    }));

    map.on("load", () => {
      // ── Clustered dot source (CommuniData playbook) ──
      map.addSource("vacancy-sites", {
        type: "geojson",
        data: { type: "FeatureCollection", features: dotFeatures },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      map.addLayer({
        id: "vacancy-clusters",
        type: "circle",
        source: "vacancy-sites",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": INK,
          "circle-opacity": 0.9,
          "circle-radius": ["step", ["get", "point_count"], 16, 25, 22, 100, 28],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "vacancy-cluster-count",
        type: "symbol",
        source: "vacancy-sites",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-size": 12,
        },
        paint: { "text-color": "#ffffff" },
      });

      map.addLayer({
        id: "vacancy-unclustered",
        type: "circle",
        source: "vacancy-sites",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "ownerType"],
            "city_public", OWNER_TYPE_COLORS.city_public,
            "out_of_state", OWNER_TYPE_COLORS.out_of_state,
            "corporate_llc", OWNER_TYPE_COLORS.corporate_llc,
            "local_private", OWNER_TYPE_COLORS.local_private,
            OWNER_TYPE_COLORS.unknown,
          ],
          "circle-radius": 7,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      // ── ZIP boundary — the honest edition geography ──
      if (bnd && bnd.rings.length > 0) {
        map.addSource("vacancy-boundary", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: bnd.rings },
            properties: {},
          },
        });
        map.addLayer({
          id: "vacancy-boundary-line",
          type: "line",
          source: "vacancy-boundary",
          paint: { "line-color": INK, "line-width": 2 },
        });
      }

      // ── Numbered priority markers (distinct dark-disc + number overlay) ──
      map.addSource("vacancy-markers", {
        type: "geojson",
        data: { type: "FeatureCollection", features: markerFeatures },
      });
      map.addLayer({
        id: "vacancy-marker-disc",
        type: "circle",
        source: "vacancy-markers",
        paint: {
          "circle-color": INK,
          "circle-radius": 11,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "vacancy-marker-number",
        type: "symbol",
        source: "vacancy-markers",
        layout: {
          "text-field": ["to-string", ["get", "markerNumber"]],
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
          "text-size": 12,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff" },
      });

      // ── fitBounds to the edition bbox ──
      if (bb) {
        map.fitBounds(
          [
            [bb[0], bb[1]],
            [bb[2], bb[3]],
          ],
          { padding: 48, duration: 0 },
        );
      }

      // ── Popups ──
      const openSitePopup = (
        lngLat: mapboxgl.LngLatLike,
        p: Record<string, unknown>,
      ) => {
        const ownerType = (p.ownerType as OwnerType) ?? "unknown";
        const ownerLabel = OWNER_TYPE_LABELS[ownerType] ?? OWNER_TYPE_LABELS.unknown;
        const ownerColor = OWNER_TYPE_COLORS[ownerType] ?? OWNER_TYPE_COLORS.unknown;
        const propertyLabel =
          PROPERTY_TYPE_LABELS[p.propertyType as VacancyPropertyType] ?? "Vacant site";
        const tierLabel =
          PRIORITY_TIER_LABELS[p.priorityTier as VacancyPriorityTier] ?? "Priority n/a";
        const markerNumber = p.markerNumber == null ? null : Number(p.markerNumber);
        const address = typeof p.address === "string" ? p.address : null;
        const nextStep = typeof p.nextStep === "string" ? p.nextStep : null;

        const header =
          markerNumber != null && address
            ? `<div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#2563EB;margin-bottom:4px;font-weight:600">Priority site #${markerNumber}</div>
               <div style="font-size:13px;font-weight:600;color:#0C1B33">${escapeHtml(address)}</div>`
            : `<div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#8A93A6;margin-bottom:4px;font-weight:600">Tracked vacant site</div>
               <div style="font-size:13px;font-weight:600;color:#0C1B33">${escapeHtml(propertyLabel)}</div>`;

        const html = `<div style="font-family:Inter,sans-serif;min-width:180px">
          ${header}
          <span style="display:inline-block;margin-top:6px;background:${ownerColor}15;color:${ownerColor};border:1px solid ${ownerColor}30;padding:1px 6px;border-radius:2px;font-size:9px;font-weight:500">${escapeHtml(ownerLabel)}</span>
          <div style="font-size:11px;color:#5A6478;margin-top:8px">${escapeHtml(propertyLabel)} · ${escapeHtml(tierLabel)}</div>
          ${nextStep ? `<div style="font-size:11px;color:#8A93A6;margin-top:6px;line-height:1.35">${escapeHtml(nextStep)}</div>` : ""}
        </div>`;

        new mapboxgl.Popup({ maxWidth: "300px", className: "bureau-popup" })
          .setLngLat(lngLat)
          .setHTML(html)
          .addTo(map);
      };

      for (const layerId of ["vacancy-unclustered", "vacancy-marker-disc"]) {
        map.on("click", layerId, (e) => {
          if (!e.features?.length) return;
          openSitePopup(e.lngLat, e.features[0].properties ?? {});
        });
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      // Cluster click → expand (CommuniData pattern).
      map.on("click", "vacancy-clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["vacancy-clusters"] });
        if (!features.length) return;
        const clusterId = features[0].properties?.cluster_id;
        const src = map.getSource("vacancy-sites") as mapboxgl.GeoJSONSource;
        src.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || zoom == null) return;
          map.easeTo({
            center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
            zoom,
          });
        });
      });
      map.on("mouseenter", "vacancy-clusters", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "vacancy-clusters", () => {
        map.getCanvas().style.cursor = "";
      });

      setLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Mount-once: all data is read from dataRef; token drives the guard above.
  }, [token]);

  // ── Owner-type visibility toggles (layer filter expressions) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const active = Array.from(activeTypes);
    // "match" over the active list returns true for a kept type, false otherwise.
    const typeMatch =
      active.length === presentTypes.length
        ? null
        : (["match", ["get", "ownerType"], active.length ? active : ["__none__"], true, false] as unknown as mapboxgl.FilterSpecification);

    if (map.getLayer("vacancy-unclustered")) {
      map.setFilter(
        "vacancy-unclustered",
        typeMatch
          ? (["all", ["!", ["has", "point_count"]], typeMatch] as unknown as mapboxgl.FilterSpecification)
          : (["!", ["has", "point_count"]] as unknown as mapboxgl.FilterSpecification),
      );
    }
    for (const layerId of ["vacancy-marker-disc", "vacancy-marker-number"]) {
      if (map.getLayer(layerId)) {
        map.setFilter(layerId, typeMatch);
      }
    }
  }, [activeTypes, presentTypes, loaded]);

  function toggleType(type: OwnerType) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  const truncated = sitePoints.length < totalCount;

  if (!token) {
    return (
      <div className="flex h-[560px] w-full items-center justify-center border border-[#0C1B33]/15 bg-white text-center">
        <div className="max-w-sm px-6">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#0C1B33]/40">
            Map unavailable
          </span>
          <p className="mt-3 text-[13px] leading-relaxed text-[#0C1B33]/50">
            The Mapbox token (<code>NEXT_PUBLIC_MAPBOX_TOKEN</code>) is not configured, so the live
            site map cannot render. The report below is complete without it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[560px] w-full overflow-hidden border border-[#0C1B33]/15 bg-white">
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />

      {/* Collapsible owner-type legend (top-right) */}
      <div className="absolute right-3 top-3 z-10 w-[210px] border border-[#0C1B33]/15 bg-white/95 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setLegendOpen((o) => !o)}
          className="flex w-full items-center justify-between px-3 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/70"
        >
          <span>Owner type</span>
          <span className="text-[#0C1B33]/40">{legendOpen ? "–" : "+"}</span>
        </button>
        {legendOpen && (
          <div className="border-t border-[#0C1B33]/10 px-3 py-2.5">
            {presentTypes.length === 0 ? (
              <p className="text-[11px] text-[#0C1B33]/45">No sites plotted.</p>
            ) : (
              <ul className="space-y-1.5">
                {presentTypes.map((type) => {
                  const on = activeTypes.has(type);
                  return (
                    <li key={type}>
                      <button
                        type="button"
                        onClick={() => toggleType(type)}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <span
                          className="inline-block h-3 w-3 flex-shrink-0 rounded-full border"
                          style={{
                            backgroundColor: on ? OWNER_TYPE_COLORS[type] : "transparent",
                            borderColor: OWNER_TYPE_COLORS[type],
                          }}
                        />
                        <span
                          className={`flex-1 text-[11px] ${on ? "text-[#0C1B33]" : "text-[#0C1B33]/35 line-through"}`}
                        >
                          {OWNER_TYPE_LABELS[type]}
                        </span>
                        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/45">
                          {(typeCounts.get(type) ?? 0).toLocaleString("en-US")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-2.5 border-t border-[#0C1B33]/10 pt-2">
              <p className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
                {truncated
                  ? `Showing ${sitePoints.length.toLocaleString("en-US")} of ${totalCount.toLocaleString("en-US")}`
                  : `Showing all ${sitePoints.length.toLocaleString("en-US")} sites`}
              </p>
              <p className="mt-1.5 text-[10px] leading-snug text-[#0C1B33]/45">
                Numbered discs are the top {siteIndex.filter((r) => r.markerNumber != null).length}{" "}
                priority sites (see the site index below).
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
