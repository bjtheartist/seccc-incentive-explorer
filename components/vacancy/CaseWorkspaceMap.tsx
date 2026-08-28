"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import {
  INFRASTRUCTURE_LAYERS,
  infrastructureFeatures,
  infrastructureLayerId,
  infrastructureSourceId,
  loadStoredInfrastructureLayerVisibility,
  storeInfrastructureLayerVisibility,
  withInfrastructureLayerVisibility,
  type InfrastructureLayerConfig,
  type InfrastructureLayerId,
  type InfrastructureLayerVisibility,
} from "@/lib/shortlist-map-layers";
import type { VacancyCaseRecord } from "@/lib/vacancy-cases";
import {
  normalizeWorkspaceBounds,
  type VacancyWorkspaceBounds,
} from "@/lib/vacancy-workspace";

const INK = "#0C1B33";
const BUILDING = "#8A8A8A";
const SELECTED = "#DC2626";
const CHICAGO = { lat: 41.8781, lon: -87.6298 };
const SELECTED_LOCATION_ZOOM = 16;
const FIRST_RECORD_LAYER = "case-workspace-clusters";
const PROGRAMMATIC_MOVE_EVENT = { cieProgrammaticMove: true };

export interface CaseWorkspaceMapProps {
  zip: string;
  records: readonly VacancyCaseRecord[];
  selectedId: string | null;
  boundary: { rings: [number, number][][]; bbox: VacancyWorkspaceBounds } | null;
  centroid: { lat: number; lon: number } | null;
  committedBounds: VacancyWorkspaceBounds | null;
  onSelect: (id: string) => void;
  onCandidateBounds: (bounds: VacancyWorkspaceBounds) => void;
}

function toFeatureCollection(records: readonly VacancyCaseRecord[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: records
      .filter((record) => Number.isFinite(record.lat) && Number.isFinite(record.lon))
      .map((record) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [record.lon as number, record.lat as number],
        },
        properties: {
          id: record.id,
          address: record.address,
          universe: record.universe,
        },
      })),
  };
}

function recordsBbox(records: readonly VacancyCaseRecord[]): VacancyWorkspaceBounds | null {
  const mapped = records.filter(
    (record) => Number.isFinite(record.lat) && Number.isFinite(record.lon),
  );
  if (mapped.length === 0) return null;
  return [
    Math.min(...mapped.map((record) => record.lon as number)),
    Math.min(...mapped.map((record) => record.lat as number)),
    Math.max(...mapped.map((record) => record.lon as number)),
    Math.max(...mapped.map((record) => record.lat as number)),
  ];
}

export function selectedRecordCamera(
  record: VacancyCaseRecord,
  currentZoom: number,
): { center: [number, number]; zoom: number; duration: number } | null {
  if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return null;
  return {
    center: [record.lon as number, record.lat as number],
    zoom: Math.max(currentZoom, SELECTED_LOCATION_ZOOM),
    duration: 350,
  };
}

function overlayPopupHtml(label: string, layerLabel: string, color: string): string {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  return `<div style="font-family:Inter,sans-serif;max-width:240px">
    <div style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:${color};font-weight:600">${escape(layerLabel)}</div>
    <div style="font-size:12px;color:#0C1B33;margin-top:3px;line-height:1.35">${escape(label)}</div>
  </div>`;
}

function InfrastructureLayerControls({
  visibility,
  onToggle,
}: {
  visibility: InfrastructureLayerVisibility;
  onToggle: (id: InfrastructureLayerId) => void;
}) {
  return (
    <div data-testid="case-workspace-map-layers">
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
                  onChange={() => onToggle(layer.id)}
                  className="mt-[3px] h-3 w-3 shrink-0 accent-[#2563EB]"
                />
                <span
                  aria-hidden="true"
                  className="mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-full"
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
        Context only. Nearness to a layer is not a screening signal and does not make a record
        available.
      </p>
    </div>
  );
}

export default function CaseWorkspaceMap({
  zip,
  records,
  selectedId,
  boundary,
  centroid,
  committedBounds,
  onSelect,
  onCandidateBounds,
}: CaseWorkspaceMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const onCandidateBoundsRef = useRef(onCandidateBounds);
  const resizingRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [visibility, setVisibility] = useState<InfrastructureLayerVisibility>(() =>
    loadStoredInfrastructureLayerVisibility(),
  );
  const mountedRef = useRef(true);
  const visibilityRef = useRef(visibility);
  const overlayCacheRef = useRef<Map<InfrastructureLayerId, GeoJSON.Feature[]>>(new Map());
  const inFlightRef = useRef<Set<InfrastructureLayerId>>(new Set());

  const token =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN : undefined;
  const collection = useMemo(() => toFeatureCollection(records), [records]);
  const currentRecordsBox = useMemo(() => recordsBbox(records), [records]);
  const initialRef = useRef({ records, collection, boundary, centroid, committedBounds });

  useEffect(() => {
    visibilityRef.current = visibility;
  }, [visibility]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onCandidateBoundsRef.current = onCandidateBounds;
  }, [onCandidateBounds]);

  useEffect(() => {
    if (!containerRef.current || !token) return;
    const initial = initialRef.current;
    const initialBox = initial.committedBounds ?? recordsBbox(initial.records) ?? initial.boundary?.bbox;
    const center = initial.centroid ??
      (initialBox
        ? { lat: (initialBox[1] + initialBox[3]) / 2, lon: (initialBox[0] + initialBox[2]) / 2 }
        : CHICAGO);

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [center.lon, center.lat],
      zoom: 11.5,
      scrollZoom: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-left");
    mapRef.current = map;
    // Mobile List mode mounts this map inside `display:none`. Mapbox otherwise
    // keeps its 400x300 fallback canvas after the user switches to Map. Observe
    // the real container so every List/Map toggle produces an exact canvas fit.
    const resizeObserver = new ResizeObserver(() => {
      const container = containerRef.current;
      if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        resizingRef.current = true;
        map.resize();
        resizingRef.current = false;
      }
    });
    resizeObserver.observe(containerRef.current);

    map.on("load", () => {
      if (initial.boundary?.rings.length) {
        map.addSource("case-workspace-boundary", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: initial.boundary.rings },
            properties: {},
          },
        });
        map.addLayer({
          id: "case-workspace-boundary-line",
          type: "line",
          source: "case-workspace-boundary",
          paint: { "line-color": INK, "line-width": 1.5, "line-opacity": 0.6 },
        });
      }

      map.addSource("case-workspace-records", {
        type: "geojson",
        data: initial.collection,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 42,
      });
      map.addLayer({
        id: "case-workspace-clusters",
        type: "circle",
        source: "case-workspace-records",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": INK,
          "circle-opacity": 0.9,
          "circle-radius": ["step", ["get", "point_count"], 14, 25, 18, 100, 23],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "case-workspace-cluster-count",
        type: "symbol",
        source: "case-workspace-records",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-size": 10,
        },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "case-workspace-points",
        type: "circle",
        source: "case-workspace-records",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "universe"],
            "building_report",
            BUILDING,
            INK,
          ],
          "circle-radius": 5,
          "circle-opacity": 0.85,
          "circle-stroke-width": 1.2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "case-workspace-selected",
        type: "circle",
        source: "case-workspace-records",
        filter: ["==", ["get", "id"], ""],
        paint: {
          "circle-radius": 9,
          "circle-color": "rgba(255,255,255,0)",
          "circle-stroke-width": 3,
          "circle-stroke-color": SELECTED,
        },
      });

      map.on("click", "case-workspace-clusters", (event) => {
        const feature = map.queryRenderedFeatures(event.point, {
          layers: ["case-workspace-clusters"],
        })[0];
        if (!feature) return;
        const source = map.getSource("case-workspace-records") as mapboxgl.GeoJSONSource;
        source.getClusterExpansionZoom(feature.properties?.cluster_id, (error, zoom) => {
          if (error || zoom == null) return;
          map.easeTo(
            {
              center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
              zoom,
            },
            PROGRAMMATIC_MOVE_EVENT,
          );
        });
      });
      map.on("click", "case-workspace-points", (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") onSelectRef.current(id);
      });
      for (const layer of ["case-workspace-clusters", "case-workspace-points"]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }
      map.on("moveend", (event) => {
        if (
          resizingRef.current ||
          (event as { cieProgrammaticMove?: boolean }).cieProgrammaticMove === true
        ) {
          return;
        }
        const bounds = map.getBounds();
        if (!bounds) return;
        onCandidateBoundsRef.current(
          normalizeWorkspaceBounds([
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth(),
          ]),
        );
      });

      if (initialBox) {
        map.fitBounds(
          [
            [initialBox[0], initialBox[1]],
            [initialBox[2], initialBox[3]],
          ],
          { padding: 28, duration: 0, maxZoom: SELECTED_LOCATION_ZOOM },
          PROGRAMMATIC_MOVE_EVENT,
        );
      }
      setLoaded(true);
    });

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("case-workspace-records") as mapboxgl.GeoJSONSource | undefined;
    source?.setData(collection);
  }, [collection, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    map.setFilter("case-workspace-selected", ["==", ["get", "id"], selectedId ?? ""]);
    if (!selectedId) return;
    const record = records.find((item) => item.id === selectedId);
    if (!record) return;
    const camera = selectedRecordCamera(record, map.getZoom());
    if (!camera) return;
    map.easeTo(camera, PROGRAMMATIC_MOVE_EVENT);
  }, [loaded, records, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || selectedId) return;
    const box = committedBounds ?? currentRecordsBox ?? boundary?.bbox;
    if (!box) return;
    map.fitBounds(
      [
        [box[0], box[1]],
        [box[2], box[3]],
      ],
      { padding: 28, duration: 300, maxZoom: SELECTED_LOCATION_ZOOM },
      PROGRAMMATIC_MOVE_EVENT,
    );
  }, [boundary, committedBounds, currentRecordsBox, loaded, selectedId]);

  const drawOverlay = useCallback((map: mapboxgl.Map, layer: InfrastructureLayerConfig) => {
    const sourceId = infrastructureSourceId(layer.id);
    if (map.getSource(sourceId)) return;

    map.addSource(sourceId, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: overlayCacheRef.current.get(layer.id) ?? [],
      },
    });

    const beforeId = map.getLayer(FIRST_RECORD_LAYER) ? FIRST_RECORD_LAYER : undefined;
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
        popup
          .setLngLat(event.lngLat)
          .setHTML(overlayPopupHtml(label, layer.label, layer.color))
          .addTo(map);
      });
      map.on("mouseleave", interactiveId, () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

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

      inFlightRef.current.add(layer.id);
      void (async () => {
        let features: GeoJSON.Feature[] = [];
        try {
          if (layer.dataUrl === null) {
            features = infrastructureFeatures(layer.id, null);
          } else {
            const response = await fetch(layer.dataUrl, { cache: "force-cache" });
            if (response.ok) features = infrastructureFeatures(layer.id, await response.json());
          }
        } catch {
          features = [];
        }
        inFlightRef.current.delete(layer.id);
        if (!mountedRef.current) return;
        overlayCacheRef.current.set(layer.id, features);
        const live = mapRef.current;
        if (visibilityRef.current[layer.id] === true && live?.isStyleLoaded()) {
          drawOverlay(live, layer);
        }
      })();
    }
  }, [drawOverlay, loaded, visibility]);

  const toggleLayer = useCallback((id: InfrastructureLayerId) => {
    setVisibility((previous) => {
      const next = withInfrastructureLayerVisibility(previous, id, previous[id] !== true);
      storeInfrastructureLayerVisibility(next);
      return next;
    });
  }, []);

  if (!token) {
    return (
      <div className="flex h-full min-h-[480px] items-center justify-center bg-[#F0F1EE] px-6 text-center">
        <p className="max-w-sm text-[12px] leading-relaxed text-[#0C1B33]/50">
          The map is unavailable because the Mapbox token is not configured. The synchronized list
          and case filters remain available.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[480px] w-full bg-[#F0F1EE]">
      <div ref={containerRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <div className="pointer-events-auto absolute right-3 top-3 z-10 hidden max-h-[calc(100%-1.5rem)] w-[228px] overflow-y-auto border border-[#0C1B33]/15 bg-white/95 px-3 py-2.5 backdrop-blur-sm md:block">
        <InfrastructureLayerControls visibility={visibility} onToggle={toggleLayer} />
      </div>
      <div
        data-testid="case-workspace-mobile-layer-control"
        className="pointer-events-auto absolute right-3 top-14 z-10 md:hidden"
      >
        <button
          type="button"
          aria-expanded={mobileLayersOpen}
          aria-controls="case-workspace-mobile-layers"
          onClick={() => setMobileLayersOpen((open) => !open)}
          className="border border-[#0C1B33]/15 bg-white/95 px-3 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33] shadow-sm backdrop-blur-sm"
        >
          {mobileLayersOpen ? "Close layers" : "Map layers"}
        </button>
        {mobileLayersOpen ? (
          <div
            id="case-workspace-mobile-layers"
            className="mt-2 max-h-[420px] w-[228px] overflow-y-auto border border-[#0C1B33]/15 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur-sm"
          >
            <InfrastructureLayerControls visibility={visibility} onToggle={toggleLayer} />
          </div>
        ) : null}
      </div>
      <span className="sr-only">
        Map of {records.length.toLocaleString("en-US")} filtered vacancy records in ZIP {zip}
      </span>
    </div>
  );
}
