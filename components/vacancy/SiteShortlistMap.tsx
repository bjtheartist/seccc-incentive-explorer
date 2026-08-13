"use client";

/**
 * SiteShortlistMap — the collapsible map panel above the Site Shortlist's tier
 * sections. It plots the SAME numbered records the cards below it list, and
 * adds an optional infrastructure lens (rail, expressways, airports, parks,
 * libraries, public schools, grocery) for the "what is around this?" question
 * every reader asks once they have a candidate in hand.
 *
 * Raw mapbox-gl, per repo convention — react-map-gl is NOT a dependency, and
 * mapbox-gl's CSS is imported globally in app/globals.css so popups and
 * controls are styled. The container carries explicit h-full/w-full inside a
 * fixed-height relative frame: mapbox's own CSS collapses a container that
 * doesn't, and a collapsed container renders a blank panel with no error.
 *
 * PAYLOAD DISCIPLINE (the point of the design, not a detail). Every overlay is
 * OFF by default and its file is fetched only on the FIRST toggle-on, then
 * cached in a ref for the life of the panel. A reader who never opens a toggle
 * downloads zero overlay bytes. PR #106 trimmed this app's map payload
 * deliberately; nothing here is allowed to hand that back.
 *
 * All of the pure logic — the layer catalog, the visibility record and its
 * sessionStorage round-trip, and every payload-to-feature transform — lives in
 * lib/shortlist-map-layers.ts and is unit-tested there. This file is the part
 * that only a real browser can exercise, which is exactly why it holds as
 * little decision-making as possible.
 *
 * SCREENING FRAMING IS UNCHANGED HERE. A pin's popup repeats the card's zoning
 * badge verbatim and nothing more; proximity to any overlay is context, never a
 * score, and no overlay implies a record is available, offered, or suitable.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import mapboxgl from "mapbox-gl";
import { trackEvent } from "@/lib/analytics-events";
import {
  BADGE_PIN_COLORS,
  INFRASTRUCTURE_LAYERS,
  infrastructureFeatures,
  infrastructureLayerId,
  infrastructureSourceId,
  loadStoredInfrastructureLayerVisibility,
  shortlistPinBounds,
  shortlistPinFeatures,
  storeInfrastructureLayerVisibility,
  withInfrastructureLayerVisibility,
  type InfrastructureLayerConfig,
  type InfrastructureLayerId,
  type InfrastructureLayerVisibility,
} from "@/lib/shortlist-map-layers";
import { ZONING_BADGE_LABELS, type RankedShortlistCandidate, type ZoningBadge } from "@/lib/shortlist-engine";
import { escapeHtml } from "./vacancy-site-card";

/** Badge display order for the legend — most-actionable first. */
const BADGE_ORDER: readonly ZoningBadge[] = [
  "aligned",
  "planned-development",
  "not-aligned",
  "unresolved",
];

const INK = "#111111";

/** The pin layer ids, kept in one place: every overlay is inserted BENEATH the
 *  first of these so a context dot can never cover a candidate. */
const PIN_DISC_LAYER = "shortlist-pin-disc";
const PIN_NUMBER_LAYER = "shortlist-pin-number";

const JUMP_ATTR = "data-shortlist-jump";

const NARROW_QUERY = "(max-width: 640px)";

function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function narrowSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

/** The server has no viewport, so it renders the desktop (expanded) default and
 *  React reconciles on hydration — the supported way to read a media query
 *  without a hydration mismatch or a setState-in-effect. */
function narrowServerSnapshot(): boolean {
  return false;
}

export interface SiteShortlistMapProps {
  zip: string;
  ranked: RankedShortlistCandidate[];
  /** Simplified ZIP ring + bbox from the vacancy edition; null renders no outline. */
  boundary: { rings: [number, number][][]; bbox: [number, number, number, number] } | null;
  centroid: { lat: number; lon: number };
}

function isZoningBadge(value: unknown): value is ZoningBadge {
  return value === "aligned" || value === "not-aligned" || value === "planned-development" || value === "unresolved";
}

/** The pin popup: address, badge, and the jump. */
function pinPopupHtml(props: Record<string, unknown>): string {
  const number = Number(props.markerNumber);
  const badge: ZoningBadge = isZoningBadge(props.badge) ? props.badge : "unresolved";
  const address = typeof props.address === "string" ? props.address : "This record";
  const zoningBadge = typeof props.zoningBadge === "string" ? props.zoningBadge : ZONING_BADGE_LABELS.unresolved;
  const domId = typeof props.domId === "string" ? props.domId : "";
  const color = BADGE_PIN_COLORS[badge].color;

  return `<div style="font-family:Inter,sans-serif;min-width:210px;max-width:280px">
    <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:${color};font-weight:600;margin-bottom:4px">
      ${String(number).padStart(2, "0")}
    </div>
    <div style="font-size:13px;font-weight:600;color:#0C1B33;line-height:1.3">${escapeHtml(address)}</div>
    <div style="margin-top:8px">
      <span style="display:inline-block;border:1px solid ${color};color:${color};padding:2px 6px;font-size:10px;letter-spacing:0.08em;text-transform:uppercase">${escapeHtml(zoningBadge)}</span>
    </div>
    <button type="button" ${JUMP_ATTR}="${escapeHtml(domId)}" style="margin-top:10px;background:none;border:none;padding:0;color:#2563EB;font-size:11px;font-family:inherit;text-decoration:underline;cursor:pointer">
      Jump to details ↓
    </button>
  </div>`;
}

/** Name-on-hover for every overlay. One popup instance, moved and refilled. */
function overlayPopupHtml(label: string, layerLabel: string, color: string): string {
  return `<div style="font-family:Inter,sans-serif;max-width:240px">
    <div style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:${color};font-weight:600">${escapeHtml(layerLabel)}</div>
    <div style="font-size:12px;color:#0C1B33;margin-top:3px;line-height:1.35">${escapeHtml(label)}</div>
  </div>`;
}

export default function SiteShortlistMap({ zip, ranked, boundary, centroid }: SiteShortlistMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Collapsed on narrow viewports, expanded on desktop — but only until the
  // reader says otherwise. Once they toggle it, their choice wins and the
  // viewport stops deciding, so a phone reader who opens the map keeps it open.
  const isNarrow = useSyncExternalStore(subscribeNarrow, narrowSnapshot, narrowServerSnapshot);
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride ?? !isNarrow;

  const [visibility, setVisibility] = useState<InfrastructureLayerVisibility>(() =>
    loadStoredInfrastructureLayerVisibility(),
  );

  const token =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN : undefined;

  const pinFeatures = useMemo(() => shortlistPinFeatures(ranked), [ranked]);
  const pinBounds = useMemo(() => shortlistPinBounds(pinFeatures), [pinFeatures]);

  /** Fetched overlay payloads, keyed by layer id. One fetch per layer per
   *  panel lifetime; a re-toggle re-reads this, never the network. */
  const overlayCacheRef = useRef<Map<InfrastructureLayerId, GeoJSON.Feature[]>>(new Map());
  /** Layers whose fetch is in flight, so a double-click cannot double-fetch. */
  const inFlightRef = useRef<Set<InfrastructureLayerId>>(new Set());

  // Latest props for the mount-once init effect, read through a ref so that
  // effect can stay dependency-free without going stale. Synced in an effect
  // (not during render) and declared BEFORE the init effect, so on mount it
  // has already run by the time the map is built.
  const dataRef = useRef({ boundary, centroid, pinFeatures, pinBounds });
  useEffect(() => {
    dataRef.current = { boundary, centroid, pinFeatures, pinBounds };
  }, [boundary, centroid, pinFeatures, pinBounds]);

  // ── Map init (mount-once; all data read through dataRef) ──────────────────
  useEffect(() => {
    if (!containerRef.current || !token) return;

    const { boundary: bnd, centroid: ctr, pinFeatures: pins, pinBounds: bounds } = dataRef.current;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [ctr.lon, ctr.lat],
      zoom: 12,
    });
    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    mapRef.current = map;

    map.on("load", () => {
      // ── ZIP boundary, from the same simplified ring the vacancy web report
      //    draws (edition.boundary). Added first so it sits under everything. ──
      if (bnd && bnd.rings.length > 0) {
        map.addSource("shortlist-boundary", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: bnd.rings },
            properties: {},
          },
        });
        map.addLayer({
          id: "shortlist-boundary-line",
          type: "line",
          source: "shortlist-boundary",
          paint: { "line-color": INK, "line-width": 2, "line-opacity": 0.55 },
        });
      }

      // ── The shortlist pins. Numbered exactly as the cards are. ──
      map.addSource("shortlist-pins", {
        type: "geojson",
        data: { type: "FeatureCollection", features: pins },
      });
      map.addLayer({
        id: PIN_DISC_LAYER,
        type: "circle",
        source: "shortlist-pins",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": 12,
          "circle-stroke-width": 2.5,
          "circle-stroke-color": ["get", "accent"],
        },
      });
      map.addLayer({
        id: PIN_NUMBER_LAYER,
        type: "symbol",
        source: "shortlist-pins",
        layout: {
          "text-field": ["to-string", ["get", "markerNumber"]],
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
          "text-size": 12,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff" },
      });

      if (bounds) {
        map.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          { padding: 64, duration: 0, maxZoom: 15 },
        );
      } else if (bnd) {
        map.fitBounds(
          [
            [bnd.bbox[0], bnd.bbox[1]],
            [bnd.bbox[2], bnd.bbox[3]],
          ],
          { padding: 48, duration: 0 },
        );
      }

      // ── Pin popup, with the scroll-to-card jump ──
      map.on("click", PIN_DISC_LAYER, (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const popup = new mapboxgl.Popup({ maxWidth: "300px", className: "bureau-popup" })
          .setLngLat(event.lngLat)
          .setHTML(pinPopupHtml(feature.properties ?? {}))
          .addTo(map);

        const jump = popup.getElement()?.querySelector<HTMLButtonElement>(`[${JUMP_ATTR}]`);
        jump?.addEventListener("click", () => {
          const domId = jump.getAttribute(JUMP_ATTR) ?? "";
          const target = domId ? document.getElementById(domId) : null;
          if (!target) return;
          popup.remove();
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          // A brief outline so the reader's eye lands on the right card after
          // the scroll, rather than somewhere in a wall of near-identical ones.
          target.setAttribute("data-shortlist-focused", "true");
          window.setTimeout(() => target.removeAttribute("data-shortlist-focused"), 2200);
        });
      });
      map.on("mouseenter", PIN_DISC_LAYER, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", PIN_DISC_LAYER, () => {
        map.getCanvas().style.cursor = "";
      });

      setLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setLoaded(false);
    };
    // Mount-once: everything else is read through dataRef; token drives the guard.
  }, [token]);

  // ── Keep the pin source in step if the rendered set ever changes ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("shortlist-pins") as mapboxgl.GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: pinFeatures });
  }, [pinFeatures, loaded]);

  /**
   * Draw one overlay's layers, wiring a shared hover popup. Called only after
   * that overlay's features are in the cache. Every layer is inserted BEFORE
   * the pin disc so the candidates always stay on top.
   */
  const drawOverlay = useCallback((map: mapboxgl.Map, layer: InfrastructureLayerConfig) => {
    const sourceId = infrastructureSourceId(layer.id);
    if (map.getSource(sourceId)) return;

    const features = overlayCacheRef.current.get(layer.id) ?? [];
    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features },
    });

    const beforeId = map.getLayer(PIN_DISC_LAYER) ? PIN_DISC_LAYER : undefined;
    const interactiveLayerIds: string[] = [];

    if (layer.geometry === "line") {
      const lineId = infrastructureLayerId(layer.id, "line");
      map.addLayer(
        {
          id: lineId,
          type: "line",
          source: sourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": layer.color, "line-width": 2.5, "line-opacity": 0.7 },
        },
        beforeId,
      );
      interactiveLayerIds.push(lineId);
    } else {
      const dotId = infrastructureLayerId(layer.id, "dot");
      map.addLayer(
        {
          id: dotId,
          type: "circle",
          source: sourceId,
          paint: {
            "circle-color": layer.color,
            "circle-radius": layer.shape === "static" ? 7 : 4.5,
            "circle-opacity": 0.85,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#ffffff",
          },
        },
        beforeId,
      );
      interactiveLayerIds.push(dotId);

      // The two airports are always labelled; the dense layers reveal their
      // labels only once the reader has zoomed in far enough to read them.
      map.addLayer(
        {
          id: infrastructureLayerId(layer.id, "label"),
          type: "symbol",
          source: sourceId,
          minzoom: layer.shape === "static" ? 0 : 14,
          layout: {
            "text-field": ["coalesce", ["get", "label"], ["get", "name"]],
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            "text-size": 10,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
          },
          paint: {
            "text-color": layer.color,
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5,
          },
        },
        beforeId,
      );
    }

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "bureau-popup",
      maxWidth: "260px",
    });

    for (const interactiveId of interactiveLayerIds) {
      map.on("mousemove", interactiveId, (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        map.getCanvas().style.cursor = "pointer";
        const props = feature.properties ?? {};
        const label =
          (typeof props.label === "string" && props.label) ||
          (typeof props.name === "string" && props.name) ||
          layer.label;
        popup.setLngLat(event.lngLat).setHTML(overlayPopupHtml(label, layer.label, layer.color)).addTo(map);
      });
      map.on("mouseleave", interactiveId, () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
    }
  }, []);

  // ── Lazy load + show/hide every overlay from the visibility record ────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    let cancelled = false;

    const setLayerVisibility = (layer: InfrastructureLayerConfig, visible: boolean) => {
      for (const suffix of ["line", "dot", "label"]) {
        const id = infrastructureLayerId(layer.id, suffix);
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      }
    };

    for (const layer of INFRASTRUCTURE_LAYERS) {
      const visible = visibility[layer.id] === true;

      if (!visible) {
        setLayerVisibility(layer, false);
        continue;
      }
      if (map.getSource(infrastructureSourceId(layer.id))) {
        setLayerVisibility(layer, true);
        continue;
      }
      if (overlayCacheRef.current.has(layer.id)) {
        drawOverlay(map, layer);
        continue;
      }
      if (inFlightRef.current.has(layer.id)) continue;

      // FIRST toggle-on for this layer: fetch its committed file now, cache the
      // transformed features, then draw. `dataUrl: null` (the airports) skips
      // the network entirely.
      inFlightRef.current.add(layer.id);
      void (async () => {
        let features: GeoJSON.Feature[] = [];
        try {
          if (layer.dataUrl === null) {
            features = infrastructureFeatures(layer.id, null);
          } else {
            const res = await fetch(layer.dataUrl, { cache: "force-cache" });
            if (res.ok) features = infrastructureFeatures(layer.id, await res.json());
          }
        } catch {
          // An unreachable overlay file is an empty layer, never a broken map
          // and never a fabricated dot. The reader can toggle it off again.
          features = [];
        }
        inFlightRef.current.delete(layer.id);
        if (cancelled) return;
        overlayCacheRef.current.set(layer.id, features);
        const live = mapRef.current;
        if (live && live.isStyleLoaded()) drawOverlay(live, layer);
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [visibility, loaded, drawOverlay]);

  const toggleLayer = useCallback(
    (id: InfrastructureLayerId) => {
      setVisibility((previous) => {
        const next = withInfrastructureLayerVisibility(previous, id, previous[id] !== true);
        storeInfrastructureLayerVisibility(next);
        trackEvent("site_shortlist_map_layer_toggled", {
          source: "site-shortlist",
          metadata: { zip, layer: id, enabled: next[id] === true },
        });
        return next;
      });
    },
    [zip],
  );

  const plottedByBadge = BADGE_ORDER.map((badge) => ({
    badge,
    count: pinFeatures.filter((f) => f.properties?.badge === badge).length,
  }));
  const unplottable = ranked.length - pinFeatures.length;

  return (
    <section className="mt-8 border border-[#0C1B33]/12 bg-white">
      <button
        type="button"
        onClick={() => setOpenOverride(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/70">
          Map of these candidates
        </span>
        <span className="flex items-center gap-3">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
            {pinFeatures.length} plotted
          </span>
          <span className="text-[#0C1B33]/40">{open ? "–" : "+"}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-[#0C1B33]/10">
          {!token ? (
            <div className="flex h-[220px] w-full items-center justify-center px-6 text-center">
              <p className="max-w-sm text-[13px] leading-relaxed text-[#0C1B33]/50">
                The Mapbox token (<code>NEXT_PUBLIC_MAPBOX_TOKEN</code>) is not configured, so this
                panel cannot render. The shortlist below is complete without it.
              </p>
            </div>
          ) : (
            <>
              <div className="relative h-[480px] w-full overflow-hidden">
                {/* h-full/w-full is load-bearing: mapbox-gl.css collapses a
                    container without an explicit size, and a collapsed
                    container paints nothing and reports no error. */}
                <div ref={containerRef} className="absolute inset-0 h-full w-full" />

                <div className="pointer-events-auto absolute right-3 top-3 z-10 max-h-[calc(100%-1.5rem)] w-[228px] overflow-y-auto border border-[#0C1B33]/15 bg-white/95 px-3 py-2.5 backdrop-blur-sm">
                  <p className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/40">
                    Shortlist
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {plottedByBadge.map(({ badge, count }) => (
                      <li key={badge} className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: BADGE_PIN_COLORS[badge].color }}
                        />
                        <span className="flex-1 text-[11px] text-[#0C1B33]/75">
                          {ZONING_BADGE_LABELS[badge]}
                        </span>
                        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/45">
                          {count}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 border-t border-[#0C1B33]/10 pt-2">
                    <p className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/40">
                      Infrastructure
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {INFRASTRUCTURE_LAYERS.map((layer) => {
                        const on = visibility[layer.id] === true;
                        return (
                          <li key={layer.id}>
                            <label className="flex cursor-pointer items-start gap-2">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleLayer(layer.id)}
                                className="mt-[3px] h-3 w-3 flex-shrink-0 accent-[#2563EB]"
                              />
                              <span
                                className="mt-[3px] inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                                style={{
                                  backgroundColor: on ? layer.color : "transparent",
                                  border: `1.5px solid ${layer.color}`,
                                }}
                              />
                              <span
                                className={`flex-1 text-[11px] leading-snug ${on ? "text-[#0C1B33]" : "text-[#0C1B33]/55"}`}
                              >
                                {layer.label}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 text-[10px] leading-snug text-[#0C1B33]/40">
                      Context only. Nearness to any of these is not a screening signal and does not
                      make a record available.
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#0C1B33]/10 px-4 py-3">
                <p className="text-[11px] leading-relaxed text-[#0C1B33]/50">
                  Numbered pins match the numbered cards below
                  {unplottable > 0
                    ? `; ${unplottable} record${unplottable === 1 ? "" : "s"} carr${unplottable === 1 ? "ies" : "y"} no usable coordinate and ${unplottable === 1 ? "is" : "are"} listed but not plotted`
                    : ""}
                  . Overlays load only when switched on.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
