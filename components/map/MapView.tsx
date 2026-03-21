"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import { ZONE_COLORS, ZONE_LABELS, ZONE_KEYS, ZONE_KEYS_SORTED, ZONE_META, ZONE_TILESET_IDS, ZONE_DESCRIPTIONS, ZONE_LEARN_MORE, ZONING_CATEGORIES, ZONING_CODE_DESCRIPTIONS, describeZoneClass, VACANT_COLORS, VACANT_LABELS } from "@/lib/constants";
import { runConfidenceEngine } from "@/lib/confidence-engine";
import { describeClassCode, describeParcelType, CLASS_CODE_MAP } from "@/lib/parcel-classes";
import type { Program, ProgramCheckResult, ParcelData, DistrictData } from "@/lib/types";
import MapSearch from "./MapSearch";
import { cachedFetch } from "@/lib/fetch-cache";

/* ── Zone file mapping (static fallback for keys without DB data) ───── */
const ZONE_FILES: Record<string, string> = {
  tif: "tif-districts.geojson",
  federalOZ: "federal-oz.geojson",
  enterprise: "enterprise-zones.geojson",
  stateIncentiveZones: "edge-zones.geojson",
  ssa: "special-service-areas.geojson",
  highUnemployment: "high-unemployment.geojson",
  landmarkDistricts: "landmark-districts.geojson",
  nrhpDistricts: "nrhp-districts.geojson",
  industrialCorridors: "industrial-corridors.geojson",
  microMarketRecovery: "micro-market-recovery.geojson",
  nof: "nof-projects.geojson",
  nmtcEligible: "nmtc-eligible.geojson",
  qct: "qct.geojson",
};

/** Zone keys that use Point geometry and need circle layers instead of fill/line. */
const POINT_ZONE_KEYS = new Set(["nof"]);

/** Helper: check if a zone should be hidden by default. */
function isZoneDefaultHidden(key: string): boolean {
  return !ZONE_META[key]?.defaultVisible;
}

/** Heavy-coverage layers get reduced opacity to avoid blocking the map. */
const HEAVY_COVERAGE_KEYS = new Set([
  "nmtcEligible", "qct", "landmarkDistricts", "nrhpDistricts",
  "highUnemployment", "industrialCorridors", "stateIncentiveZones",
]);

/** Chicago 77 community areas GeoJSON endpoint (Data Portal). */
const COMMUNITY_AREAS_URL = "https://data.cityofchicago.org/resource/igwz-8jzy.geojson?$limit=100";

/** Chicago zoning districts GeoJSON endpoint (Data Portal). */
const CHICAGO_ZONING_URL = "https://data.cityofchicago.org/resource/dj47-wfun.geojson?$limit=50000";

/** Empty GeoJSON FeatureCollection used as initial/cleared parcel data. */
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Cook County ArcGIS parcels endpoint (Layer 44). */
const PARCELS_QUERY_BASE =
  "https://gis.cookcountyil.gov/traditional/rest/services/cookVwrDynmc/MapServer/44/query";

function buildZoningColorExpression(): mapboxgl.Expression {
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
      ["==", ["slice", ["to-string", zoneClassProp], 0, prefix.length], prefix],
      color
    );
  }
  (cases as unknown[]).push("#C7C7CC");
  return cases;
}

/**
 * Load zone GeoJSON: DB API first (city-wide), static file fallback (SSA #50).
 */
/** Chicago bounding box — reject data outside this range (bad projections). */
const CHI_BOUNDS = { minLon: -88.0, maxLon: -87.4, minLat: 41.6, maxLat: 42.1 };

function isFeatureInChicago(feature: GeoJSON.Feature): boolean {
  try {
    const geom = feature.geometry;
    if (!geom || !("coordinates" in geom)) return false;
    const coords = JSON.stringify(geom.coordinates);
    // Quick scan: extract a few numbers and check range
    const nums = coords.match(/-?\d+\.\d+/g);
    if (!nums || nums.length < 2) return false;
    // Check first coordinate pair (lon, lat)
    const lon = parseFloat(nums[0]);
    const lat = parseFloat(nums[1]);
    return lon >= CHI_BOUNDS.minLon && lon <= CHI_BOUNDS.maxLon &&
           lat >= CHI_BOUNDS.minLat && lat <= CHI_BOUNDS.maxLat;
  } catch {
    return false;
  }
}

/** Module-level cache so toggling layers on/off/on is instant. */
const zoneGeoJSONCache = new Map<string, GeoJSON.FeatureCollection>();

async function fetchZoneGeoJSON(key: string): Promise<GeoJSON.FeatureCollection | null> {
  const cached = zoneGeoJSONCache.get(key);
  if (cached) return cached;

  try {
    const data = await cachedFetch<GeoJSON.FeatureCollection>(`/api/zones/geojson/${key}`);
    if (data?.features?.length > 0) {
      if (isFeatureInChicago(data.features[0])) {
        zoneGeoJSONCache.set(key, data);
        return data;
      }
      console.warn(`[MapView] DB data for "${key}" has out-of-range coordinates, falling back to static file`);
    }
  } catch {
    // Fall through to static
  }
  // Static fallback
  const file = ZONE_FILES[key];
  if (!file) return null;
  try {
    const data = await cachedFetch<GeoJSON.FeatureCollection>(`/data/zones/${file}`);
    if (data) {
      zoneGeoJSONCache.set(key, data);
      return data;
    }
  } catch {
    // No data available
  }
  return null;
}

/* ── POI layer config (Chicago Data Portal SODA) ─ */
interface PoiConfig {
  label: string;
  color: string;
  icon: string;
  format: "geojson" | "json";
  url: string;
  latField?: string;
  lonField?: string;
  nameField?: string;
}

const POI_LAYERS: Record<string, PoiConfig> = {
  ctaStations: {
    label: "CTA L Stations",
    color: "#e11d48",
    icon: "rail",
    format: "geojson",
    url: "https://data.cityofchicago.org/resource/8pix-ypme.geojson?$limit=400",
  },
  schools: {
    label: "K-12 Schools",
    color: "#d97706",
    icon: "school",
    format: "json",
    url: "https://data.cityofchicago.org/resource/kh4r-387c.json?$limit=800&$select=short_name,address,school_latitude,school_longitude,primary_category",
    latField: "school_latitude",
    lonField: "school_longitude",
    nameField: "short_name",
  },
  libraries: {
    label: "Libraries",
    color: "#7c3aed",
    icon: "library",
    format: "geojson",
    url: "https://data.cityofchicago.org/resource/x8fc-8rcq.geojson?$limit=100",
  },
};

/** Convert JSON array with lat/lon fields to GeoJSON FeatureCollection */
function jsonToGeoJSON(
  rows: Record<string, string>[],
  latField: string,
  lonField: string
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows
      .filter((r) => r[latField] && r[lonField])
      .map((r) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [parseFloat(r[lonField]), parseFloat(r[latField])],
        },
        properties: r,
      })),
  };
}

/* ── Neighborhood stats type ─────────────── */
interface AreaStats {
  medianHomePrice: string;
  medianIncome: string;
  walkScore: number;
  parcelPin?: string;
  parcelClass?: string;
  parcelClassDescription?: string;
  parcelValue?: string;
  parcelTaxCode?: string;
  parcelTownship?: string;
  parcelType?: string;
  districts?: DistrictData;
  districtsLoading?: boolean;
  // Assessment enrichment
  assessedLand?: number | null;
  assessedBuilding?: number | null;
  assessedTotal?: number | null;
  taxYear?: string | null;
  priorYearTax?: number | null;
}

const DEFAULT_STATS: AreaStats = {
  medianHomePrice: "$142,000",
  medianIncome: "$38,500",
  walkScore: 62,
};

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const searchMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [zoneVisible, setZoneVisible] = useState<Record<string, boolean>>(
    () => Object.fromEntries(ZONE_KEYS.map((k) => [k, false]))
  );
  const [poiVisible, setPoiVisible] = useState<Record<string, boolean>>(
    () => Object.fromEntries(Object.keys(POI_LAYERS).map((k) => [k, false]))
  );
  const [zoningVisible, setZoningVisible] = useState<Record<string, boolean>>(
    () => Object.fromEntries(ZONING_CATEGORIES.map((cat) => [cat.key, true]))
  );
  const [legendOpen, setLegendOpen] = useState(true);
  const [snapshotOpen, setSnapshotOpen] = useState(true);
  const [zoningRefOpen, setZoningRefOpen] = useState(false);
  const [classRefOpen, setClassRefOpen] = useState(false);
  const [zoningInfo, setZoningInfo] = useState<string | null>(null);
  const [areaStats, setAreaStats] = useState<AreaStats>(DEFAULT_STATS);
  const [snapshotLabel, setSnapshotLabel] = useState("Chicago (default)");
  const [expandedZone, setExpandedZone] = useState<string | null>(null);

  // Preset state
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [locationZones, setLocationZones] = useState<Record<string, boolean> | null>(null);

  // Inspect zoning mode
  const [inspectMode, setInspectMode] = useState(false);

  // Enhanced Area Snapshot
  const [snapshotPrograms, setSnapshotPrograms] = useState<ProgramCheckResult[]>([]);
  const [lastClickLat, setLastClickLat] = useState<number | null>(null);
  const [lastClickLon, setLastClickLon] = useState<number | null>(null);
  const [allPrograms, setAllPrograms] = useState<Program[]>([]);
  const [copiedLink, setCopiedLink] = useState(false);
  const [parcelsVisible, setParcelsVisible] = useState(false);
  const parcelsAbortRef = useRef<AbortController | null>(null);
  const parcelsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Vacant property layers
  const [vacantVisible, setVacantVisible] = useState<Record<string, boolean>>({
    vacantLand: false,
    vacantBuildings: false,
  });
  const [vacantLoaded, setVacantLoaded] = useState(false);
  const vacantAbortRef = useRef<AbortController | null>(null);
  const vacantTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load programs for snapshot
  useEffect(() => {
    cachedFetch<Program[]>("/data/programs.json")
      .then(setAllPrograms)
      .catch(() => {});
  }, []);

  /* ── Map Presets ──────────────────────────── */

  const MAP_PRESETS: { id: string; label: string; zones: string[] | "location" | "all" }[] = [
    { id: "location", label: "What Applies Here", zones: "location" },
    { id: "common", label: "Common Incentives", zones: ["tif", "federalOZ", "enterprise", "ssa"] },
    { id: "developer", label: "Developer Stack", zones: ["tif", "federalOZ", "nmtcEligible", "nrhpDistricts", "qct"] },
    { id: "historic", label: "Historic / Preservation", zones: ["landmarkDistricts", "nrhpDistricts", "tif"] },
    { id: "state", label: "State Programs", zones: ["stateIncentiveZones", "enterprise", "federalOZ"] },
    { id: "all", label: "All Layers", zones: "all" },
  ];

  const applyPreset = useCallback(
    (presetId: string) => {
      if (!mapRef.current || !loaded) return;
      const map = mapRef.current;
      const preset = MAP_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;

      // If clicking the same preset, deselect
      if (activePreset === presetId) {
        setActivePreset(null);
        return;
      }

      setActivePreset(presetId);

      let targetZones: Set<string>;

      if (preset.zones === "all") {
        targetZones = new Set(ZONE_KEYS);
      } else if (preset.zones === "location") {
        // Use zones from last click location
        targetZones = new Set(
          locationZones
            ? Object.entries(locationZones).filter(([, v]) => v).map(([k]) => k)
            : []
        );
      } else {
        targetZones = new Set(preset.zones);
      }

      const updated: Record<string, boolean> = {};
      for (const key of ZONE_KEYS) {
        const vis = targetZones.has(key);
        updated[key] = vis;
        if (map.getLayer(`zone-${key}-fill`)) {
          map.setLayoutProperty(`zone-${key}-fill`, "visibility", vis ? "visible" : "none");
          map.setLayoutProperty(`zone-${key}-line`, "visibility", vis ? "visible" : "none");
        }
      }
      setZoneVisible(updated);
    },
    [loaded, activePreset, locationZones]
  );

  /* ── Fetch area stats for a location ────── */
  const loadCensusForPoint = useCallback(async (lat: number, lon: number, label?: string) => {
    if (label) setSnapshotLabel(label);
    try {
      const [data, parcelData] = await Promise.all([
        cachedFetch<{
          medianHomeValue?: number;
          medianIncome?: number;
          walkScore?: number;
          tractId?: string;
        }>(`/api/census?lat=${lat}&lon=${lon}`).catch(() => null),
        cachedFetch<ParcelData>(`/api/parcel?lat=${lat}&lon=${lon}`).catch(() => null),
      ]);
      if (data) {
        setAreaStats({
          medianHomePrice: data.medianHomeValue
            ? `$${data.medianHomeValue.toLocaleString()}`
            : DEFAULT_STATS.medianHomePrice,
          medianIncome: data.medianIncome
            ? `$${data.medianIncome.toLocaleString()}`
            : DEFAULT_STATS.medianIncome,
          walkScore: data.walkScore ?? DEFAULT_STATS.walkScore,
          parcelPin: parcelData?.pin || undefined,
          parcelClass: parcelData?.classCode || undefined,
          parcelClassDescription: parcelData?.classDescription || undefined,
          parcelValue: parcelData?.totalValue || undefined,
          parcelTaxCode: parcelData?.taxCode || undefined,
          parcelTownship: parcelData?.township || undefined,
          parcelType: parcelData?.parcelType != null
            ? describeParcelType(parcelData.parcelType)
            : undefined,
          assessedLand: parcelData?.assessedLand,
          assessedBuilding: parcelData?.assessedBuilding,
          assessedTotal: parcelData?.assessedTotal,
          taxYear: parcelData?.taxYear,
          priorYearTax: parcelData?.priorYearTax,
          districtsLoading: true,
        });
        if (!label && data.tractId) {
          setSnapshotLabel(`Tract ${data.tractId}`);
        }

        // Async non-blocking fetch for political districts
        cachedFetch<DistrictData>(`/api/districts?lat=${lat}&lon=${lon}`)
          .then((districts) => {
            setAreaStats((prev) => ({ ...prev, districts, districtsLoading: false }));
          })
          .catch(() => {
            setAreaStats((prev) => ({ ...prev, districtsLoading: false }));
          });
      }
    } catch {
      // Keep defaults
    }
  }, []);

  // Store loadCensusForPoint in a ref so the map.on("load") closure can use it
  const loadCensusRef = useRef(loadCensusForPoint);
  loadCensusRef.current = loadCensusForPoint;

  // Handle click for location zones + top programs (with parcel boost)
  const handleMapClick = useCallback(
    async (lat: number, lon: number) => {
      setLastClickLat(lat);
      setLastClickLon(lon);
      setCopiedLink(false);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [data, parcelData]: [any, ParcelData | null] = await Promise.all([
          cachedFetch(`/api/zones/check?lat=${lat}&lon=${lon}`),
          cachedFetch<ParcelData>(`/api/parcel?lat=${lat}&lon=${lon}`).catch(() => null),
        ]);
        const zones = data.zones || data;
        const zoneNames = data.zoneNames || {};
        setLocationZones(zones);
        // Compute top 3 programs client-side (with parcel boost)
        if (allPrograms.length > 0) {
          const results = runConfidenceEngine(allPrograms, zones, zoneNames, undefined, parcelData ?? undefined);
          setSnapshotPrograms(
            results.filter((r) => r.confidence !== "not_applicable").slice(0, 3)
          );
        }
      } catch {
        // Keep defaults
      }
    },
    [allPrograms]
  );
  const lastClickRef = useRef(handleMapClick);
  lastClickRef.current = handleMapClick;

  /* ── Initial census load ──────────────── */
  useEffect(() => {
    loadCensusForPoint(41.744, -87.5775, "Chicago (default)");
  }, [loadCensusForPoint]);

  /* ── Initialize map ──────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      console.error("[MapView] NEXT_PUBLIC_MAPBOX_TOKEN is not set");
      setLoaded(true); // Show the UI without crashing
      return;
    }
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [-87.6298, 41.8481],
      zoom: 10.5,
      maxBounds: [
        [-88.0, 41.60],
        [-87.2, 42.10],
      ],
    });

    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    mapRef.current = map;

    map.on("load", async () => {
      /* ── Community Areas base layer (77 neighborhoods) ── */
      try {
        const caData = await cachedFetch(COMMUNITY_AREAS_URL);
        if (caData) {
          map.addSource("community-areas", { type: "geojson", data: caData as GeoJSON.FeatureCollection });

          // Outline boundaries
          map.addLayer({
            id: "community-areas-line",
            type: "line",
            source: "community-areas",
            paint: {
              "line-color": "#0C1B33",
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                9, 0.3,
                12, 0.8,
                14, 1.2,
              ],
              "line-opacity": 0.25,
              "line-dasharray": [3, 2],
            },
          });

          // Transparent fill for reliable click detection
          map.addLayer({
            id: "community-areas-fill",
            type: "fill",
            source: "community-areas",
            paint: {
              "fill-color": "#0C1B33",
              "fill-opacity": 0,
            },
          });

          // Neighborhood name labels
          map.addLayer({
            id: "community-areas-label",
            type: "symbol",
            source: "community-areas",
            layout: {
              "text-field": ["get", "community"],
              "text-size": [
                "interpolate", ["linear"], ["zoom"],
                9, 8,
                12, 11,
                14, 13,
              ],
              "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
              "text-transform": "uppercase",
              "text-letter-spacing": 0.08,
              "text-max-width": 8,
              "text-allow-overlap": false,
              "text-ignore-placement": false,
            },
            paint: {
              "text-color": "#0C1B33",
              "text-opacity": [
                "interpolate", ["linear"], ["zoom"],
                9, 0.15,
                11, 0.3,
                13, 0.45,
              ],
              "text-halo-color": "#ffffff",
              "text-halo-width": 1.5,
            },
          });
        }
      } catch {
        // Community areas layer is optional
      }

      /* Add zone layers — vector tiles if configured, else DB API, else static GeoJSON */
      const zoneLoadPromises = ZONE_KEYS.map(async (key) => {
        const srcId = `zone-${key}`;
        const tilesetId = ZONE_TILESET_IDS[key];

        // Heavy-coverage layers get reduced opacity so they don't block the whole map
        const baseOpacity = HEAVY_COVERAGE_KEYS.has(key) ? 0.08 : 0.18;
        const hoverOpacity = HEAVY_COVERAGE_KEYS.has(key) ? 0.2 : 0.4;

        if (tilesetId) {
          // City-wide vector tile source
          map.addSource(srcId, {
            type: "vector",
            url: `mapbox://${tilesetId}`,
          });

          map.addLayer({
            id: `${srcId}-fill`,
            type: "fill",
            source: srcId,
            "source-layer": key,
            layout: {
              visibility: "none",
            },
            paint: {
              "fill-color": ZONE_COLORS[key],
              "fill-opacity": [
                "case",
                ["boolean", ["feature-state", "hover"], false],
                hoverOpacity,
                baseOpacity,
              ],
            },
          });

          map.addLayer({
            id: `${srcId}-line`,
            type: "line",
            source: srcId,
            "source-layer": key,
            layout: {
              visibility: "none",
            },
            paint: {
              "line-color": ZONE_COLORS[key],
              "line-width": 1.5,
              "line-opacity": HEAVY_COVERAGE_KEYS.has(key) ? 0.5 : 0.8,
            },
          });
        } else {
          // DB API first (city-wide), then static fallback (SSA #50 clipped)
          const data = await fetchZoneGeoJSON(key);
          if (!data) return;

          map.addSource(srcId, {
            type: "geojson",
            data,
          });

          if (POINT_ZONE_KEYS.has(key)) {
            // Point geometry → circle + symbol layers
            map.addLayer({
              id: `${srcId}-fill`,
              type: "circle",
              source: srcId,
              layout: {
                visibility: "none",
              },
              paint: {
                "circle-radius": 8,
                "circle-color": ZONE_COLORS[key],
                "circle-stroke-width": 2,
                "circle-stroke-color": "#ffffff",
                "circle-opacity": 0.85,
              },
            });
            // Add a dummy line layer ID so toggle logic works (hidden, zero-width)
            map.addLayer({
              id: `${srcId}-line`,
              type: "circle",
              source: srcId,
              layout: {
                visibility: "none",
              },
              paint: {
                "circle-radius": 0,
                "circle-opacity": 0,
              },
            });
          } else {
            map.addLayer({
              id: `${srcId}-fill`,
              type: "fill",
              source: srcId,
              layout: {
                visibility: "none",
              },
              paint: {
                "fill-color": ZONE_COLORS[key],
                "fill-opacity": [
                  "case",
                  ["boolean", ["feature-state", "hover"], false],
                  hoverOpacity,
                  baseOpacity,
                ],
              },
            });

            map.addLayer({
              id: `${srcId}-line`,
              type: "line",
              source: srcId,
              layout: {
                visibility: "none",
              },
              paint: {
                "line-color": ZONE_COLORS[key],
                "line-width": 1.5,
                "line-opacity": HEAVY_COVERAGE_KEYS.has(key) ? 0.5 : 0.8,
              },
            });
          }
        }
      });

      await Promise.all(zoneLoadPromises);

      // Track which zone layers actually loaded (have sources on the map)
      const loadedZoneFillLayers = ZONE_KEYS
        .map((k) => `zone-${k}-fill`)
        .filter((id) => map.getLayer(id));

      /* Hover + click for zones */
      let hoveredId: string | number | null = null;
      let hoveredSource: string = "";

      map.on("mousemove", (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: loadedZoneFillLayers,
        });

        if (hoveredId !== null && hoveredSource) {
          map.setFeatureState(
            { source: hoveredSource, id: hoveredId },
            { hover: false }
          );
        }

        if (features.length > 0) {
          const f = features[0];
          hoveredSource = f.source ?? "";
          hoveredId = f.id ?? 0;
          map.setFeatureState(
            { source: hoveredSource, id: hoveredId },
            { hover: true }
          );
          map.getCanvas().style.cursor = "pointer";
        } else {
          hoveredId = null;
          hoveredSource = "";
          map.getCanvas().style.cursor = "";
        }
      });

      map.on("click", (e) => {
        /* Zone popup */
        const features = map.queryRenderedFeatures(e.point, {
          layers: loadedZoneFillLayers,
        });
        if (features.length > 0) {
          const props = features[0].properties || {};
          const sourceKey = (features[0].source ?? "").replace("zone-", "");
          const label = ZONE_LABELS[sourceKey] || sourceKey;
          const name = props.name || props.Name || props.NAME || "";
          new mapboxgl.Popup({ maxWidth: "260px", className: "bureau-popup" })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:Inter,sans-serif">
                <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#2563EB;margin-bottom:4px">${label}</div>
                ${name ? `<div style="font-size:14px;font-weight:600;color:#0C1B33">${name}</div>` : ""}
              </div>`
            )
            .addTo(map);
        }

        /* POI popup */
        const poiLayers = Object.keys(POI_LAYERS)
          .map((k) => `poi-${k}`)
          .filter((id) => map.getLayer(id));
        if (poiLayers.length > 0) {
          const poiFeats = map.queryRenderedFeatures(e.point, {
            layers: poiLayers,
          });
          if (poiFeats.length > 0) {
            const p = poiFeats[0].properties || {};
            const layerKey = (poiFeats[0].layer?.id ?? "").replace("poi-", "");
            const cfg = POI_LAYERS[layerKey];
            const nameField = cfg?.nameField;
            const name = (nameField ? p[nameField] : null) ||
              p.station_name || p.short_name || p.long_name ||
              p.name_ || p.Name || p.name || "";
            const addr = p.address || p.street_address || p.the_geom_address || "";
            new mapboxgl.Popup({ maxWidth: "260px", className: "bureau-popup" })
              .setLngLat(e.lngLat)
              .setHTML(
                `<div style="font-family:Inter,sans-serif">
                  <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:${cfg.color};margin-bottom:4px">${cfg.label}</div>
                  ${name ? `<div style="font-size:14px;font-weight:600;color:#0C1B33">${name}</div>` : ""}
                  ${addr ? `<div style="font-size:12px;color:#5A6478;margin-top:2px">${addr}</div>` : ""}
                </div>`
              )
              .addTo(map);
          }
        }

        /* Resolve community area name for Area Snapshot label + zoom to neighborhood */
        // Skip community-area zoom if the click landed on a parcel
        const clickedParcel = map.getLayer("parcels-fill")
          ? map.queryRenderedFeatures(e.point, { layers: ["parcels-fill"] }).length > 0
          : false;

        let areaLabel: string | undefined;
        if (map.getLayer("community-areas-fill")) {
          const caFeats = map.queryRenderedFeatures(e.point, {
            layers: ["community-areas-fill"],
          });
          if (caFeats.length > 0) {
            const community = caFeats[0].properties?.community;
            if (community) {
              areaLabel = community
                .toLowerCase()
                .replace(/\b\w/g, (c: string) => c.toUpperCase());

              // Zoom to the community area boundary (skip when clicking a parcel or already at parcel zoom)
              if (!clickedParcel && map.getZoom() < 15) {
                const geometry = caFeats[0].geometry;
                if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
                  const coords =
                    geometry.type === "Polygon"
                      ? geometry.coordinates.flat()
                      : geometry.coordinates.flat(2);
                  if (coords.length > 0) {
                    const bounds = new mapboxgl.LngLatBounds();
                    for (const c of coords) {
                      bounds.extend(c as [number, number]);
                    }
                    map.fitBounds(bounds, { padding: 60, duration: 1200, maxZoom: 14.5 });
                  }
                }
              }
            }
          }
        }

        /* Update Area Snapshot census data for clicked point */
        loadCensusRef.current(e.lngLat.lat, e.lngLat.lng, areaLabel);

        /* Update last click coords for snapshot actions */
        lastClickRef.current(e.lngLat.lat, e.lngLat.lng);
      });

      /* ── Chicago Zoning Districts — per-category layers (on top of incentive zones) ── */
      try {
        const zoningData = await cachedFetch(CHICAGO_ZONING_URL);
        if (zoningData) {
          map.addSource("chicago-zoning", { type: "geojson", data: zoningData as GeoJSON.FeatureCollection, generateId: true });

          // Create a separate fill + outline layer per zoning category
          for (const cat of ZONING_CATEGORIES) {
            // Build a filter that matches features whose zone_class starts with any of the category's prefixes
            const prefixFilters = cat.prefixes.map((p) => [
              "==",
              ["slice", ["to-string", ["get", "zone_class"]], 0, p.length],
              p,
            ]);
            const filter: mapboxgl.Expression =
              prefixFilters.length === 1
                ? (prefixFilters[0] as mapboxgl.Expression)
                : (["any", ...prefixFilters] as mapboxgl.Expression);

            map.addLayer({
              id: `zoning-${cat.key}-fill`,
              type: "fill",
              source: "chicago-zoning",
              filter,
              layout: { visibility: "visible" },
              paint: {
                "fill-color": cat.color,
                "fill-opacity": [
                  "case",
                  ["boolean", ["feature-state", "hover"], false],
                  0.65,
                  0.45,
                ],
              },
            });

            map.addLayer({
              id: `zoning-${cat.key}-line`,
              type: "line",
              source: "chicago-zoning",
              filter,
              layout: { visibility: "visible" },
              paint: {
                "line-color": "#ffffff",
                "line-width": 0.3,
                "line-opacity": 0.5,
              },
            });
          }

          // Hover interaction across all zoning fill layers
          const zoningFillLayers = ZONING_CATEGORIES.map((c) => `zoning-${c.key}-fill`);
          let hoveredZoningId: number | null = null;

          for (const layerId of zoningFillLayers) {
            map.on("mousemove", layerId, (e) => {
              if (!e.features?.length) return;
              if (hoveredZoningId !== null) {
                map.setFeatureState({ source: "chicago-zoning", id: hoveredZoningId }, { hover: false });
              }
              hoveredZoningId = e.features[0].id as number;
              map.setFeatureState({ source: "chicago-zoning", id: hoveredZoningId }, { hover: true });
              map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", layerId, () => {
              if (hoveredZoningId !== null) {
                map.setFeatureState({ source: "chicago-zoning", id: hoveredZoningId }, { hover: false });
                hoveredZoningId = null;
              }
            });

            // Click popup — show code + human-readable description
            map.on("click", layerId, (e) => {
              if (!e.features?.length) return;
              const props = e.features[0].properties || {};
              const zoneClass = props.zone_class || "Unknown";
              const description = describeZoneClass(zoneClass);
              new mapboxgl.Popup({ maxWidth: "300px", className: "bureau-popup" })
                .setLngLat(e.lngLat)
                .setHTML(
                  `<div style="font-family:Inter,sans-serif">
                    <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#059669;margin-bottom:4px;font-weight:500">Zoning District</div>
                    <div style="font-size:18px;font-weight:700;color:#0C1B33;letter-spacing:-0.01em">${zoneClass}</div>
                    <div style="font-size:12px;color:#5A6478;margin-top:4px;line-height:1.4">${description}</div>
                  </div>`
                )
                .addTo(map);
            });
          }
        }
      } catch {
        // Zoning districts layer is optional
      }

      /* ── Parcel boundary layer (Cook County ArcGIS) ── */
      map.addSource("parcels", { type: "geojson", data: EMPTY_FC, generateId: true });

      map.addLayer({
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        layout: { visibility: "none" },
        paint: {
          "fill-color": "#7C3AED",
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.15,
            0,
          ],
        },
      });

      map.addLayer({
        id: "parcels-line",
        type: "line",
        source: "parcels",
        layout: { visibility: "none" },
        paint: {
          "line-color": "#7C3AED",
          "line-width": 0.8,
          "line-opacity": 0.5,
        },
      });

      // Parcel hover
      let hoveredParcelId: number | null = null;
      map.on("mousemove", "parcels-fill", (e) => {
        if (!e.features?.length) return;
        if (hoveredParcelId !== null) {
          map.setFeatureState({ source: "parcels", id: hoveredParcelId }, { hover: false });
        }
        hoveredParcelId = e.features[0].id as number;
        map.setFeatureState({ source: "parcels", id: hoveredParcelId }, { hover: true });
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "parcels-fill", () => {
        if (hoveredParcelId !== null) {
          map.setFeatureState({ source: "parcels", id: hoveredParcelId }, { hover: false });
          hoveredParcelId = null;
        }
        map.getCanvas().style.cursor = "";
      });

      // Parcel click popup
      map.on("click", "parcels-fill", (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties || {};
        const pin = p.PIN14 || "";
        const bldg = p.BLDGClass || "";
        const classDesc = bldg ? describeClassCode(bldg) : "";
        const val = p.TotalValue ? `$${Number(p.TotalValue).toLocaleString()}` : "";
        const addr = p.Address || "";
        new mapboxgl.Popup({ maxWidth: "280px", className: "bureau-popup" })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:Inter,sans-serif">
              <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#7C3AED;margin-bottom:4px;font-weight:500">Parcel</div>
              ${pin ? `<div style="font-size:14px;font-weight:600;color:#0C1B33"><a href="https://www.cookcountyassessoril.gov/pin/${pin}" target="_blank" rel="noopener noreferrer" style="color:#2563EB;text-decoration:underline">${pin}</a></div>` : ""}
              ${addr ? `<div style="font-size:12px;color:#5A6478;margin-top:3px">${addr}</div>` : ""}
              ${bldg ? `<div style="font-size:11px;color:#5A6478;margin-top:2px">Class: ${bldg}</div>` : ""}
              ${classDesc ? `<div style="font-size:10px;color:#5A6478;margin-top:1px;font-style:italic">${classDesc}</div>` : ""}
              ${val ? `<div style="font-size:11px;color:#5A6478;margin-top:2px">Assessed: ${val}</div>` : ""}
            </div>`
          )
          .addTo(map);
      });

      /* ── Vacant Properties layer (clustered GeoJSON) ── */
      map.addSource("vacant-properties", {
        type: "geojson",
        data: EMPTY_FC,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Cluster circles
      map.addLayer({
        id: "vacant-clusters",
        type: "circle",
        source: "vacant-properties",
        filter: ["has", "point_count"],
        layout: { visibility: "none" },
        paint: {
          "circle-color": [
            "step", ["get", "point_count"],
            VACANT_COLORS.vacantLand,
            10, "#B91C1C",
            50, "#991B1B",
          ],
          "circle-radius": [
            "step", ["get", "point_count"],
            15, 10, 20, 50, 28,
          ],
          "circle-opacity": 0.85,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Cluster count labels
      map.addLayer({
        id: "vacant-cluster-count",
        type: "symbol",
        source: "vacant-properties",
        filter: ["has", "point_count"],
        layout: {
          visibility: "none",
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-size": 12,
        },
        paint: { "text-color": "#ffffff" },
      });

      // Unclustered points
      map.addLayer({
        id: "vacant-unclustered",
        type: "circle",
        source: "vacant-properties",
        filter: ["!", ["has", "point_count"]],
        layout: { visibility: "none" },
        paint: {
          "circle-radius": 7,
          "circle-color": [
            "match", ["get", "propertyType"],
            "vacant_land", VACANT_COLORS.vacantLand,
            "vacant_building", VACANT_COLORS.vacantBuildings,
            "vacant_storefront", VACANT_COLORS.vacantBuildings,
            VACANT_COLORS.vacantLand,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.9,
        },
      });

      // Click handler for unclustered vacant points
      map.on("click", "vacant-unclustered", (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties || {};
        const zoneMatches = typeof p.zoneMatches === "string" ? JSON.parse(p.zoneMatches) : (p.zoneMatches || []);
        const badges = zoneMatches.map((z: { zoneKey: string; zoneName: string }) =>
          `<span style="display:inline-block;background:${ZONE_COLORS[z.zoneKey] || '#6B7280'}20;color:${ZONE_COLORS[z.zoneKey] || '#6B7280'};border:1px solid ${ZONE_COLORS[z.zoneKey] || '#6B7280'}40;padding:1px 6px;border-radius:2px;font-size:9px;margin:2px 2px 0 0">${ZONE_LABELS[z.zoneKey] || z.zoneName}</span>`
        ).join("");

        const addr = p.address || "Unknown Address";
        const sqft = p.squareFeet ? `${Number(p.squareFeet).toLocaleString()} sq ft` : "";
        const ward = p.ward ? `Ward ${p.ward}` : "";
        const meta = [sqft, ward].filter(Boolean).join(" · ");

        new mapboxgl.Popup({ maxWidth: "300px", className: "bureau-popup" })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:Inter,sans-serif">
              <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:${VACANT_COLORS.vacantLand};margin-bottom:4px;font-weight:500">Vacant Property</div>
              <div style="font-size:14px;font-weight:600;color:#0C1B33">${addr}</div>
              ${meta ? `<div style="font-size:11px;color:#5A6478;margin-top:3px">${meta}</div>` : ""}
              ${badges ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap">${badges}</div>` : ""}
              ${p.incentiveCount > 0 ? `<div style="font-size:10px;color:#059669;margin-top:6px;font-weight:500">${p.incentiveCount} incentive zone${p.incentiveCount > 1 ? "s" : ""} overlap</div>` : ""}
              <a href="https://www.cookcountyassessoril.gov/pin/${p.id?.replace("cols-", "")}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;font-size:10px;color:#2563EB;text-decoration:underline">View on Cook County Assessor →</a>
            </div>`
          )
          .addTo(map);
      });

      // Click on cluster to zoom in
      map.on("click", "vacant-clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["vacant-clusters"] });
        if (!features.length) return;
        const clusterId = features[0].properties?.cluster_id;
        const src = map.getSource("vacant-properties") as mapboxgl.GeoJSONSource;
        src.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.easeTo({
            center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
            zoom: zoom!,
          });
        });
      });

      // Cursor on hover
      map.on("mouseenter", "vacant-clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "vacant-clusters", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "vacant-unclustered", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "vacant-unclustered", () => { map.getCanvas().style.cursor = ""; });

      setLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* ── Toggle zone visibility ────────────── */
  const toggleZone = useCallback(
    (key: string) => {
      if (!mapRef.current || !loaded) return;
      const map = mapRef.current;
      // Only toggle if layer exists on the map
      if (!map.getLayer(`zone-${key}-fill`)) return;
      const next = !zoneVisible[key];
      setZoneVisible((prev) => ({ ...prev, [key]: next }));
      const vis = next ? "visible" : "none";
      map.setLayoutProperty(`zone-${key}-fill`, "visibility", vis);
      map.setLayoutProperty(`zone-${key}-line`, "visibility", vis);
      // Manual toggle clears preset highlight
      setActivePreset(null);
    },
    [loaded, zoneVisible]
  );

  /* ── Toggle POI visibility (lazy-load) ─── */
  const togglePoi = useCallback(
    (key: string) => {
      if (!mapRef.current || !loaded) return;
      const map = mapRef.current;
      const next = !poiVisible[key];
      setPoiVisible((prev) => ({ ...prev, [key]: next }));

      if (next && !map.getSource(`poi-${key}`)) {
        const cfg = POI_LAYERS[key];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cachedFetch<any>(cfg.url)
          .then((raw: any) => {
            if (!mapRef.current) return;
            const data =
              cfg.format === "json"
                ? jsonToGeoJSON(raw, cfg.latField!, cfg.lonField!)
                : raw;
            mapRef.current.addSource(`poi-${key}`, {
              type: "geojson",
              data,
            });
            mapRef.current.addLayer({
              id: `poi-${key}`,
              type: "circle",
              source: `poi-${key}`,
              paint: {
                "circle-radius": 5,
                "circle-color": cfg.color,
                "circle-stroke-width": 1.5,
                "circle-stroke-color": "#ffffff",
                "circle-opacity": 0.85,
              },
            });
          })
          .catch(() => {
            setPoiVisible((prev) => ({ ...prev, [key]: false }));
          });
      } else if (map.getLayer(`poi-${key}`)) {
        map.setLayoutProperty(
          `poi-${key}`,
          "visibility",
          next ? "visible" : "none"
        );
      }
    },
    [loaded, poiVisible]
  );

  /* ── Toggle individual zoning category ─── */
  const toggleZoningCategory = useCallback(
    (catKey: string) => {
      if (!mapRef.current || !loaded) return;
      const map = mapRef.current;
      const next = !zoningVisible[catKey];
      setZoningVisible((prev) => ({ ...prev, [catKey]: next }));
      const vis = next ? "visible" : "none";
      if (map.getLayer(`zoning-${catKey}-fill`)) {
        map.setLayoutProperty(`zoning-${catKey}-fill`, "visibility", vis);
        map.setLayoutProperty(`zoning-${catKey}-line`, "visibility", vis);
      }
    },
    [loaded, zoningVisible]
  );

  /* ── Toggle all zoning categories at once ── */
  const toggleAllZoning = useCallback(() => {
    if (!mapRef.current || !loaded) return;
    const map = mapRef.current;
    const anyVisible = Object.values(zoningVisible).some(Boolean);
    const next = !anyVisible;
    const vis = next ? "visible" : "none";
    const updated: Record<string, boolean> = {};
    for (const cat of ZONING_CATEGORIES) {
      updated[cat.key] = next;
      if (map.getLayer(`zoning-${cat.key}-fill`)) {
        map.setLayoutProperty(`zoning-${cat.key}-fill`, "visibility", vis);
        map.setLayoutProperty(`zoning-${cat.key}-line`, "visibility", vis);
      }
    }
    setZoningVisible(updated);
  }, [loaded, zoningVisible]);

  /* ── Inspect zoning mode cursor ──────── */
  useEffect(() => {
    if (!mapRef.current || !loaded) return;
    const map = mapRef.current;
    if (inspectMode) {
      map.getCanvas().style.cursor = "crosshair";
    }
    return () => {
      if (mapRef.current) {
        mapRef.current.getCanvas().style.cursor = "";
      }
    };
  }, [loaded, inspectMode]);

  /* ── Inspect zoning on click ──────────── */
  useEffect(() => {
    if (!mapRef.current || !loaded || !inspectMode) return;
    const map = mapRef.current;

    const inspectHandler = async (e: mapboxgl.MapMouseEvent) => {
      setZoningInfo("Loading...");
      try {
        const data = await cachedFetch<{ zoneClass?: string }>(
          `/api/zoning?lat=${e.lngLat.lat}&lon=${e.lngLat.lng}`
        );
        if (data.zoneClass) {
          const desc = describeZoneClass(data.zoneClass);
          setZoningInfo(`${data.zoneClass} — ${desc}`);
          new mapboxgl.Popup({ maxWidth: "300px", className: "bureau-popup" })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:Inter,sans-serif">
                <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#059669;margin-bottom:4px;font-weight:500">Zoning Classification</div>
                <div style="font-size:18px;font-weight:700;color:#0C1B33;letter-spacing:-0.01em">${data.zoneClass}</div>
                <div style="font-size:12px;color:#5A6478;margin-top:4px;line-height:1.4">${desc}</div>
              </div>`
            )
            .addTo(map);
        }
      } catch {
        setZoningInfo(null);
      }
    };

    map.on("click", inspectHandler);
    return () => {
      map.off("click", inspectHandler);
    };
  }, [loaded, inspectMode]);

  /* ── Zoning lookup on right-click ──────── */
  useEffect(() => {
    if (!mapRef.current || !loaded) return;
    const map = mapRef.current;

    const handler = async (e: mapboxgl.MapMouseEvent) => {
      setZoningInfo("Loading...");
      try {
        const data = await cachedFetch<{ zoneClass?: string }>(
          `/api/zoning?lat=${e.lngLat.lat}&lon=${e.lngLat.lng}`
        );
        if (data.zoneClass) {
          const desc = describeZoneClass(data.zoneClass);
          setZoningInfo(`${data.zoneClass} — ${desc}`);
          new mapboxgl.Popup({ maxWidth: "300px", className: "bureau-popup" })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:Inter,sans-serif">
                <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#059669;margin-bottom:4px;font-weight:500">Zoning Classification</div>
                <div style="font-size:18px;font-weight:700;color:#0C1B33;letter-spacing:-0.01em">${data.zoneClass}</div>
                <div style="font-size:12px;color:#5A6478;margin-top:4px;line-height:1.4">${desc}</div>
              </div>`
            )
            .addTo(map);
        } else {
          setZoningInfo(null);
        }
      } catch {
        setZoningInfo(null);
      }
    };

    map.on("contextmenu", handler);
    return () => {
      map.off("contextmenu", handler);
    };
  }, [loaded]);

  /* ── Search result handler ─────────────── */
  const handleSearchResult = useCallback(
    (result: { lat: number; lon: number; label: string }) => {
      if (!mapRef.current) return;
      const map = mapRef.current;

      // Remove previous search marker
      if (searchMarkerRef.current) {
        searchMarkerRef.current.remove();
      }

      // Fly to location
      map.flyTo({
        center: [result.lon, result.lat],
        zoom: 15,
        duration: 1500,
      });

      // Drop a marker
      const marker = new mapboxgl.Marker({ color: "#2563EB" })
        .setLngLat([result.lon, result.lat])
        .setPopup(
          new mapboxgl.Popup({ maxWidth: "260px", className: "bureau-popup" }).setHTML(
            `<div style="font-family:Inter,sans-serif">
              <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#2563EB;margin-bottom:4px">Search Result</div>
              <div style="font-size:13px;font-weight:600;color:#0C1B33">${result.label.split(" — ")[0]}</div>
            </div>`
          )
        )
        .addTo(map);

      marker.togglePopup();
      searchMarkerRef.current = marker;

      // Update Area Snapshot for the search location
      loadCensusRef.current(result.lat, result.lon, result.label.split(" — ")[0]);
    },
    []
  );

  /* ── Detect mobile for layout ───────── */
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // On mobile, default legend closed and snapshot closed
  useEffect(() => {
    if (isMobile) {
      setLegendOpen(false);
      setSnapshotOpen(false);
    }
  }, [isMobile]);

  /* ── Dynamic parcel boundary loading ─── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    // Set layer visibility
    const vis = parcelsVisible ? "visible" : "none";
    if (map.getLayer("parcels-fill")) map.setLayoutProperty("parcels-fill", "visibility", vis);
    if (map.getLayer("parcels-line")) map.setLayoutProperty("parcels-line", "visibility", vis);

    if (!parcelsVisible) {
      // Clear data when hidden
      const src = map.getSource("parcels") as mapboxgl.GeoJSONSource | undefined;
      if (src) src.setData(EMPTY_FC);
      return;
    }

    const fetchParcels = () => {
      if (parcelsTimerRef.current) clearTimeout(parcelsTimerRef.current);
      parcelsTimerRef.current = setTimeout(() => {
        const m = mapRef.current;
        if (!m) return;
        const zoom = m.getZoom();
        const src = m.getSource("parcels") as mapboxgl.GeoJSONSource | undefined;
        if (!src) return;

        if (zoom < 15) {
          src.setData(EMPTY_FC);
          return;
        }

        // Cancel previous in-flight request
        if (parcelsAbortRef.current) parcelsAbortRef.current.abort();
        const controller = new AbortController();
        parcelsAbortRef.current = controller;

        const bounds = m.getBounds();
        if (!bounds) return;
        const geometry = JSON.stringify({
          xmin: bounds.getWest(),
          ymin: bounds.getSouth(),
          xmax: bounds.getEast(),
          ymax: bounds.getNorth(),
          spatialReference: { wkid: 4326 },
        });

        const params = new URLSearchParams({
          geometry,
          geometryType: "esriGeometryEnvelope",
          spatialRel: "esriSpatialRelIntersects",
          outFields: "PIN14,BLDGClass,TotalValue,Address",
          returnGeometry: "true",
          outSR: "4326",
          f: "geojson",
        });

        fetch(`${PARCELS_QUERY_BASE}?${params}`, { signal: controller.signal })
          .then((res) => res.json())
          .then((data: GeoJSON.FeatureCollection) => {
            if (data?.type === "FeatureCollection" && data.features) {
              src.setData(data);
            }
          })
          .catch((err) => {
            if (err.name !== "AbortError") console.warn("[Parcels] fetch error:", err);
          });
      }, 300);
    };

    // Initial fetch
    fetchParcels();

    // Fetch on every moveend
    map.on("moveend", fetchParcels);
    return () => {
      map.off("moveend", fetchParcels);
      if (parcelsTimerRef.current) clearTimeout(parcelsTimerRef.current);
      if (parcelsAbortRef.current) parcelsAbortRef.current.abort();
    };
  }, [parcelsVisible, loaded]);

  /* ── Dynamic vacant property loading ──── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const anyVisible = Object.values(vacantVisible).some(Boolean);

    // Set layer visibility
    const vis = anyVisible ? "visible" : "none";
    if (map.getLayer("vacant-clusters")) map.setLayoutProperty("vacant-clusters", "visibility", vis);
    if (map.getLayer("vacant-cluster-count")) map.setLayoutProperty("vacant-cluster-count", "visibility", vis);
    if (map.getLayer("vacant-unclustered")) map.setLayoutProperty("vacant-unclustered", "visibility", vis);

    if (!anyVisible) {
      const src = map.getSource("vacant-properties") as mapboxgl.GeoJSONSource | undefined;
      if (src) src.setData(EMPTY_FC);
      return;
    }

    const fetchVacant = () => {
      if (vacantTimerRef.current) clearTimeout(vacantTimerRef.current);
      vacantTimerRef.current = setTimeout(() => {
        const m = mapRef.current;
        if (!m) return;
        const zoom = m.getZoom();
        const src = m.getSource("vacant-properties") as mapboxgl.GeoJSONSource | undefined;
        if (!src) return;

        if (zoom < 10) {
          src.setData(EMPTY_FC);
          return;
        }

        if (vacantAbortRef.current) vacantAbortRef.current.abort();
        const controller = new AbortController();
        vacantAbortRef.current = controller;

        const bounds = m.getBounds();
        if (!bounds) return;

        const boundsStr = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

        fetch(`/api/vacant?bounds=${boundsStr}&limit=1000`, { signal: controller.signal })
          .then((res) => res.json())
          .then((data: GeoJSON.FeatureCollection) => {
            if (data?.type === "FeatureCollection" && data.features) {
              // Filter by visible sub-types
              const filtered = data.features.filter((f) => {
                const pt = f.properties?.propertyType;
                if (vacantVisible.vacantLand && (pt === "vacant_land")) return true;
                if (vacantVisible.vacantBuildings && (pt === "vacant_building" || pt === "vacant_storefront")) return true;
                return false;
              });
              src.setData({ type: "FeatureCollection", features: filtered });
              if (!vacantLoaded) setVacantLoaded(true);
            }
          })
          .catch((err) => {
            if (err.name !== "AbortError") console.warn("[Vacant] fetch error:", err);
          });
      }, 300);
    };

    fetchVacant();
    map.on("moveend", fetchVacant);
    return () => {
      map.off("moveend", fetchVacant);
      if (vacantTimerRef.current) clearTimeout(vacantTimerRef.current);
      if (vacantAbortRef.current) vacantAbortRef.current.abort();
    };
  }, [vacantVisible, loaded, vacantLoaded]);

  return (
    <div className="relative w-full h-[calc(100vh-180px)] md:h-[calc(100vh-220px)] min-h-[500px]">
      {/* Map container */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {/* Map tile loading overlay */}
      {!loaded && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#F0F1EE]/80 backdrop-blur-sm bureau-grid pointer-events-none transition-opacity duration-500">
          <div className="flex items-center gap-1.5 mb-4">
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
          <span className="font-mono-bureau text-[10px] tracking-[0.25em] uppercase text-[#0C1B33]/35">
            Drawing zone boundaries
          </span>
        </div>
      )}

      {/* Search bar */}
      {loaded && <MapSearch onResult={handleSearchResult} />}

      {/* Legend toggle button */}
      <button
        onClick={() => setLegendOpen((o) => !o)}
        className="absolute top-3 left-3 z-10 bg-white/95 backdrop-blur border border-[#0C1B33]/10 px-3 py-2 md:py-1.5 font-mono-bureau text-[11px] md:text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/70 hover:text-[#0C1B33] transition-colors"
      >
        {legendOpen ? "Hide Legend" : "Show Legend"}
      </button>

      {/* Interaction hint */}
      <div className="absolute bottom-3 left-3 z-10 bg-white/90 backdrop-blur border border-[#0C1B33]/10 px-3 py-1.5 font-mono-bureau text-[9px] md:text-[9px] tracking-[0.1em] text-[#0C1B33]/40 hidden md:block">
        Click anywhere for area data &middot; Right-click for zoning
      </div>
      <div className="absolute bottom-3 left-3 z-10 bg-white/90 backdrop-blur border border-[#0C1B33]/10 px-3 py-1.5 font-mono-bureau text-[10px] tracking-[0.1em] text-[#0C1B33]/40 md:hidden">
        Tap anywhere for area data
      </div>

      {/* Mobile backdrop overlay for panels */}
      {(legendOpen || snapshotOpen) && (
        <div
          className="absolute inset-0 z-[15] bg-black/20 md:hidden"
          onClick={() => { setLegendOpen(false); setSnapshotOpen(false); }}
        />
      )}

      {/* ── LEFT: Zone Layer Legend ──────────── */}
      {legendOpen && (
        <div className="absolute bottom-0 left-0 right-0 md:bottom-auto md:top-12 md:left-3 md:right-auto z-20 md:z-10 bg-white/98 md:bg-white/95 backdrop-blur border-t md:border border-[#0C1B33]/10 md:w-72 max-h-[60vh] md:max-h-[calc(100vh-280px)] overflow-y-auto rounded-t-xl md:rounded-none shadow-lg md:shadow-none">
          {/* Mobile drag handle + close */}
          <div className="md:hidden flex flex-col items-center pt-2 pb-1">
            <div className="w-10 h-1 bg-[#0C1B33]/15 rounded-full mb-2" />
            <button
              onClick={() => setLegendOpen(false)}
              className="absolute top-3 right-3 text-[#0C1B33]/40 hover:text-[#0C1B33]/70 text-lg leading-none"
            >
              &times;
            </button>
          </div>

          {/* Presets */}
          <div className="px-4 pt-2 md:pt-4 pb-3">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-2">
              Quick Presets
            </div>
            <div className="flex flex-wrap gap-1.5 md:gap-1">
              {MAP_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset.id)}
                  className={`px-2.5 py-1.5 md:px-2 md:py-1 font-mono-bureau text-[10px] md:text-[8px] tracking-[0.08em] uppercase border transition-colors ${
                    activePreset === preset.id
                      ? "bg-[#2563EB] text-white border-[#2563EB]"
                      : "bg-white text-[#0C1B33]/50 border-[#0C1B33]/12 hover:border-[#2563EB]/40 hover:text-[#2563EB]"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {/* Inspect Zoning button */}
            <button
              onClick={() => setInspectMode((v) => !v)}
              className={`mt-2 w-full px-2 py-2 md:py-1.5 font-mono-bureau text-[10px] md:text-[8px] tracking-[0.1em] uppercase border transition-colors ${
                inspectMode
                  ? "bg-[#059669] text-white border-[#059669]"
                  : "bg-white text-[#059669]/60 border-[#059669]/20 hover:border-[#059669]/40 hover:text-[#059669]"
              }`}
            >
              {inspectMode ? "Exit Inspect Zoning" : "Inspect Zoning (tap)"}
            </button>
          </div>

          {/* Divider */}
          <div className="mx-4 h-px bg-[#0C1B33]/8" />

          {/* Incentive Zones */}
          <div className="px-4 pt-3 pb-2">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-3">
              Incentive Zones
            </div>
            <div className="space-y-0.5">
              {ZONE_KEYS_SORTED.map((key) => (
                <div key={key}>
                  <label className="flex items-center gap-2.5 py-2 md:py-1 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={zoneVisible[key]}
                      onChange={() => toggleZone(key)}
                      className="sr-only"
                    />
                    <span
                      className="w-5 h-5 md:w-3.5 md:h-3.5 border flex-shrink-0 flex items-center justify-center transition-colors"
                      style={{
                        borderColor: ZONE_COLORS[key],
                        backgroundColor: zoneVisible[key]
                          ? ZONE_COLORS[key] + "30"
                          : "transparent",
                      }}
                    >
                      {zoneVisible[key] && (
                        <span
                          className="w-3 h-3 md:w-2 md:h-2 block"
                          style={{ backgroundColor: ZONE_COLORS[key] }}
                        />
                      )}
                    </span>
                    <span
                      className="text-[13px] md:text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight flex-1"
                      onClick={(e) => {
                        e.preventDefault();
                        setExpandedZone(expandedZone === key ? null : key);
                      }}
                    >
                      {ZONE_LABELS[key]}
                    </span>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setExpandedZone(expandedZone === key ? null : key);
                      }}
                      className="text-[9px] text-[#2563EB]/40 hover:text-[#2563EB] transition-colors flex-shrink-0"
                      title="More info"
                    >
                      {expandedZone === key ? "−" : "?"}
                    </button>
                  </label>
                  {/* Expanded description */}
                  {expandedZone === key && ZONE_DESCRIPTIONS[key] && (
                    <div className="ml-6 pl-0.5 pb-2 border-l-2 border-[#0C1B33]/5">
                      <p className="text-[10px] text-[#0C1B33]/50 leading-relaxed mt-1 mb-1.5">
                        {ZONE_DESCRIPTIONS[key]}
                      </p>
                      {ZONE_LEARN_MORE[key] && (
                        <a
                          href={ZONE_LEARN_MORE[key]}
                          target={ZONE_LEARN_MORE[key].startsWith("http") ? "_blank" : undefined}
                          rel={ZONE_LEARN_MORE[key].startsWith("http") ? "noopener noreferrer" : undefined}
                          className="font-mono-bureau text-[9px] tracking-wide text-[#2563EB]/70 hover:text-[#2563EB] transition-colors"
                        >
                          Learn more &rarr;
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="mx-4 h-px bg-[#0C1B33]/8" />

          {/* Vacant Properties */}
          <div className="px-4 pt-3 pb-2">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#DC2626]/50 mb-3">
              Vacant Properties
            </div>
            <div className="space-y-0.5">
              {Object.entries(VACANT_LABELS).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2.5 py-1 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={vacantVisible[key]}
                    onChange={() =>
                      setVacantVisible((prev) => ({ ...prev, [key]: !prev[key] }))
                    }
                    className="sr-only"
                  />
                  <span
                    className="w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                    style={{
                      borderColor: VACANT_COLORS[key],
                      backgroundColor: vacantVisible[key]
                        ? VACANT_COLORS[key] + "30"
                        : "transparent",
                    }}
                  >
                    {vacantVisible[key] && (
                      <span
                        className="w-2 h-2 rounded-full block"
                        style={{ backgroundColor: VACANT_COLORS[key] }}
                      />
                    )}
                  </span>
                  <span className="text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight">
                    {label}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-[9px] text-[#0C1B33]/35 mt-1.5 ml-6">
              City-owned land inventory · Clusters at low zoom
            </p>
          </div>

          {/* Divider */}
          <div className="mx-4 h-px bg-[#0C1B33]/8" />

          {/* Zoning Districts */}
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#059669]/50">
                Chicago Zoning Districts
              </div>
              <button
                onClick={toggleAllZoning}
                className="font-mono-bureau text-[8px] tracking-[0.1em] uppercase text-[#059669]/40 hover:text-[#059669] transition-colors"
              >
                {Object.values(zoningVisible).some(Boolean) ? "Hide all" : "Show all"}
              </button>
            </div>
            <div className="space-y-0.5">
              {ZONING_CATEGORIES.map((cat) => (
                <label
                  key={cat.key}
                  className="flex items-center gap-2.5 py-1 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={zoningVisible[cat.key]}
                    onChange={() => toggleZoningCategory(cat.key)}
                    className="sr-only"
                  />
                  <span
                    className="w-3.5 h-3.5 border flex-shrink-0 flex items-center justify-center transition-colors"
                    style={{
                      borderColor: cat.color,
                      backgroundColor: zoningVisible[cat.key]
                        ? cat.color + "30"
                        : "transparent",
                    }}
                  >
                    {zoningVisible[cat.key] && (
                      <span
                        className="w-2 h-2 block"
                        style={{ backgroundColor: cat.color }}
                      />
                    )}
                  </span>
                  <span className="text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight">
                    {cat.label}
                  </span>
                </label>
              ))}
            </div>

            {/* Collapsible zoning code reference */}
            <button
              onClick={() => setZoningRefOpen((v) => !v)}
              className="flex items-center gap-1.5 mt-3 mb-1 font-mono-bureau text-[8px] tracking-[0.12em] uppercase text-[#059669]/50 hover:text-[#059669] transition-colors"
            >
              <svg
                className={`w-2.5 h-2.5 transition-transform ${zoningRefOpen ? "rotate-90" : ""}`}
                viewBox="0 0 6 10" fill="currentColor"
              >
                <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
              What do the codes mean?
            </button>
            {zoningRefOpen && (
              <div className="mt-1 space-y-2.5 max-h-64 overflow-y-auto pr-1">
                {ZONING_CATEGORIES.map((cat) => {
                  const codes = Object.entries(ZONING_CODE_DESCRIPTIONS).filter(
                    ([code]) => cat.prefixes.some((p) => code.startsWith(p))
                  );
                  // For PD/PMD, show a summary instead of listing hundreds
                  if (cat.key === "pd") {
                    return (
                      <div key={cat.key}>
                        <div
                          className="text-[9px] font-semibold mb-0.5"
                          style={{ color: cat.color }}
                        >
                          {cat.label}
                        </div>
                        <div className="text-[9px] text-[#0C1B33]/50 leading-relaxed">
                          <span className="font-mono-bureau text-[8px] text-[#0C1B33]/70">PD #</span> — Planned Development (site-specific zoning for large projects)
                        </div>
                        <div className="text-[9px] text-[#0C1B33]/50 leading-relaxed">
                          <span className="font-mono-bureau text-[8px] text-[#0C1B33]/70">PMD #</span> — Planned Manufacturing District (protected industrial areas)
                        </div>
                      </div>
                    );
                  }
                  if (codes.length === 0) return null;
                  return (
                    <div key={cat.key}>
                      <div
                        className="text-[9px] font-semibold mb-0.5"
                        style={{ color: cat.color }}
                      >
                        {cat.label}
                      </div>
                      {codes.map(([code, desc]) => (
                        <div
                          key={code}
                          className="text-[9px] text-[#0C1B33]/50 leading-relaxed"
                        >
                          <span className="font-mono-bureau text-[8px] text-[#0C1B33]/70">
                            {code}
                          </span>{" "}
                          — {desc.replace(/^.*?\(/, "(").replace(/\)$/, ")") !== desc
                            ? desc
                            : desc}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="mx-4 h-px bg-[#0C1B33]/8" />

          {/* Community Assets */}
          <div className="px-4 pt-3 pb-2">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#059669]/50 mb-3">
              Community Assets
            </div>
            <div className="space-y-1">
              {Object.entries(POI_LAYERS).map(([key, cfg]) => (
                <label
                  key={key}
                  className="flex items-center gap-2.5 py-1 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={poiVisible[key]}
                    onChange={() => togglePoi(key)}
                    className="sr-only"
                  />
                  <span
                    className="w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                    style={{
                      borderColor: cfg.color,
                      backgroundColor: poiVisible[key]
                        ? cfg.color + "30"
                        : "transparent",
                    }}
                  >
                    {poiVisible[key] && (
                      <span
                        className="w-2 h-2 rounded-full block"
                        style={{ backgroundColor: cfg.color }}
                      />
                    )}
                  </span>
                  <span className="text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight">
                    {cfg.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="mx-4 h-px bg-[#0C1B33]/8" />

          {/* Parcels & Property */}
          <div className="px-4 pt-3 pb-3">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#7C3AED]/50 mb-3">
              Parcels &amp; Property
            </div>
            <label className="flex items-center gap-2.5 py-1 cursor-pointer group">
              <input
                type="checkbox"
                checked={parcelsVisible}
                onChange={() => setParcelsVisible((v) => !v)}
                className="sr-only"
              />
              <span
                className="w-3.5 h-3.5 border flex-shrink-0 flex items-center justify-center transition-colors"
                style={{
                  borderColor: "#7C3AED",
                  backgroundColor: parcelsVisible ? "#7C3AED30" : "transparent",
                }}
              >
                {parcelsVisible && (
                  <span className="w-2 h-2 block" style={{ backgroundColor: "#7C3AED" }} />
                )}
              </span>
              <span className="text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight">
                Parcels
              </span>
            </label>
            <p className="text-[9px] text-[#0C1B33]/35 mt-1 ml-6">
              Lot boundaries visible at zoom 15+
            </p>

            {/* Collapsible class code reference */}
            <button
              onClick={() => setClassRefOpen((v) => !v)}
              className="flex items-center gap-1.5 mt-3 mb-1 font-mono-bureau text-[8px] tracking-[0.12em] uppercase text-[#7C3AED]/50 hover:text-[#7C3AED] transition-colors"
            >
              <svg
                className={`w-2.5 h-2.5 transition-transform ${classRefOpen ? "rotate-90" : ""}`}
                viewBox="0 0 6 10" fill="currentColor"
              >
                <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
              What do the classes mean?
            </button>
            {classRefOpen && (
              <div className="mt-1 space-y-2.5 max-h-64 overflow-y-auto pr-1">
                {[
                  { label: "Vacant Land", prefix: "1-", color: "#94A3B8" },
                  { label: "Residential", prefix: "2-", color: "#059669" },
                  { label: "Multi-Unit (7+)", prefix: "3-", color: "#2563EB" },
                  { label: "Commercial", prefix: "5-", color: "#D97706" },
                  { label: "Industrial", prefix: "6-", color: "#DC2626" },
                ].map((group) => {
                  const codes = Object.entries(CLASS_CODE_MAP).filter(
                    ([code]) => code.startsWith(group.prefix)
                  );
                  if (codes.length === 0) return null;
                  return (
                    <div key={group.prefix}>
                      <div
                        className="text-[9px] font-semibold mb-0.5"
                        style={{ color: group.color }}
                      >
                        {group.label}
                      </div>
                      {codes.map(([code, desc]) => (
                        <div
                          key={code}
                          className="text-[9px] text-[#0C1B33]/50 leading-relaxed"
                        >
                          <span className="font-mono-bureau text-[8px] text-[#0C1B33]/70">
                            {code}
                          </span>{" "}
                          — {desc}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── RIGHT: Area Snapshot Panel ──────── */}
      {snapshotOpen && loaded && (
        <div className="absolute bottom-0 left-0 right-0 md:bottom-auto md:top-12 md:left-auto md:right-3 z-20 md:z-10 bg-white/98 md:bg-white/95 backdrop-blur border-t md:border border-[#0C1B33]/10 md:w-72 max-h-[60vh] md:max-h-[calc(100%-4rem)] overflow-y-auto rounded-t-xl md:rounded-none shadow-lg md:shadow-none">
          {/* Mobile drag handle */}
          <div className="md:hidden flex flex-col items-center pt-2 pb-1">
            <div className="w-10 h-1 bg-[#0C1B33]/15 rounded-full" />
          </div>

          <div className="px-4 pt-2 md:pt-4 pb-1 flex items-center justify-between">
            <div className="font-mono-bureau text-[10px] md:text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30">
              Area Snapshot
            </div>
            <button
              onClick={() => setSnapshotOpen(false)}
              className="text-[#0C1B33]/30 hover:text-[#0C1B33]/60 text-[18px] md:text-[14px] leading-none transition-colors p-1"
              title="Close"
            >
              &times;
            </button>
          </div>

          {/* Location label */}
          <div className="px-4 pb-3">
            <div className="text-[11px] font-medium text-[#0C1B33]/80 leading-tight">
              {snapshotLabel}
            </div>
            <div className="text-[9px] text-[#0C1B33]/30 mt-0.5 font-mono-bureau tracking-wide">
              Click map to update
            </div>
          </div>

          <div className="mx-4 h-px bg-[#0C1B33]/8" />

          {/* Stats */}
          <div className="px-4 pt-3 pb-3 space-y-3">
            <div>
              <div className="flex justify-between items-baseline">
                <span className="text-[11px] text-[#0C1B33]/60">Median Home Price</span>
                <span className="font-mono-bureau text-[13px] text-[#0C1B33]/90 font-medium">
                  {areaStats.medianHomePrice}
                </span>
              </div>
              <p className="text-[9px] text-[#0C1B33]/30 mt-0.5 leading-relaxed">
                Median sale price of homes in this census tract (ACS 5-Year Estimate).
              </p>
            </div>

            <div>
              <div className="flex justify-between items-baseline">
                <span className="text-[11px] text-[#0C1B33]/60">Median Income</span>
                <span className="font-mono-bureau text-[13px] text-[#0C1B33]/90 font-medium">
                  {areaStats.medianIncome}
                </span>
              </div>
              <p className="text-[9px] text-[#0C1B33]/30 mt-0.5 leading-relaxed">
                Median household income for the tract, used to determine HUD low-income eligibility.
              </p>
            </div>

            <div>
              <div className="flex justify-between items-baseline">
                <span className="text-[11px] text-[#0C1B33]/60">Walkability</span>
                <div className="flex items-center gap-2">
                  <div className="w-14 h-1.5 bg-[#0C1B33]/10 overflow-hidden">
                    <div
                      className="h-full bg-[#2563EB]"
                      style={{ width: `${areaStats.walkScore}%` }}
                    />
                  </div>
                  <span className="font-mono-bureau text-[13px] text-[#0C1B33]/90 font-medium">
                    {areaStats.walkScore}
                  </span>
                </div>
              </div>
              <p className="text-[9px] text-[#0C1B33]/30 mt-0.5 leading-relaxed">
                Walkability (0-100) based on proximity to amenities and pedestrian infrastructure.
              </p>
            </div>
          </div>

          {/* Parcel info */}
          {areaStats.parcelPin && (
            <>
              <div className="mx-4 h-px bg-[#0C1B33]/8" />
              <div className="px-4 py-3">
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#7C3AED]/50 mb-1">
                  Parcel
                </div>
                <div className="text-[12px] text-[#0C1B33]/80">
                  <a
                    href={`https://www.cookcountyassessoril.gov/pin/${areaStats.parcelPin}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#2563EB] hover:underline"
                  >
                    {areaStats.parcelPin}
                  </a>
                  {areaStats.parcelClass && <span className="text-[#0C1B33]/50"> · Class {areaStats.parcelClass}</span>}
                  {areaStats.parcelValue && <span className="text-[#0C1B33]/50"> · {areaStats.parcelValue}</span>}
                </div>
                {areaStats.parcelClassDescription && (
                  <div className="text-[10px] text-[#0C1B33]/40 mt-0.5 italic">
                    {areaStats.parcelClassDescription}
                  </div>
                )}
                {/* Tax Code, Township, Parcel Type row */}
                {(areaStats.parcelTaxCode || areaStats.parcelTownship || areaStats.parcelType) && (
                  <div className="flex gap-3 mt-1.5 font-mono-bureau text-[9px] text-[#0C1B33]/50">
                    {areaStats.parcelTaxCode && <span>Tax Code {areaStats.parcelTaxCode}</span>}
                    {areaStats.parcelTownship && <span>{areaStats.parcelTownship}</span>}
                    {areaStats.parcelType && <span>{areaStats.parcelType}</span>}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Assessment */}
          {areaStats.assessedTotal != null && (
            <>
              <div className="mx-4 h-px bg-[#0C1B33]/8" />
              <div className="px-4 py-3">
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#059669]/50 mb-1.5">
                  Assessment{areaStats.taxYear ? ` (${areaStats.taxYear})` : ""}
                </div>
                <div className="space-y-0.5">
                  {areaStats.assessedLand != null && (
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#0C1B33]/50">Land</span>
                      <span className="font-mono-bureau text-[#0C1B33]/80">${areaStats.assessedLand.toLocaleString()}</span>
                    </div>
                  )}
                  {areaStats.assessedBuilding != null && (
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#0C1B33]/50">Building</span>
                      <span className="font-mono-bureau text-[#0C1B33]/80">${areaStats.assessedBuilding.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[10px] font-medium">
                    <span className="text-[#0C1B33]/60">Total Assessed</span>
                    <span className="font-mono-bureau text-[#0C1B33]/90">${areaStats.assessedTotal.toLocaleString()}</span>
                  </div>
                  {areaStats.priorYearTax != null && (
                    <div className="flex justify-between text-[10px] mt-1 pt-1 border-t border-[#0C1B33]/5">
                      <span className="text-[#0C1B33]/50">Prior Year Tax</span>
                      <span className="font-mono-bureau text-[#0C1B33]/80">${areaStats.priorYearTax.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Districts */}
          {(areaStats.districts || areaStats.districtsLoading) && (
            <>
              <div className="mx-4 h-px bg-[#0C1B33]/8" />
              <div className="px-4 py-3">
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#D97706]/50 mb-1.5">
                  Districts
                </div>
                {areaStats.districtsLoading && !areaStats.districts ? (
                  <div className="text-[10px] text-[#0C1B33]/40 italic">Loading districts...</div>
                ) : areaStats.districts ? (
                  <div className="space-y-0.5">
                    {areaStats.districts.ward && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-[#0C1B33]/50">Ward</span>
                        <span className="font-mono-bureau text-[#0C1B33]/80">{areaStats.districts.ward}</span>
                      </div>
                    )}
                    {areaStats.districts.commissionerDistrict && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-[#0C1B33]/50">Commissioner</span>
                        <span className="font-mono-bureau text-[#0C1B33]/80">Dist. {areaStats.districts.commissionerDistrict}</span>
                      </div>
                    )}
                    {areaStats.districts.congressionalDistrict && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-[#0C1B33]/50">Congressional</span>
                        <span className="font-mono-bureau text-[#0C1B33]/80">IL-{areaStats.districts.congressionalDistrict}</span>
                      </div>
                    )}
                    {areaStats.districts.stateHouseDistrict && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-[#0C1B33]/50">State Rep</span>
                        <span className="font-mono-bureau text-[#0C1B33]/80">Dist. {areaStats.districts.stateHouseDistrict}</span>
                      </div>
                    )}
                    {areaStats.districts.stateSenateDistrict && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-[#0C1B33]/50">State Senate</span>
                        <span className="font-mono-bureau text-[#0C1B33]/80">Dist. {areaStats.districts.stateSenateDistrict}</span>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          )}

          {/* Zoning info */}
          {zoningInfo && (
            <>
              <div className="mx-4 h-px bg-[#0C1B33]/8" />
              <div className="px-4 py-3">
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#059669]/50 mb-1">
                  Zoning
                </div>
                <div className="text-[12px] text-[#0C1B33]/80">{zoningInfo}</div>
              </div>
            </>
          )}

          {/* Top 3 Programs Here */}
          {snapshotPrograms.length > 0 && (
            <>
              <div className="mx-4 h-px bg-[#0C1B33]/8" />
              <div className="px-4 pt-3 pb-2">
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-2">
                  Top Programs Here
                </div>
                <div className="space-y-1.5">
                  {snapshotPrograms.map((r) => (
                    <div key={r.programId}>
                      <div className="text-[10px] text-[#0C1B33]/70 leading-snug">
                        {r.program.name}
                      </div>
                      <div className="font-mono-bureau text-[8px] text-[#0C1B33]/40 mt-0.5">
                        {r.benefitRange}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Actions */}
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 py-3 space-y-2">
            <a
              href={
                lastClickLat && lastClickLon
                  ? `/report?instant=true&lat=${lastClickLat.toFixed(5)}&lon=${lastClickLon.toFixed(5)}&addr=${encodeURIComponent(snapshotLabel)}`
                  : "/report"
              }
              className="block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase bg-[#2563EB] text-white py-2 px-3 hover:bg-[#1d4ed8] transition-colors"
            >
              Generate Report for This Location
            </a>
            {lastClickLat && lastClickLon && (
              <button
                onClick={() => {
                  const url = `${window.location.origin}/report?instant=true&lat=${lastClickLat.toFixed(5)}&lon=${lastClickLon.toFixed(5)}&addr=${encodeURIComponent(snapshotLabel)}`;
                  navigator.clipboard.writeText(url).then(() => {
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  });
                }}
                className="block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase border border-[#0C1B33]/15 text-[#0C1B33]/60 py-2 px-3 hover:text-[#0C1B33] hover:border-[#0C1B33]/30 transition-colors"
              >
                {copiedLink ? "Link Copied!" : "Copy Share Link"}
              </button>
            )}
            <a
              href="/programs"
              className="block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase border border-[#0C1B33]/15 text-[#0C1B33]/60 py-2 px-3 hover:text-[#0C1B33] hover:border-[#0C1B33]/30 transition-colors"
            >
              Browse All Programs
            </a>
          </div>
        </div>
      )}

      {/* Snapshot toggle (when closed) */}
      {!snapshotOpen && loaded && (
        <button
          onClick={() => setSnapshotOpen(true)}
          className="absolute top-12 md:top-3 right-3 z-10 bg-white/95 backdrop-blur border border-[#0C1B33]/10 px-3 py-2 md:py-1.5 font-mono-bureau text-[11px] md:text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/70 hover:text-[#0C1B33] transition-colors"
        >
          Area Snapshot
        </button>
      )}
    </div>
  );
}
