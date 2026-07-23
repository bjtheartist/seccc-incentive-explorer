"use client";

/**
 * VacancyReportMap — the live, clustered dot map that anchors the Vacancy
 * Opportunity Index WEB report (app/vacancy/[zip]/page.tsx). It is the
 * web-canonical echo of the PDF's static locator map, built on the same
 * CommuniData playbook the admin owner-cluster map uses (see
 * components/map/MapView.tsx lines ~1176–1275): a clustered GeoJSON source,
 * a match-expression color ramp keyed on ownerType, a ZIP boundary line
 * layer, numbered featured-site markers, and a collapsible owner-type legend.
 *
 * Two views share ONE clustered source (data swapped via source.setData on
 * toggle, so every cluster/dot layer + the match-expression colors work
 * unchanged for both):
 *   1. TRACKED INVENTORY — COLS + 311 sitePoints; numbered featured-site markers.
 *   2. VACANT LAND (RECONCILED) — assessor vacant-land parcels colored by their
 *      reconciled owner type; no numbered markers.
 * Distressed dots (tax-sale-exposed parcels, violation-matched buildings) carry
 * an always-on red ring in both views, and two legend checkbox filters narrow
 * the plotted universe (filtering rebuilds the source data so clusters recount).
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
// Client-safe imports ONLY: the card builder and its helpers carry no fs —
// value-importing lib/vacancy-index here would drag its node:fs loader into the
// client bundle (the leak that broke the build before).
import type { OwnerGeography, OwnerStructure } from "@/lib/owner-taxonomy";
import { buildSiteCardHtml, escapeHtml, type CardData } from "./vacancy-site-card";
import type {
  CorridorKind,
  OwnerConfidence,
  VacancyAnchor,
  VacancyCluster,
  VacancyLandPoint,
  VacancyPropertyType,
  VacancySiteIndexRow,
  VacancySitePoint,
} from "@/lib/vacancy-index";

const INK = "#111111";
const DISTRESS_RED = "#DC2626";
/** Neutral ink for the anchor diamonds — deliberately NOT an owner-type color
 *  (anchors are context, not vacant-site data). */
const ANCHOR_INK = "#475569";

/**
 * A corridor for the map's optional outline layer. The lean export edition
 * carries only {name, kind}; supply `rings` (loaded server-side from
 * public/data/zones/*.geojson) to also DRAW the dashed outline + label. Passing
 * {name, kind} alone is valid and simply renders no outline.
 */
export interface VacancyReportMapCorridor {
  name: string;
  kind: CorridorKind;
  rings?: [number, number][][] | null;
}

type MapView = "tracked" | "land";


/** One LineString feature per corridor ring (only for corridors that carry
 *  geometry — {name,kind}-only corridors contribute nothing). */
function buildCorridorLineFeatures(
  corridors: VacancyReportMapCorridor[] | null | undefined,
): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const c of corridors ?? []) {
    for (const ring of c.rings ?? []) {
      if (!Array.isArray(ring) || ring.length < 2) continue;
      out.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: ring },
        properties: { name: c.name },
      });
    }
  }
  return out;
}

/**
 * Anchor point features. The anchor dataset is community-area-native, so many
 * anchors share their CA centroid; coincident anchors are spread on a small
 * deterministic ring (~150 m) purely so each stays visible and clickable. This
 * is a DISPLAY convention — the popup discloses the location is an approximate
 * community-area locator, not an exact address.
 */
function buildAnchorFeatures(anchors: VacancyAnchor[] | null | undefined): GeoJSON.Feature[] {
  const groups = new Map<string, VacancyAnchor[]>();
  for (const a of anchors ?? []) {
    const key = `${a.lat.toFixed(5)},${a.lon.toFixed(5)}`;
    const g = groups.get(key);
    if (g) g.push(a);
    else groups.set(key, [a]);
  }
  const RING_DEG = 0.0016; // ~150–180 m
  const out: GeoJSON.Feature[] = [];
  for (const list of groups.values()) {
    const nn = list.length;
    list.forEach((a, i) => {
      let lon = a.lon;
      let lat = a.lat;
      if (nn > 1) {
        const ang = (2 * Math.PI * i) / nn;
        lon += RING_DEG * Math.cos(ang);
        lat += RING_DEG * 0.75 * Math.sin(ang);
      }
      out.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { name: a.name, category: a.category },
      });
    });
  }
  return out;
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
  /** Reconciled vacant-land parcels as dots (view 2), or null when the export
   *  could not build the parcels series for this ZIP (toggle disabled). */
  landPoints: VacancyLandPoint[] | null;
  landPointsTruncated: boolean;
  /** Full vacant-land universe count (= vacantLandParcelTotal); drives the land
   *  view's SHOWING line. null exactly when landPoints is null. */
  landPointsTotal: number | null;
  // ── Spatial-intelligence overlays (D4, all OPTIONAL + backward-compatible —
  //    the page passes them once the orchestrator wires the spatial layer). ──
  /** Proximity clusters for this edition. Not drawn as shapes by default; a
   *  cluster's bbox is outlined only when `focusBbox` targets it (deep-link). */
  clusters?: VacancyCluster[] | null;
  /** Named corridors. Supply `rings` to draw the dashed outline + label;
   *  {name,kind} alone renders nothing (valid). */
  corridors?: VacancyReportMapCorridor[] | null;
  /** Community-impact anchors (community-area locators — approximate). Rendered
   *  as neutral-ink diamonds with a name/category popup. */
  anchors?: VacancyAnchor[] | null;
  /** When set (or changed), the map fits these bounds and outlines the box —
   *  the cluster-card → map deep-link target. `null` clears the outline. */
  focusBbox?: [number, number, number, number] | null;
  /** Human "as of" date for the site card's "Records as of" line; omitted from
   *  the card when absent. */
  asOf?: string;
  /** Primary neighborhood name, the corridor/cluster line's fallback when a
   *  cluster carries no named corridor. */
  neighborhood?: string;
  /** Defect B (URL-addressable area focus): when set and a `clusters` entry
   *  with this id exists, the map fits to that cluster's bbox and outlines it
   *  on load — the same visual the cluster-card → map deep-link produces, but
   *  driven by the page's `?area=` query param instead of a click. `null`/
   *  `undefined`/an id with no matching cluster are all ignored gracefully. */
  initialAreaId?: number | null;
}

/** Feature properties carried on every dot (both views), keyed identically so
 *  the shared layers/paint expressions/filters work for tracked and land. */
interface DotProps {
  ownerType: OwnerType;
  propertyType: VacancyPropertyType | null;
  markerNumber: number | null;
  address: string | null;
  nextStep: string | null;
  saleYear: number | null;
  sale: boolean;
  violation: boolean;
  distressed: boolean;
  pin: string | null;
  squareFeet: number | null;
  zoningClass: string | null;
  incentiveCount: number;
  ownerConfidence: OwnerConfidence;
  ownerStructure: OwnerStructure | null;
  ownerGeography: OwnerGeography | null;
  clusterId: number | null;
}

export default function VacancyReportMap({
  zip,
  boundary,
  bbox,
  centroid,
  sitePoints,
  siteIndex,
  totalCount,
  landPoints,
  landPointsTruncated,
  landPointsTotal,
  clusters,
  corridors,
  anchors,
  focusBbox,
  asOf,
  neighborhood,
  initialAreaId,
}: VacancyReportMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);

  const token =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN : undefined;

  const landDisabled = landPoints == null;

  const [view, setView] = useState<MapView>("tracked");

  // Owner types genuinely present in each view's dots (OWNER_TYPE_ORDER).
  const trackedPresent = useMemo(
    () => presentOwnerTypesInOrder(sitePoints.map((p) => p.ownerType)),
    [sitePoints],
  );
  const landPresent = useMemo(
    () => (landPoints ? presentOwnerTypesInOrder(landPoints.map((p) => p.ownerType)) : []),
    [landPoints],
  );
  const presentTypes = useMemo(
    () => (view === "land" ? landPresent : trackedPresent),
    [view, landPresent, trackedPresent],
  );

  // Live per-type counts for the legend (from the loaded points, not a query).
  const trackedCounts = useMemo(() => {
    const counts = new Map<OwnerType, number>();
    for (const p of sitePoints) counts.set(p.ownerType, (counts.get(p.ownerType) ?? 0) + 1);
    return counts;
  }, [sitePoints]);
  const landCounts = useMemo(() => {
    const counts = new Map<OwnerType, number>();
    for (const p of landPoints ?? []) counts.set(p.ownerType, (counts.get(p.ownerType) ?? 0) + 1);
    return counts;
  }, [landPoints]);
  const typeCounts = view === "land" ? landCounts : trackedCounts;

  // Distress counts for the current view's points.
  const saleCount = useMemo(() => {
    const pts = view === "land" ? landPoints ?? [] : sitePoints;
    return pts.filter((p) => p.saleYear != null).length;
  }, [view, landPoints, sitePoints]);
  const violationCount = useMemo(
    () => sitePoints.filter((p) => p.violation).length,
    [sitePoints],
  );

  const [activeTypes, setActiveTypes] = useState<Set<OwnerType>>(new Set());
  const [saleFilter, setSaleFilter] = useState(false);
  const [violationFilter, setViolationFilter] = useState(false);
  // Seed / reset the active set whenever the present types change (i.e. on
  // toggle) — reset-on-toggle: owner-type selections do not carry across views.
  useEffect(() => {
    setActiveTypes(new Set(presentTypes));
  }, [presentTypes]);

  const [legendOpen, setLegendOpen] = useState(true);

  // Defect E: on narrow viewports the legend defaults OPEN and can obstruct
  // the map beneath it — collapse it on mount there. Desktop keeps the
  // default-open behavior unchanged. A one-time check (not a live media-query
  // subscription) is enough since this only decides the INITIAL state.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (window.matchMedia("(max-width: 640px)").matches) {
      setLegendOpen(false);
    }
    // Mount-once: only sets the initial state for narrow viewports.
  }, []);

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
  const dataRef = useRef({ zip, boundary, bbox, centroid, sitePoints, siteIndex, landPoints, clusters, corridors, anchors, asOf, neighborhood, initialAreaId });
  dataRef.current = { zip, boundary, bbox, centroid, sitePoints, siteIndex, landPoints, clusters, corridors, anchors, asOf, neighborhood, initialAreaId };

  // Current view read through a ref so the mount-once popup handler stays fresh.
  const viewRef = useRef(view);
  viewRef.current = view;

  // Both views' full (unfiltered) feature collections, built once at init.
  const featuresRef = useRef<{ tracked: GeoJSON.Feature[]; land: GeoJSON.Feature[] }>({
    tracked: [],
    land: [],
  });

  useEffect(() => {
    if (!containerRef.current || !token) return;

    const {
      zip: zipForLinks,
      boundary: bnd,
      bbox: bb,
      centroid: ctr,
      sitePoints: pts,
      siteIndex: idx,
      landPoints: land,
      clusters: cls,
      corridors: cor,
      anchors: anc,
      asOf: asOfLabel,
      neighborhood: nbhd,
      initialAreaId: initialAreaIdVal,
    } = dataRef.current;

    // Kept clusters keyed by id, for the site card's cluster/corridor line, the
    // "why it matters" clause, and the View-cluster deep-link bbox.
    const clusterById = new Map<number, VacancyCluster>();
    for (const c of cls ?? []) clusterById.set(c.id, c);

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

    const trackedFeatures: GeoJSON.Feature[] = pts.map((p) => {
      const joined = p.markerNumber != null ? markerByNumber.get(p.markerNumber) : undefined;
      const sale = p.saleYear != null;
      const props: DotProps = {
        ownerType: p.ownerType,
        propertyType: p.propertyType,
        markerNumber: p.markerNumber ?? null,
        // Prefer the point's own address; fall back to the joined marker row.
        address: p.address ?? joined?.address ?? null,
        nextStep: joined?.nextStep ?? null,
        saleYear: p.saleYear,
        sale,
        violation: p.violation,
        distressed: sale || p.violation,
        pin: p.pin,
        squareFeet: p.squareFeet,
        zoningClass: p.zoningClass,
        incentiveCount: p.incentiveCount,
        ownerConfidence: p.ownerConfidence,
        ownerStructure: p.ownerStructure ?? null,
        ownerGeography: p.ownerGeography ?? null,
        clusterId: p.clusterId,
      };
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: props as unknown as GeoJSON.GeoJsonProperties,
      };
    });

    const landFeatures: GeoJSON.Feature[] = (land ?? []).map((p) => {
      const sale = p.saleYear != null;
      const props: DotProps = {
        ownerType: p.ownerType,
        propertyType: "vacant_land",
        markerNumber: null,
        address: p.address,
        nextStep: null,
        saleYear: p.saleYear,
        sale,
        violation: false,
        distressed: sale,
        pin: p.pin,
        squareFeet: p.squareFeet,
        zoningClass: null,
        incentiveCount: 0,
        ownerConfidence: p.ownerConfidence,
        ownerStructure: p.ownerStructure ?? null,
        ownerGeography: p.ownerGeography ?? null,
        clusterId: null,
      };
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: props as unknown as GeoJSON.GeoJsonProperties,
      };
    });

    featuresRef.current = { tracked: trackedFeatures, land: landFeatures };

    // The enriched fields (pin, sqft, zoning, incentives, confidence, cluster,
    // distress) live on sitePoints, not siteIndex — join by markerNumber.
    const pointByMarker = new Map<number, VacancySitePoint>();
    for (const p of pts) {
      if (p.markerNumber != null) pointByMarker.set(p.markerNumber, p);
    }

    const markerFeatures: GeoJSON.Feature[] = markerRows.map((r) => {
      const sp = r.markerNumber != null ? pointByMarker.get(r.markerNumber) : undefined;
      const saleYear = sp?.saleYear ?? null;
      const violation = sp?.violation ?? false;
      const sale = saleYear != null;
      const props: DotProps = {
        ownerType: r.ownerType,
        propertyType: r.propertyType,
        markerNumber: r.markerNumber,
        address: r.address,
        nextStep: r.nextStep,
        saleYear,
        sale,
        violation,
        distressed: sale || violation,
        pin: sp?.pin ?? null,
        squareFeet: sp?.squareFeet ?? r.squareFeet,
        zoningClass: sp?.zoningClass ?? r.zoningClass,
        incentiveCount: sp?.incentiveCount ?? r.incentiveCount,
        ownerConfidence: sp?.ownerConfidence ?? "inferred",
        ownerStructure: sp?.ownerStructure ?? r.ownerStructure ?? null,
        ownerGeography: sp?.ownerGeography ?? r.ownerGeography ?? null,
        clusterId: sp?.clusterId ?? null,
      };
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lon, r.lat] },
        properties: props as unknown as GeoJSON.GeoJsonProperties,
      };
    });

    map.on("load", () => {
      // ── Corridor outlines (dashed INK, BENEATH the dots) + line labels.
      //    Added first so the dot layers draw on top. Only corridors carrying
      //    `rings` contribute geometry. ──
      const corridorFeatures = buildCorridorLineFeatures(cor);
      if (corridorFeatures.length > 0) {
        map.addSource("vacancy-corridors", {
          type: "geojson",
          data: { type: "FeatureCollection", features: corridorFeatures },
        });
        map.addLayer({
          id: "vacancy-corridor-line",
          type: "line",
          source: "vacancy-corridors",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": INK,
            "line-width": 1,
            "line-dasharray": [2, 2],
            "line-opacity": 0.35,
          },
        });
        map.addLayer({
          id: "vacancy-corridor-label",
          type: "symbol",
          source: "vacancy-corridors",
          layout: {
            "symbol-placement": "line",
            "text-field": ["get", "name"],
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            "text-size": 10,
            "text-letter-spacing": 0.06,
          },
          paint: {
            "text-color": INK,
            "text-opacity": 0.45,
            "text-halo-color": "#ffffff",
            "text-halo-width": 1,
          },
        });
      }

      // ── Focus-rect source (empty until a cluster deep-link sets focusBbox). ──
      map.addSource("vacancy-focus", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "vacancy-focus-rect",
        type: "line",
        source: "vacancy-focus",
        paint: {
          "line-color": INK,
          "line-width": 1.5,
          "line-dasharray": [1, 1],
          "line-opacity": 0.6,
        },
      });

      // ── Clustered dot source (CommuniData playbook). Starts on the tracked
      //    view; toggling swaps this source's data. ──
      map.addSource("vacancy-sites", {
        type: "geojson",
        data: { type: "FeatureCollection", features: trackedFeatures },
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
          // Clusters stay INK — no distress aggregation at the cluster level.
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
          // Distressed dots (tax-sale exposed OR violation-matched) get a red ring.
          "circle-stroke-width": ["case", ["==", ["get", "distressed"], true], 2, 1.5],
          "circle-stroke-color": ["case", ["==", ["get", "distressed"], true], DISTRESS_RED, "#ffffff"],
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

      // ── Numbered featured-site markers (tracked view only; hidden on the land
      //    view via setLayoutProperty). ──
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
          // Distressed featured sites ring red too (else white).
          "circle-stroke-color": ["case", ["==", ["get", "distressed"], true], DISTRESS_RED, "#ffffff"],
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

      // ── Community-impact anchors (neutral-ink diamonds, ON TOP of the dots
      //    so they stay clickable). A "◆" glyph keeps them visually distinct
      //    from the round owner-type dots. ──
      const anchorFeatures = buildAnchorFeatures(anc);
      if (anchorFeatures.length > 0) {
        map.addSource("vacancy-anchors", {
          type: "geojson",
          data: { type: "FeatureCollection", features: anchorFeatures },
        });
        map.addLayer({
          id: "vacancy-anchor-marker",
          type: "symbol",
          source: "vacancy-anchors",
          layout: {
            "text-field": "◆",
            "text-size": 13,
            "text-font": ["Arial Unicode MS Regular"],
            "text-allow-overlap": true,
          },
          paint: {
            "text-color": ANCHOR_INK,
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5,
          },
        });
      }

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

      // ── Defect B: URL-addressable area focus (?area= on the map page). If the
      //    id resolves to a kept cluster, override the edition-bbox fit above
      //    with a tighter fit to that cluster's bbox and outline it on the SAME
      //    "vacancy-focus" source/layer the cluster-card deep-link uses (added
      //    just above) — one visual language for "this is the focused area"
      //    whether it was reached by URL or by clicking a card. An unresolved
      //    id (bad param, or an area outside the kept clusters) is ignored. ──
      if (initialAreaIdVal != null) {
        const initialCluster = clusterById.get(initialAreaIdVal);
        if (initialCluster) {
          const [w, s, e, n] = initialCluster.bbox;
          const focusSrc = map.getSource("vacancy-focus") as mapboxgl.GeoJSONSource | undefined;
          focusSrc?.setData({
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [w, s],
                  [e, s],
                  [e, n],
                  [w, n],
                  [w, s],
                ],
              ],
            },
            properties: {},
          });
          map.fitBounds(
            [
              [w, s],
              [e, n],
            ],
            { padding: 80, duration: 0, maxZoom: 16 },
          );
        }
      }

      // ── Popups: the structured decision card (view-aware via viewRef) ──
      const openSitePopup = (
        lngLat: mapboxgl.LngLatLike,
        p: Record<string, unknown>,
      ) => {
        const isLand = viewRef.current === "land";
        const ownerType = (p.ownerType as OwnerType) ?? "unknown";
        const clusterId = p.clusterId == null ? null : Number(p.clusterId);
        const cluster = clusterId != null ? clusterById.get(clusterId) ?? null : null;
        const squareFeet =
          p.squareFeet == null || !Number.isFinite(Number(p.squareFeet)) ? null : Number(p.squareFeet);
        const data: CardData = {
          isLand,
          markerNumber: p.markerNumber == null ? null : Number(p.markerNumber),
          address: typeof p.address === "string" ? p.address : null,
          ownerType,
          propertyType: (p.propertyType as VacancyPropertyType) ?? "vacant_land",
          pin: typeof p.pin === "string" && p.pin ? p.pin : null,
          squareFeet,
          zoningClass: typeof p.zoningClass === "string" && p.zoningClass ? p.zoningClass : null,
          incentiveCount: Number.isFinite(Number(p.incentiveCount)) ? Number(p.incentiveCount) : 0,
          ownerConfidence: (p.ownerConfidence as OwnerConfidence) ?? "inferred",
          ownerStructure: (p.ownerStructure as OwnerStructure | null) ?? null,
          ownerGeography: (p.ownerGeography as OwnerGeography | null) ?? null,
          clusterId,
          saleYear: p.saleYear == null ? null : Number(p.saleYear),
          violation: p.violation === true,
          cluster,
          neighborhood: nbhd ?? null,
        };

        const html = buildSiteCardHtml(data, zipForLinks, asOfLabel ?? null);
        // Every card control is now a plain <a href> (opportunity area + county
        // record links) — no post-mount button wiring needed.
        new mapboxgl.Popup({ maxWidth: "320px", className: "bureau-popup" })
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

      // Anchor popup (name + category; discloses the approximate CA-level locator).
      map.on("click", "vacancy-anchor-marker", (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties ?? {};
        const name = typeof p.name === "string" ? p.name : "Community anchor";
        const category = typeof p.category === "string" ? p.category : "";
        const html = `<div style="font-family:Inter,sans-serif;min-width:180px">
          <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:${ANCHOR_INK};margin-bottom:4px;font-weight:600">Community anchor</div>
          <div style="font-size:13px;font-weight:600;color:#0C1B33">${escapeHtml(name)}</div>
          ${category ? `<div style="font-size:11px;color:#5A6478;margin-top:6px">${escapeHtml(category)}</div>` : ""}
          <div style="font-size:10px;color:#8A93A6;margin-top:8px;line-height:1.35">Approximate — community-area locator, not an exact address.</div>
        </div>`;
        new mapboxgl.Popup({ maxWidth: "300px", className: "bureau-popup" })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map);
      });
      map.on("mouseenter", "vacancy-anchor-marker", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "vacancy-anchor-marker", () => {
        map.getCanvas().style.cursor = "";
      });

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

  // ── Source swap + filters + marker visibility (single coherent effect) ──
  // Filtering rebuilds the clustered source data (setData) — NOT a layer
  // filter — so clusters recount correctly for the plotted subset.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const base = view === "land" ? featuresRef.current.land : featuresRef.current.tracked;
    const filtered = base.filter((f) => {
      const p = (f.properties ?? {}) as unknown as DotProps;
      if (!activeTypes.has(p.ownerType)) return false;
      if (saleFilter && !p.sale) return false;
      if (view === "tracked" && violationFilter && !p.violation) return false;
      return true;
    });

    const src = map.getSource("vacancy-sites") as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData({ type: "FeatureCollection", features: filtered });

    // Marker layers: visible only on the tracked view, filtered by the same
    // owner-type + distress predicates (a separate, unclustered source).
    const markerClauses: unknown[] = [];
    if (activeTypes.size !== presentTypes.length) {
      const active = Array.from(activeTypes);
      markerClauses.push([
        "match",
        ["get", "ownerType"],
        active.length ? active : ["__none__"],
        true,
        false,
      ]);
    }
    if (saleFilter) markerClauses.push(["==", ["get", "sale"], true]);
    if (violationFilter) markerClauses.push(["==", ["get", "violation"], true]);
    const markerFilter =
      markerClauses.length === 0
        ? null
        : (["all", ...markerClauses] as unknown as mapboxgl.FilterSpecification);

    const markerVisible = view === "tracked";
    for (const layerId of ["vacancy-marker-disc", "vacancy-marker-number"]) {
      if (!map.getLayer(layerId)) continue;
      map.setLayoutProperty(layerId, "visibility", markerVisible ? "visible" : "none");
      map.setFilter(layerId, markerFilter);
    }
  }, [view, activeTypes, saleFilter, violationFilter, presentTypes, loaded]);

  // ── Cluster deep-link: fit + outline focusBbox whenever it changes ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const src = map.getSource("vacancy-focus") as mapboxgl.GeoJSONSource | undefined;
    if (!focusBbox) {
      if (src) src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const [w, s, e, n] = focusBbox;
    if (src) {
      src.setData({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s],
            ],
          ],
        },
        properties: {},
      });
    }
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 80, duration: 600, maxZoom: 16 },
    );
  }, [focusBbox, loaded]);

  function switchView(next: MapView) {
    if (next === view) return;
    if (next === "land" && landDisabled) return;
    setView(next);
    // Reset filters — owner-type + distress selections do not carry across views.
    setSaleFilter(false);
    setViolationFilter(false);
    setActiveTypes(new Set(next === "land" ? landPresent : trackedPresent));
    trackEvent("vacancy_map_view_toggled", {
      source: "vacancy_web_report",
      metadata: { zip, view: next },
    });
  }

  function toggleType(type: OwnerType) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  // ── SHOWING line: about the view universe (not the filtered subset) ──
  const distressFilterActive = saleFilter || (view === "tracked" && violationFilter);
  const shown = view === "land" ? landPoints?.length ?? 0 : sitePoints.length;
  const universeTotal = view === "land" ? landPointsTotal ?? shown : totalCount;
  const truncatedOrPartial =
    view === "land" ? landPointsTruncated || shown < universeTotal : shown < universeTotal;
  const noun = view === "land" ? "parcels" : "sites";

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

      {/* Collapsible legend + view toggle (top-right) */}
      <div className="absolute right-3 top-3 z-10 w-[230px] border border-[#0C1B33]/15 bg-white/95 backdrop-blur-sm">
        {/* Segmented view toggle — top of the overlay */}
        <div className="flex gap-px border-b border-[#0C1B33]/10 bg-[#0C1B33]/10">
          <button
            type="button"
            onClick={() => switchView("tracked")}
            className={`flex-1 px-2 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.08em] transition-colors ${
              view === "tracked" ? "bg-[#0C1B33] text-white" : "bg-white text-[#0C1B33]/55 hover:text-[#2563EB]"
            }`}
          >
            Tracked inventory
          </button>
          <button
            type="button"
            onClick={() => switchView("land")}
            disabled={landDisabled}
            title={landDisabled ? "Vacant-land parcels not yet exported for this ZIP" : undefined}
            className={`flex-1 px-2 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.08em] transition-colors ${
              view === "land" ? "bg-[#0C1B33] text-white" : "bg-white text-[#0C1B33]/55 hover:text-[#2563EB]"
            } ${landDisabled ? "cursor-not-allowed opacity-40 hover:text-[#0C1B33]/55" : ""}`}
          >
            Vacant land (reconciled)
          </button>
        </div>

        <button
          type="button"
          onClick={() => setLegendOpen((o) => !o)}
          className="flex w-full items-center justify-between px-3 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/70"
        >
          <span>Owner type</span>
          <span className="text-[#0C1B33]/40">{legendOpen ? "–" : "+"}</span>
        </button>
        {legendOpen && (
          <div className="max-h-[45vh] overflow-y-auto border-t border-[#0C1B33]/10 px-3 py-2.5 sm:max-h-none sm:overflow-visible">
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

            {/* Distress filters */}
            {(saleCount > 0 || (view === "tracked" && violationCount > 0)) && (
              <div className="mt-2.5 border-t border-[#0C1B33]/10 pt-2">
                <p className="mb-1.5 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                  Distress
                </p>
                <ul className="space-y-1.5">
                  <li>
                    <button
                      type="button"
                      onClick={() => setSaleFilter((v) => !v)}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <span
                        className="inline-block h-3 w-3 flex-shrink-0 rounded-full border-2"
                        style={{
                          backgroundColor: saleFilter ? DISTRESS_RED : "transparent",
                          borderColor: DISTRESS_RED,
                        }}
                      />
                      <span className={`flex-1 text-[11px] ${saleFilter ? "text-[#0C1B33]" : "text-[#0C1B33]/55"}`}>
                        Tax-sale record on file
                      </span>
                      <span className="font-mono-bureau text-[10px] text-[#0C1B33]/45">
                        {saleCount.toLocaleString("en-US")}
                      </span>
                    </button>
                  </li>
                  {view === "tracked" && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setViolationFilter((v) => !v)}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <span
                          className="inline-block h-3 w-3 flex-shrink-0 rounded-full border-2"
                          style={{
                            backgroundColor: violationFilter ? DISTRESS_RED : "transparent",
                            borderColor: DISTRESS_RED,
                          }}
                        />
                        <span
                          className={`flex-1 text-[11px] ${violationFilter ? "text-[#0C1B33]" : "text-[#0C1B33]/55"}`}
                        >
                          Building violations
                        </span>
                        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/45">
                          {violationCount.toLocaleString("en-US")}
                        </span>
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div className="mt-2.5 border-t border-[#0C1B33]/10 pt-2">
              <p className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
                {truncatedOrPartial
                  ? `Showing ${shown.toLocaleString("en-US")} of ${universeTotal.toLocaleString("en-US")}`
                  : `Showing all ${shown.toLocaleString("en-US")} ${noun}`}
                {distressFilterActive ? " · filtered" : ""}
              </p>
              {view === "tracked" ? (
                <p className="mt-1.5 text-[10px] leading-snug text-[#0C1B33]/45">
                  Numbered discs are the {siteIndex.filter((r) => r.markerNumber != null).length}{" "}
                  featured sites in the site index below.
                </p>
              ) : (
                <p className="mt-1.5 text-[10px] leading-snug text-[#0C1B33]/45">
                  City/Public via City-inventory PIN match; private types from taxpayer records.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
