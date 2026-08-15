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
import {
  compactParcelSpaceFacts,
  siteMatchAreaForProperty,
  vacancySpaceFacts,
} from "@/lib/parcel-space";
import {
  ACTIVITY_BADGE_ATTR,
  ACTIVITY_SLOT_ATTR,
  CARD_SCROLLER_ATTR,
  PERMIT_BADGE_ATTR,
  PERMIT_SLOT_ATTR,
  PARCEL_ENRICHMENT_SLOT_ATTR,
  PARCEL_ENRICHMENT_RETRY_ATTR,
  STAR_BUTTON_ATTR,
  ZONE_BADGE_ATTR,
  ZONE_SLOT_ATTR,
  activityBadgeText,
  buildSiteCardHtml,
  escapeHtml,
  permitBadgeText,
  permitMatchHtml,
  parcelEnrichmentHtml,
  programsAndZonesRows,
  siteActivityHtml,
  zoneBadgeText,
  type CardData,
} from "./vacancy-site-card";
import {
  cachedCandidateParcelEnrichment,
  fetchCandidateParcelEnrichment,
} from "@/lib/site-matchmaker-parcel-client";
import type { CandidateParcelEnrichmentState } from "@/lib/site-matchmaker-results";
import {
  fittedContentHeight,
  intersectRects,
  siteCardMaxHeight,
  siteCardMaxWidth,
  siteCardPanDelta,
  type FitRect,
} from "./vacancy-card-fit";
import { starredHaloFeatures, starredHaloPaint } from "./vacancy-star-layer";
import { useStarredKeys, useVacancyAdmin } from "./use-vacancy-admin";
import {
  cachedSiteZones,
  fetchSiteZones,
  type SiteZoneState,
} from "@/lib/vacancy-site-zones";
import {
  cachedSiteActivity,
  fetchSiteActivity,
  type SiteActivityState,
} from "@/lib/site-activity-client";
import {
  cachedPermitMatch,
  fetchPermitMatch,
  type PermitMatchState,
} from "@/lib/permit-match-client";
import {
  STARRED_RING,
  siteStarKey,
  toggleStarredSite,
} from "@/lib/vacancy-starred";
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
  /** True only for the namespaced Site Matchmaker handoff. The supplied point
   *  arrays have already been reduced using supported property-type and
   *  published-size criteria, so the showing line must describe a prefilter
   *  rather than implying it is the full edition universe. */
  siteMatchmakerPrefilter?: boolean;
  /** Vacancy-index build id for source-safe on-demand County parcel caching. */
  siteMatchmakerBuildId?: string;
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
  lotAreaSqft: number | null;
  assessorBuildingSqft: number | null;
  assessorBuildingYear: number | null;
  cityGroundFootprintSqft: number | null;
  cityGroundFootprintVintage: string | null;
  availableSpaceSqft: number | null;
  availableSpaceSource: string | null;
  availableSpaceVerifiedAt: string | null;
  availableSpaceReconfirmAfter: string | null;
  sizeMatchKnown: boolean;
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
  siteMatchmakerPrefilter = false,
  siteMatchmakerBuildId = "",
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
  const dataRef = useRef({ zip, boundary, bbox, centroid, sitePoints, siteIndex, landPoints, clusters, corridors, anchors, asOf, neighborhood, initialAreaId, siteMatchmakerPrefilter, siteMatchmakerBuildId });
  dataRef.current = { zip, boundary, bbox, centroid, sitePoints, siteIndex, landPoints, clusters, corridors, anchors, asOf, neighborhood, initialAreaId, siteMatchmakerPrefilter, siteMatchmakerBuildId };

  // Current view read through a ref so the mount-once popup handler stays fresh.
  const viewRef = useRef(view);
  viewRef.current = view;

  // ── Starred locations (admin only) ──
  // A confirmed Owner Files admin session is the single gate: a public reader
  // sees no star control on the card and no gold halo on the map, and the probe
  // wipes any stale saved set left behind on a shared machine.
  const isAdmin = useVacancyAdmin();
  const starredKeys = useStarredKeys();
  const adminRef = useRef(isAdmin);
  adminRef.current = isAdmin;
  const starredRef = useRef(starredKeys);
  starredRef.current = starredKeys;

  // Both views' full (unfiltered) feature collections plus the numbered
  // featured-site markers, built once at init.
  const featuresRef = useRef<{
    tracked: GeoJSON.Feature[];
    land: GeoJSON.Feature[];
    markers: GeoJSON.Feature[];
  }>({
    tracked: [],
    land: [],
    markers: [],
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
      siteMatchmakerPrefilter: useSizeMatchStyling,
      siteMatchmakerBuildId: parcelBuildId,
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
      const matchingArea = siteMatchAreaForProperty(
        p.propertyType,
        vacancySpaceFacts(p.propertyType, p.space, p.squareFeet),
      ).sqft;
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
        lotAreaSqft:
          p.space?.lotAreaSqft ?? (p.propertyType === "vacant_land" ? p.squareFeet : null),
        assessorBuildingSqft: p.space?.assessorBuildingSqft ?? null,
        assessorBuildingYear: p.space?.assessorBuildingYear ?? null,
        cityGroundFootprintSqft: p.space?.cityGroundFootprintSqft ?? null,
        cityGroundFootprintVintage: p.space?.cityGroundFootprintVintage ?? null,
        availableSpaceSqft: p.space?.availableSpaceSqft ?? null,
        availableSpaceSource: p.space?.availableSpaceSource ?? null,
        availableSpaceVerifiedAt: p.space?.availableSpaceVerifiedAt ?? null,
        availableSpaceReconfirmAfter: p.space?.availableSpaceReconfirmAfter ?? null,
        sizeMatchKnown: matchingArea !== null,
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
      const matchingArea = siteMatchAreaForProperty(
        "vacant_land",
        vacancySpaceFacts("vacant_land", p.space, p.squareFeet),
      ).sqft;
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
        lotAreaSqft: p.space?.lotAreaSqft ?? p.squareFeet,
        assessorBuildingSqft: p.space?.assessorBuildingSqft ?? null,
        assessorBuildingYear: p.space?.assessorBuildingYear ?? null,
        cityGroundFootprintSqft: p.space?.cityGroundFootprintSqft ?? null,
        cityGroundFootprintVintage: p.space?.cityGroundFootprintVintage ?? null,
        availableSpaceSqft: p.space?.availableSpaceSqft ?? null,
        availableSpaceSource: p.space?.availableSpaceSource ?? null,
        availableSpaceVerifiedAt: p.space?.availableSpaceVerifiedAt ?? null,
        availableSpaceReconfirmAfter: p.space?.availableSpaceReconfirmAfter ?? null,
        sizeMatchKnown: matchingArea !== null,
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
      const propertyType = sp?.propertyType ?? r.propertyType;
      const matchingArea = siteMatchAreaForProperty(
        propertyType,
        vacancySpaceFacts(propertyType, sp?.space, sp?.squareFeet ?? r.squareFeet),
      ).sqft;
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
        lotAreaSqft:
          sp?.space?.lotAreaSqft ??
          (r.propertyType === "vacant_land" ? (sp?.squareFeet ?? r.squareFeet) : null),
        assessorBuildingSqft: sp?.space?.assessorBuildingSqft ?? null,
        assessorBuildingYear: sp?.space?.assessorBuildingYear ?? null,
        cityGroundFootprintSqft: sp?.space?.cityGroundFootprintSqft ?? null,
        cityGroundFootprintVintage: sp?.space?.cityGroundFootprintVintage ?? null,
        availableSpaceSqft: sp?.space?.availableSpaceSqft ?? null,
        availableSpaceSource: sp?.space?.availableSpaceSource ?? null,
        availableSpaceVerifiedAt: sp?.space?.availableSpaceVerifiedAt ?? null,
        availableSpaceReconfirmAfter: sp?.space?.availableSpaceReconfirmAfter ?? null,
        sizeMatchKnown: matchingArea !== null,
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

    featuresRef.current = {
      tracked: trackedFeatures,
      land: landFeatures,
      markers: markerFeatures,
    };

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

      // ── Starred halo (admin) — added BEFORE the dot layer so it draws
      //    beneath: the gold annulus surrounds the dot, leaving the owner-type
      //    fill and the red distress ring fully readable inside it. Empty for
      //    everyone but a signed-in admin with saved sites. ──
      map.addSource("vacancy-starred", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "vacancy-starred-halo",
        type: "circle",
        source: "vacancy-starred",
        paint: starredHaloPaint() as unknown as mapboxgl.CircleLayerSpecification["paint"],
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
          "circle-opacity": useSizeMatchStyling
            ? ["case", ["==", ["get", "sizeMatchKnown"], true], 0.95, 0.48]
            : 0.95,
          // Distressed dots (tax-sale exposed OR violation-matched) get a red ring.
          "circle-stroke-width": useSizeMatchStyling
            ? [
                "case",
                ["==", ["get", "distressed"], true], 2,
                ["==", ["get", "sizeMatchKnown"], false], 2.5,
                1.5,
              ]
            : ["case", ["==", ["get", "distressed"], true], 2, 1.5],
          "circle-stroke-color": useSizeMatchStyling
            ? [
                "case",
                ["==", ["get", "distressed"], true], DISTRESS_RED,
                ["==", ["get", "sizeMatchKnown"], false], "#D97706",
                "#ffffff",
              ]
            : ["case", ["==", ["get", "distressed"], true], DISTRESS_RED, "#ffffff"],
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
          "circle-opacity": useSizeMatchStyling
            ? ["case", ["==", ["get", "sizeMatchKnown"], true], 1, 0.55]
            : 1,
          "circle-stroke-width": 2,
          // Distressed featured sites ring red too (else white).
          "circle-stroke-color": useSizeMatchStyling
            ? [
                "case",
                ["==", ["get", "distressed"], true], DISTRESS_RED,
                ["==", ["get", "sizeMatchKnown"], false], "#D97706",
                "#ffffff",
              ]
            : ["case", ["==", ["get", "distressed"], true], DISTRESS_RED, "#ffffff"],
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

      /**
       * The box the card must stay inside: the map frame INTERSECTED with the
       * window. The map is 560px tall inside a scrolling page, so on a short
       * window — or with the page parked mid-map — part of the frame is past
       * the fold, and seating the card inside the map element alone would still
       * leave its tail below the window edge.
       */
      const containerRect = (): FitRect => {
        const r = map.getContainer().getBoundingClientRect();
        return intersectRects(
          { top: r.top, left: r.left, width: r.width, height: r.height },
          {
            top: 0,
            left: 0,
            width: window.innerWidth || r.width,
            height: window.innerHeight || r.height,
          },
        );
      };

      /**
       * The viewport fit, both halves, run on open and again on every accordion
       * toggle (opening "Data and sources" is precisely what used to push the
       * card's tail off screen):
       *   1. GUARANTEE — re-cap the card's scroll container using the popup's
       *      MEASURED chrome, which the pre-mount estimate can only approximate.
       *   2. OFFSET — pan the map by the card's remaining overflow. Panning
       *      moves the anchor and the popup together, so the pin stays with it.
       */
      const refitCard = (popup: mapboxgl.Popup) => {
        const el = popup.getElement();
        if (!el || !popup.isOpen()) return;

        const frame = containerRect();
        if (frame.height <= 0 || frame.width <= 0) return;

        const scroller = el.querySelector<HTMLElement>(`[${CARD_SCROLLER_ATTR}]`);
        if (scroller) {
          const chrome = el.getBoundingClientRect().height - scroller.clientHeight;
          scroller.style.maxHeight = `${fittedContentHeight(frame.height, chrome)}px`;
        }

        const box = el.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) return;
        const [dx, dy] = siteCardPanDelta(
          { top: box.top, left: box.left, width: box.width, height: box.height },
          frame,
        );
        if (dx !== 0 || dy !== 0) map.panBy([dx, dy], { duration: 220 });
      };

      const openSitePopup = (
        lngLat: mapboxgl.LngLatLike,
        p: Record<string, unknown>,
        at: { lat: number; lon: number } | null,
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
          space: compactParcelSpaceFacts({
            lotAreaSqft: p.lotAreaSqft == null ? undefined : Number(p.lotAreaSqft),
            assessorBuildingSqft:
              p.assessorBuildingSqft == null ? undefined : Number(p.assessorBuildingSqft),
            assessorBuildingYear:
              p.assessorBuildingYear == null ? undefined : Number(p.assessorBuildingYear),
            cityGroundFootprintSqft:
              p.cityGroundFootprintSqft == null
                ? undefined
                : Number(p.cityGroundFootprintSqft),
            cityGroundFootprintVintage:
              typeof p.cityGroundFootprintVintage === "string"
                ? p.cityGroundFootprintVintage
                : undefined,
            availableSpaceSqft:
              p.availableSpaceSqft == null ? undefined : Number(p.availableSpaceSqft),
            availableSpaceSource:
              typeof p.availableSpaceSource === "string" ? p.availableSpaceSource : undefined,
            availableSpaceVerifiedAt:
              typeof p.availableSpaceVerifiedAt === "string"
                ? p.availableSpaceVerifiedAt
                : undefined,
            availableSpaceReconfirmAfter:
              typeof p.availableSpaceReconfirmAfter === "string"
                ? p.availableSpaceReconfirmAfter
                : undefined,
          }),
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
          lat: at?.lat ?? null,
          lon: at?.lon ?? null,
        };

        // Live place-based coverage: already-memoized for this coordinate, else
        // a lookup we kick off below and patch into the card when it lands.
        const cached = at ? cachedSiteZones(at.lat, at.lon) : null;
        const initialZones: SiteZoneState = cached ?? (at ? { status: "loading" } : { status: "idle" });

        // Public site-activity measurements for this exact point, same pattern.
        // The request is made HERE — on a parcel the reader actually selected —
        // and never for the thousands of dots on the layer, so opening the map
        // costs nothing and each card costs one small cached JSON response.
        const cachedActivity = at ? cachedSiteActivity(at.lat, at.lon) : null;
        const initialActivity: SiteActivityState =
          cachedActivity ?? (at ? { status: "loading" } : { status: "idle" });

        // Matched building-permit records for THIS parcel, keyed by its
        // 14-digit PIN. A card without a PIN (311 building rows carry none)
        // gets no permit section at all rather than an unanswerable one — the
        // same rule the "No county PIN on record yet" action line already uses.
        const permitPin = (data.pin ?? "").replace(/\D/g, "");
        const canCheckPermits = permitPin.length === 14;
        const cachedPermits = canCheckPermits ? cachedPermitMatch(permitPin) : null;
        const initialPermits: PermitMatchState =
          cachedPermits ?? (canCheckPermits ? { status: "loading" } : { status: "idle" });

        const cachedParcel = useSizeMatchStyling
          ? cachedCandidateParcelEnrichment(parcelBuildId, data.pin)
          : null;
        const initialParcel =
          cachedParcel ??
          (useSizeMatchStyling && canCheckPermits && parcelBuildId
            ? { status: "loading" as const }
            : { status: "not_checked" as const });

        // Star affordance ONLY for a confirmed admin session.
        const starKey = siteStarKey({ pin: data.pin, address: data.address });
        const showStar = adminRef.current && starKey !== "";

        const frame = containerRect();
        const html = buildSiteCardHtml(data, zipForLinks, asOfLabel ?? null, {
          maxHeightPx: siteCardMaxHeight(frame.height),
          zones: initialZones,
          activity: initialActivity,
          permits: initialPermits,
          parcelEnrichment: initialParcel,
          star: showStar ? { key: starKey, starred: starredRef.current.has(starKey) } : null,
        });

        const popup = new mapboxgl.Popup({
          maxWidth: `${siteCardMaxWidth(frame.width)}px`,
          className: "bureau-popup",
        })
          .setLngLat(lngLat)
          .setHTML(html)
          .addTo(map);

        const el = popup.getElement();

        // Keep a scroll INSIDE the capped card from reaching the map: without
        // this, a wheel over the card zooms the map and a touch-drag pans it.
        const scroller = el?.querySelector<HTMLElement>(`[${CARD_SCROLLER_ATTR}]`);
        if (scroller) {
          scroller.addEventListener("wheel", (e) => e.stopPropagation());
          scroller.addEventListener("touchmove", (e) => e.stopPropagation());
        }

        // Fit on open, and again whenever an accordion changes the card's size.
        // `toggle` does not bubble, so listen in the capture phase.
        requestAnimationFrame(() => refitCard(popup));
        el?.addEventListener("toggle", () => refitCard(popup), true);

        // Star toggle — mutates the shared store (which repaints the halo via
        // the React subscription) and updates this button in place, so the
        // reader's open accordions survive the click.
        const starButton = el?.querySelector<HTMLButtonElement>(`[${STAR_BUTTON_ATTR}]`);
        starButton?.addEventListener("click", () => {
          const next = toggleStarredSite({
            address: data.address ?? "",
            pin: data.pin,
            zip: zipForLinks,
            propertyType: data.propertyType,
          });
          const nowStarred = next.some((s) => s.key === starKey);
          starButton.textContent = nowStarred ? "★" : "☆";
          starButton.setAttribute("aria-pressed", nowStarred ? "true" : "false");
          starButton.style.color = nowStarred ? STARRED_RING : "#8A93A6";
          starButton.style.borderColor = nowStarred ? STARRED_RING : "#0C1B3325";
          starButton.title = nowStarred
            ? "Remove from starred locations"
            : "Save to starred locations";
        });

        // Resolve the geographies containing this point and patch the two
        // Programs-and-zones nodes. Bail if the reader closed the card first.
        if (at && initialZones.status === "loading") {
          void fetchSiteZones(at.lat, at.lon).then((state) => {
            if (!popup.isOpen()) return;
            const slot = el?.querySelector<HTMLElement>(`[${ZONE_SLOT_ATTR}]`);
            if (slot) {
              slot.innerHTML = programsAndZonesRows(data, state)
                .map((r) => `<div>${r}</div>`)
                .join("");
            }
            const badge = el?.querySelector<HTMLElement>(`[${ZONE_BADGE_ATTR}]`);
            if (badge) badge.textContent = zoneBadgeText(state);
            refitCard(popup);
          });
        }

        // Same for the public site-activity measurements. A failed lookup
        // patches in "could not check" — never an empty block, which would
        // read as "nothing is happening around this parcel".
        if (at && initialActivity.status === "loading") {
          void fetchSiteActivity(at.lat, at.lon).then((state) => {
            if (!popup.isOpen()) return;
            const slot = el?.querySelector<HTMLElement>(`[${ACTIVITY_SLOT_ATTR}]`);
            if (slot) slot.innerHTML = siteActivityHtml(state);
            const badge = el?.querySelector<HTMLElement>(`[${ACTIVITY_BADGE_ATTR}]`);
            if (badge) badge.textContent = activityBadgeText(state);
            refitCard(popup);
          });
        }

        // And the matched permit record. A failed lookup patches in "could not
        // check"; only a completed lookup that genuinely returned nothing can
        // print the absence sentence.
        if (canCheckPermits && initialPermits.status === "loading") {
          void fetchPermitMatch(permitPin).then((state) => {
            if (!popup.isOpen()) return;
            const slot = el?.querySelector<HTMLElement>(`[${PERMIT_SLOT_ATTR}]`);
            if (slot) slot.innerHTML = permitMatchHtml(state);
            const badge = el?.querySelector<HTMLElement>(`[${PERMIT_BADGE_ATTR}]`);
            if (badge) badge.textContent = permitBadgeText(state);
            refitCard(popup);
          });
        }

        const patchParcelEnrichment = (state: CandidateParcelEnrichmentState) => {
          if (!popup.isOpen()) return;
          const slot = el?.querySelector<HTMLElement>(`[${PARCEL_ENRICHMENT_SLOT_ATTR}]`);
          if (!slot) return;
          slot.innerHTML = parcelEnrichmentHtml(state);
          const retry = slot.querySelector<HTMLButtonElement>(
            `[${PARCEL_ENRICHMENT_RETRY_ATTR}]`,
          );
          retry?.addEventListener("click", () => requestParcelEnrichment());
          refitCard(popup);
        };
        const requestParcelEnrichment = () => {
          patchParcelEnrichment({ status: "loading" });
          void fetchCandidateParcelEnrichment(parcelBuildId, data.pin).then(
            patchParcelEnrichment,
          );
        };
        if (initialParcel.status === "loading") requestParcelEnrichment();
      };

      for (const layerId of ["vacancy-unclustered", "vacancy-marker-disc"]) {
        map.on("click", layerId, (e) => {
          if (!e.features?.length) return;
          const geometry = e.features[0].geometry;
          const at =
            geometry?.type === "Point"
              ? {
                  lon: (geometry.coordinates as [number, number])[0],
                  lat: (geometry.coordinates as [number, number])[1],
                }
              : { lat: e.lngLat.lat, lon: e.lngLat.lng };
          openSitePopup(e.lngLat, e.features[0].properties ?? {}, at);
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

    // Starred halos track the PLOTTED set, so a starred site hidden by an
    // owner-type or distress filter leaves no orphan ring behind. A non-admin
    // always gets an empty collection — the gate is here as well as on the card.
    const starredSrc = map.getSource("vacancy-starred") as mapboxgl.GeoJSONSource | undefined;
    if (starredSrc) {
      starredSrc.setData({
        type: "FeatureCollection",
        features: isAdmin
          ? starredHaloFeatures(
              filtered,
              featuresRef.current.markers,
              starredKeys,
              view === "tracked",
            )
          : [],
      });
    }

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
  }, [view, activeTypes, saleFilter, violationFilter, presentTypes, loaded, isAdmin, starredKeys]);

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

            {/* Starred key — admin only, so a public reader never sees it. */}
            {isAdmin && (
              <div className="mt-2.5 border-t border-[#0C1B33]/10 pt-2">
                <p className="mb-1.5 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                  Starred
                </p>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 flex-shrink-0 rounded-full border-2"
                    style={{ borderColor: STARRED_RING, backgroundColor: `${STARRED_RING}29` }}
                  />
                  <span className="flex-1 text-[11px] text-[#0C1B33]/55">
                    {starredKeys.size === 0
                      ? "Star a site from its card"
                      : `${starredKeys.size.toLocaleString("en-US")} saved on this browser`}
                  </span>
                </div>
              </div>
            )}

            <div className="mt-2.5 border-t border-[#0C1B33]/10 pt-2">
              <p className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
                {siteMatchmakerPrefilter
                  ? `Showing ${shown.toLocaleString("en-US")} prefiltered ${noun}`
                  : truncatedOrPartial
                  ? `Showing ${shown.toLocaleString("en-US")} of ${universeTotal.toLocaleString("en-US")}`
                  : `Showing all ${shown.toLocaleString("en-US")} ${noun}`}
                {distressFilterActive ? " · filtered" : ""}
              </p>
              {siteMatchmakerPrefilter ? (
                <div className="mt-1.5 flex items-start gap-2 text-[10px] leading-snug text-[#0C1B33]/45">
                  <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-[#D97706] bg-[#0C1B33]/20" />
                  <p>
                    Property type is applied to loaded records. Source-backed size criteria are
                    applied where the matching field exists; amber-ringed sites need size
                    verification and are not counted as matches.
                  </p>
                </div>
              ) : null}
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
