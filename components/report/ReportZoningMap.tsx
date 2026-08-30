"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { ZONING_CATEGORIES } from "@/lib/constants";

// ─── Types ───────────────────────────────────────────────────────────

export interface ReportZoningMapProps {
  lat?: number | null;
  lon?: number | null;
  address?: string;
  className?: string;
}

const OTHER_COLOR = "#C7C7CC";

const CHICAGO_ZONING_URL =
  "https://data.cityofchicago.org/resource/dj47-wfun.geojson?$limit=50000";

// ─── Build Mapbox data-driven fill-color expression ──────────────────
// Checks longest prefixes first (PMD, POS, DX, DC, DS, RS, RT, RM, PD)
// before shorter ones (C, B, M, T) to avoid false matches.

function buildFillColorExpression(): mapboxgl.Expression {
  const zoneClassProp: mapboxgl.Expression = ["get", "zone_class"];

  const sortedEntries: { prefix: string; color: string }[] = [];
  for (const cat of ZONING_CATEGORIES) {
    for (const prefix of cat.prefixes) {
      sortedEntries.push({ prefix, color: cat.color });
    }
  }
  sortedEntries.sort((a, b) => b.prefix.length - a.prefix.length);

  const cases: mapboxgl.Expression = ["case"];
  for (const { prefix, color } of sortedEntries) {
    (cases as unknown[]).push(
      [
        "==",
        ["slice", ["to-string", zoneClassProp], 0, prefix.length],
        prefix,
      ],
      color
    );
  }
  (cases as unknown[]).push(OTHER_COLOR);

  return cases;
}

// ─── Component ───────────────────────────────────────────────────────

export default function ReportZoningMap({
  lat,
  lon,
  address,
  className = "",
}: ReportZoningMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);

  const hasLocation = lat != null && lon != null;
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  useEffect(() => {
    if (!mapboxToken) {
      setMapLoaded(true);
      return;
    }

    if (!containerRef.current) return;

    mapboxgl.accessToken = mapboxToken;

    if (!mapboxgl.supported({ failIfMajorPerformanceCaveat: true })) {
      setMapError(true);
      setMapLoaded(true);
      return;
    }

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        // Light/positron-style basemap — minimal labels, muted tones
        style: "mapbox://styles/mapbox/light-v11",
        center: hasLocation ? [lon!, lat!] : [-87.6298, 41.8481],
        zoom: hasLocation ? 14 : 10.5,
        scrollZoom: false,
        dragPan: true,
        dragRotate: false,
        pitchWithRotate: false,
        doubleClickZoom: false,
        touchZoomRotate: false,
      });
    } catch {
      setMapError(true);
      setMapLoaded(true);
      return;
    }

    mapRef.current = map;

    map.on("error", () => {
      setMapError(true);
      setMapLoaded(true);
    });

    // Navigation control (zoom only, no compass)
    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    // Marker for user's property
    if (hasLocation) {
      const el = document.createElement("div");
      el.innerHTML = `<svg width="28" height="40" viewBox="0 0 28 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.268 21.732 0 14 0z" fill="#0C1B33"/>
        <circle cx="14" cy="14" r="6" fill="#2563EB"/>
        <circle cx="14" cy="14" r="3" fill="white"/>
      </svg>`;
      el.style.cursor = "pointer";

      const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([lon!, lat!])
        .addTo(map);

      if (address) {
        const popup = new mapboxgl.Popup({
          maxWidth: "260px",
          className: "bureau-popup",
          offset: 30,
          closeButton: false,
        }).setHTML(
          `<div style="font-family:Inter,system-ui,sans-serif;padding:4px 0">
            <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#2563EB;margin-bottom:4px;font-weight:500">Property Location</div>
            <div style="font-size:13px;font-weight:600;color:#0C1B33;line-height:1.4">${address}</div>
          </div>`
        );
        marker.setPopup(popup).togglePopup();
      }
    }

    map.on("load", async () => {
      try {
        const res = await fetch(CHICAGO_ZONING_URL);
        if (!res.ok) throw new Error("Failed to fetch zoning data");
        const data = await res.json();

        map.addSource("chicago-zoning", {
          type: "geojson",
          data,
          generateId: true,
        });

        // Fill layer — bright saturated colors like 2nd City Zoning
        map.addLayer(
          {
            id: "zoning-fill",
            type: "fill",
            source: "chicago-zoning",
            paint: {
              "fill-color": buildFillColorExpression(),
              "fill-opacity": [
                "case",
                ["boolean", ["feature-state", "hover"], false],
                0.7,
                0.5,
              ],
            },
          },
          // Insert below labels
          "road-label-simple"
        );

        // Outline layer
        map.addLayer(
          {
            id: "zoning-outline",
            type: "line",
            source: "chicago-zoning",
            paint: {
              "line-color": "#ffffff",
              "line-width": [
                "case",
                ["boolean", ["feature-state", "hover"], false],
                1.5,
                0.3,
              ],
              "line-opacity": 0.6,
            },
          },
          "road-label-simple"
        );

        // ── Hover interactions ──
        let hoveredId: number | null = null;

        map.on("mousemove", "zoning-fill", (e) => {
          if (!e.features || e.features.length === 0) return;
          map.getCanvas().style.cursor = "pointer";

          // Clear previous hover
          if (hoveredId !== null) {
            map.setFeatureState(
              { source: "chicago-zoning", id: hoveredId },
              { hover: false }
            );
          }

          hoveredId = e.features[0].id as number;
          map.setFeatureState(
            { source: "chicago-zoning", id: hoveredId },
            { hover: true }
          );

          const zoneClass = e.features[0].properties?.zone_class || "Unknown";
          setHoveredZone(zoneClass);
        });

        map.on("mouseleave", "zoning-fill", () => {
          map.getCanvas().style.cursor = "";
          if (hoveredId !== null) {
            map.setFeatureState(
              { source: "chicago-zoning", id: hoveredId },
              { hover: false }
            );
            hoveredId = null;
          }
          setHoveredZone(null);
        });
      } catch {
        // Zoning data failed to load — map still renders without overlay
      }

      setMapLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [hasLocation, lat, lon, address, mapboxToken]);

  if (!mapboxToken) {
    return (
      <div className={`relative w-full ${className}`}>
        <div className="w-full min-h-[420px] bg-[#F0F1EE] border border-[#0C1B33]/10 flex items-center justify-center px-6">
          <div className="max-w-sm text-center">
            <div className="font-mono-bureau text-[9px] tracking-[0.22em] uppercase text-[#2563EB] mb-3">
              Location Snapshot
            </div>
            <div className="font-editorial text-2xl text-[#0C1B33] mb-3">
              {address || "Selected Chicago location"}
            </div>
            {hasLocation && (
              <div className="font-mono-bureau text-[10px] tracking-[0.08em] text-[#0C1B33]/45">
                {lat?.toFixed(5)}, {lon?.toFixed(5)}
              </div>
            )}
            <p className="text-sm text-[#0C1B33]/45 leading-relaxed mt-5">
              Add a Mapbox token to render the zoning map. Report data and
              saved-report workflows remain available without it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full ${className}`}>
      {/* Map container */}
      <div
        ref={containerRef}
        className="w-full"
        style={{ height: 420 }}
      />

      {mapError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#F0F1EE] px-6 text-center">
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/35 mb-2">
            Zoning map unavailable
          </span>
          <p className="text-[12px] text-[#0C1B33]/55 max-w-sm leading-relaxed">
            The report data still loaded. This browser could not initialize the interactive zoning map.
          </p>
        </div>
      )}

      {/* Loading placeholder */}
      {!mapLoaded && !mapError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#F0F1EE]/90 backdrop-blur-sm">
          <div className="flex items-center gap-1.5 mb-3">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="block w-1.5 h-1.5 bg-[#2563EB] rounded-full"
                style={{
                  animation: `bureau-pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30">
            Loading Chicago zoning data
          </span>
        </div>
      )}

      {/* Hovered zone tooltip — the tile's published zone_class alone. The
          gloss this used to append was Explorer-authored, and shown next to a
          City code it read as source content; for codes it had no entry for it
          printed the contentless "Zoning District" rather than admitting the
          lookup missed. MapView's zoning surfaces print the bare code for the
          same reason; this one matches so the same parcel cannot read two
          different ways. */}
      {hoveredZone && (
        <div className="absolute top-3 left-3 z-10 bg-[#0C1B33] text-white px-3 py-2 pointer-events-none max-w-[280px]">
          <span className="font-mono-bureau text-[11px] tracking-[0.08em] font-bold block">
            {hoveredZone}
          </span>
        </div>
      )}

      {/* Legend overlay */}
      {mapLoaded && (
        <div className="absolute bottom-3 left-3 z-10 bg-white/95 backdrop-blur-sm shadow-sm px-3.5 py-3">
          <div className="font-mono-bureau text-[7px] tracking-[0.25em] uppercase text-[#0C1B33]/35 mb-2.5">
            Chicago Zoning Districts
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
            {ZONING_CATEGORIES.map((cat) => (
              <div key={cat.key} className="flex items-center gap-2">
                <span
                  className="block w-3 h-3 flex-shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="font-mono-bureau text-[8px] tracking-[0.08em] text-[#0C1B33]/60 whitespace-nowrap">
                  {cat.label}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span
                className="block w-3 h-3 flex-shrink-0"
                style={{ backgroundColor: OTHER_COLOR }}
              />
              <span className="font-mono-bureau text-[8px] tracking-[0.08em] text-[#0C1B33]/60 whitespace-nowrap">
                Other
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Data attribution */}
      {mapLoaded && (
        <div className="absolute bottom-3 right-3 z-10">
          <span className="font-mono-bureau text-[7px] tracking-[0.1em] text-[#0C1B33]/20">
            Data: City of Chicago
          </span>
        </div>
      )}
    </div>
  );
}
