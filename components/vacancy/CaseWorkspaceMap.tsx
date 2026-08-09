"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { VacancyCaseRecord } from "@/lib/vacancy-cases";
import {
  normalizeWorkspaceBounds,
  type VacancyWorkspaceBounds,
} from "@/lib/vacancy-workspace";

const INK = "#0C1B33";
const BUILDING = "#8A8A8A";
const SELECTED = "#DC2626";
const CHICAGO = { lat: 41.8781, lon: -87.6298 };

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
  const readyForMoveRef = useRef(false);
  const suppressNextMoveRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  const token =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN : undefined;
  const collection = useMemo(() => toFeatureCollection(records), [records]);
  const initialRef = useRef({ records, collection, boundary, centroid, committedBounds });

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onCandidateBoundsRef.current = onCandidateBounds;
  }, [onCandidateBounds]);

  useEffect(() => {
    if (!containerRef.current || !token) return;
    const initial = initialRef.current;
    const initialBox = initial.committedBounds ?? initial.boundary?.bbox ?? recordsBbox(initial.records);
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
      scrollZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    // Mobile List mode mounts this map inside `display:none`. Mapbox otherwise
    // keeps its 400x300 fallback canvas after the user switches to Map. Observe
    // the real container so every List/Map toggle produces an exact canvas fit.
    const resizeObserver = new ResizeObserver(() => {
      const container = containerRef.current;
      if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        map.resize();
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
          map.easeTo({
            center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
            zoom,
          });
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
      map.on("moveend", () => {
        if (!readyForMoveRef.current) return;
        if (suppressNextMoveRef.current) {
          suppressNextMoveRef.current = false;
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
          { padding: 28, duration: 0 },
        );
      }
      map.once("idle", () => {
        readyForMoveRef.current = true;
      });
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
    if (!record || !Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return;
    suppressNextMoveRef.current = true;
    map.easeTo({ center: [record.lon as number, record.lat as number], duration: 350 });
  }, [loaded, records, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const box = committedBounds ?? boundary?.bbox ?? recordsBbox(initialRef.current.records);
    if (!box) return;
    suppressNextMoveRef.current = true;
    map.fitBounds(
      [
        [box[0], box[1]],
        [box[2], box[3]],
      ],
      { padding: 28, duration: 300 },
    );
  }, [boundary, committedBounds, loaded]);

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
      <span className="sr-only">
        Map of {records.length.toLocaleString("en-US")} filtered vacancy records in ZIP {zip}
      </span>
    </div>
  );
}
