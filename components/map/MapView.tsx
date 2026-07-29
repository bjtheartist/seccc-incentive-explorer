"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ArcLayer, ScatterplotLayer } from "@deck.gl/layers";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { Layers } from "lucide-react";
import { ZONE_COLORS, ZONE_LABELS, ZONE_KEYS, ZONE_TILESET_IDS, ZONING_CATEGORIES, describeZoneClass, VACANT_COLORS } from "@/lib/constants";
import { OWNER_TYPE_LABELS, OWNER_TYPE_COLORS, presentOwnerTypesInOrder, type OwnerType } from "@/lib/owner-classify";
import { runConfidenceEngine } from "@/lib/confidence-engine";
import { describeClassCode, describeParcelType } from "@/lib/parcel-classes";
import { normalizeZoneCheckResponse } from "@/lib/zone-response";
import type { Program, ProgramCheckResult, ParcelData, DistrictData } from "@/lib/types";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import MapSearch from "./MapSearch";
import MapLegendPanel from "./MapLegendPanel";
import MapMobileSheet from "./MapMobileSheet";
import MapSnapshotPanel from "./MapSnapshotPanel";
import MapPolygonPanel from "./MapPolygonPanel";
import CountyReliefRecipientsPanel, {
  type CountyReliefRecipientsPanelStatus,
} from "./CountyReliefRecipientsPanel";
import type { MobileMapPresetId } from "./map-layer-presets";
import { cachedFetch } from "@/lib/fetch-cache";
import { getSiteSignals } from "@/lib/site-signals";
import { getTransportAccess } from "@/lib/transport-access";
import type { TifFinanceContext } from "@/lib/tif-finance";
import { trackEvent } from "@/lib/analytics-events";
import {
  buildLocationContext,
  summarizeLocationContextForMap,
} from "@/lib/location-context";
import {
  POINT_ZONE_KEYS, HEAVY_COVERAGE_KEYS,
  COMMUNITY_AREAS_URL, CHICAGO_ZONING_URL, EMPTY_FC, PARCELS_QUERY_BASE,
  fetchZoneGeoJSON,
  POI_LAYERS, jsonToGeoJSON, MAP_PRESETS,
  buildOwnerClusterPopupHtml,
  buildInvestmentPopupHtml,
  buildCountyReliefPopupHtml,
  buildHistoricalRecoveryZipPopupHtml,
  formatAwardedAmount,
  type AreaStats, DEFAULT_STATS,
} from "./map-helpers";
import {
  loadStoredOwnerClustersVisible,
  storeOwnerClustersVisible,
} from "@/lib/owner-clusters-toggle";
import {
  loadStoredCommunityInvestmentVisible,
  storeCommunityInvestmentVisible,
} from "@/lib/community-investment-toggle";
import {
  fetchCommunityInvestmentLayer,
  fetchHistoricalRecoveryRecipients,
  filterInvestmentPointFeatures,
  investmentFeatureCollection,
  summarizeCitywideEntries,
  DEFAULT_INVESTMENT_YEAR_RANGE,
  FUNDER_TYPE_COLORS,
  FUNDER_TYPE_ORDER,
  INVESTMENT_FALLBACK_COLOR,
  CAPITAL_CLASS_OUTLINE,
  buildMegaprojectFeatures,
  excludeMegaprojectFeatures,
  megaprojectFeatureCollection,
  summarizeMegaprojects,
  MEGAPROJECT_STATUS_GROUP_COLORS,
  type InvestmentPointFeature,
  type CitywideInvestmentEntry,
  type CountyReliefZipSummary,
  type HistoricalRecoveryZipSummary,
  type HistoricalRecoveryRecipient,
  type HistoricalRecoveryRecipientSource,
  type MegaprojectPointFeature,
  type MegaprojectSummary,
} from "@/lib/community-investment-layer";
import type { CapitalClass, FunderType } from "@/lib/community-investment";
import { CHICAGO_COMMUNITY_AREAS } from "@/lib/community-areas";
import {
  loadInvestmentSession,
  patchInvestmentSession,
  sessionFromQuery,
  funderTypeRecordFromSession,
  sessionFunderTypesFromRecord,
} from "@/lib/investment-session";
import {
  loadStoredInvestmentViewMode,
  storeInvestmentViewMode,
  loadStoredInvestmentMegaprojectsVisible,
  storeInvestmentMegaprojectsVisible,
  buildInvestmentArcData,
  indexFunderHqsByName,
  makeArcWidthScale,
  PHILANTHROPIC_ARC_COLOR,
  DENSITY_COLOR_RANGE,
  HEXAGON_RADIUS_M,
  densityWeightForMetric,
  DEFAULT_INVESTMENT_DENSITY_METRIC,
  isInvestmentViewMode,
  type InvestmentViewMode,
  type InvestmentDensityMetric,
  type InvestmentArcDatum,
  type FunderHq,
} from "@/lib/investment-deck-modes";
import {
  loadStoredPublicInvestmentOverlayVisibility,
  PUBLIC_INVESTMENT_OVERLAY_COLORS,
  PUBLIC_INVESTMENT_OVERLAY_IDS,
  publicInvestmentOverlayIdForSource,
  shouldKeepRecipientsPanelOpen,
  storePublicInvestmentOverlayVisibility,
  withPublicInvestmentOverlayVisibility,
  type PublicInvestmentOverlayId,
  type PublicInvestmentOverlayVisibility,
} from "@/lib/public-investment-overlays";
import {
  buildCountyReliefFeatureCollection,
  COUNTY_RELIEF_BOUNDARIES_ENDPOINT,
  COUNTY_RELIEF_FILL_COLOR,
  COUNTY_RELIEF_FILL_LAYER_ID,
  COUNTY_RELIEF_LINE_COLOR,
  COUNTY_RELIEF_LINE_LAYER_ID,
  COUNTY_RELIEF_SOURCE_ID,
  type ZipBoundaryFeatureCollection,
} from "@/lib/county-relief-layer";
import {
  buildStateRecoveryFeatureCollection,
  STATE_RECOVERY_FILL_COLOR,
  STATE_RECOVERY_FILL_LAYER_ID,
  STATE_RECOVERY_LINE_COLOR,
  STATE_RECOVERY_LINE_LAYER_ID,
  STATE_RECOVERY_SOURCE_ID,
} from "@/lib/state-recovery-layer";

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
  // Timestamp when the legend opened, to ignore the iOS post-tap ghost click.
  const legendOpenedAtRef = useRef(0);
  useEffect(() => { if (legendOpen) legendOpenedAtRef.current = Date.now(); }, [legendOpen]);
  // Timestamp when a map tap opened the snapshot — MapSnapshotPanel uses it to
  // ignore the same ghost click, which otherwise lands on the ×/links/CTA.
  const snapshotOpenedAtRef = useRef(0);
  const [zoningRefOpen, setZoningRefOpen] = useState(false);
  const [classRefOpen, setClassRefOpen] = useState(false);
  const [zoningInfo, setZoningInfo] = useState<string | null>(null);
  const [areaStats, setAreaStats] = useState<AreaStats>(DEFAULT_STATS);
  const [snapshotLabel, setSnapshotLabel] = useState("Chicago (default)");
  const [, setCopiedLink] = useState(false);
  const [expandedZone, setExpandedZone] = useState<string | null>(null);

  // Preset state
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [locationZones, setLocationZones] = useState<Record<string, boolean> | null>(null);

  // Inspect zoning mode
  const [inspectMode, setInspectMode] = useState(false);

  // Enhanced Area Snapshot
  const [snapshotPrograms, setSnapshotPrograms] = useState<ProgramCheckResult[]>([]);
  const [snapshotTifFinance, setSnapshotTifFinance] = useState<TifFinanceContext | null>(null);
  const [locationZoneNames, setLocationZoneNames] = useState<Record<string, string> | null>(null);
  const [snapshotParcelData, setSnapshotParcelData] = useState<ParcelData | null>(null);
  const [tifFinanceLoading, setTifFinanceLoading] = useState(false);
  const [lastClickLat, setLastClickLat] = useState<number | null>(null);
  const [lastClickLon, setLastClickLon] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isGeneratingSnapshot, setIsGeneratingSnapshot] = useState(false);
  const [allPrograms, setAllPrograms] = useState<Program[]>([]);
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
  const [ownerFilter, setOwnerFilter] = useState<OwnerType | "all">("all");

  // Admin-gated ownership-cluster layer (Owner Files, PRs #65/#67/#68).
  // adminSessionActive comes from a one-time /api/owner-file/session probe;
  // the layer itself only ever fetches /api/owner-file/geo once per session
  // when toggled on, since the source dataset is a small nine-ZIP pilot
  // export rather than a citywide live query like vacant properties.
  // The toggle is sessionStorage-backed (lib/owner-clusters-toggle.ts):
  // the demo flow hard-navigates to /report (handleGenerateSnapshot) and
  // back, remounting MapView and resetting useState — without persistence
  // the admin layer silently unchecked on every report round-trip.
  const [adminSessionActive, setAdminSessionActive] = useState(false);
  const [ownerClustersVisible, setOwnerClustersVisible] = useState<boolean>(() =>
    loadStoredOwnerClustersVisible()
  );
  const setOwnerClustersVisiblePersistent = useCallback((value: boolean) => {
    setOwnerClustersVisible(value);
    storeOwnerClustersVisible(value);
  }, []);
  const [ownerClustersLoaded, setOwnerClustersLoaded] = useState(false);
  const [ownerClustersLoading, setOwnerClustersLoading] = useState(false);
  const [ownerClustersError, setOwnerClustersError] = useState<string | null>(null);
  // Owner types actually present in the loaded ownership-cluster data, for
  // MapLegendPanel's data-driven color key — recomputed once per fetch, not
  // on every render.
  const [ownerClustersPresentTypes, setOwnerClustersPresentTypes] = useState<OwnerType[]>([]);

  // Admin-gated "Community investment" layer with public/philanthropic base
  // views and an independent private-development overlay. Same gating precedent:
  // rendered only when adminSessionActive, fetched once per toggle-on from the
  // gated /api/owner-file/investment endpoint (a small static export, not a
  // per-viewport query), and sessionStorage-backed so the toggle survives the
  // /report round-trip that remounts MapView. Base circles are colored by
  // funderType and sized by their own capital field; citywide records never plot.
  const [communityInvestmentVisible, setCommunityInvestmentVisible] = useState<boolean>(() =>
    loadStoredCommunityInvestmentVisible()
  );
  const setCommunityInvestmentVisiblePersistent = useCallback((value: boolean) => {
    setCommunityInvestmentVisible(value);
    storeCommunityInvestmentVisible(value);
  }, []);
  const [communityInvestmentLoaded, setCommunityInvestmentLoaded] = useState(false);
  const [communityInvestmentLoading, setCommunityInvestmentLoading] = useState(false);
  const [communityInvestmentError, setCommunityInvestmentError] = useState<string | null>(null);
  const [investmentPresentFunderTypes, setInvestmentPresentFunderTypes] = useState<FunderType[]>([]);
  // Capital classes present among plotted dots — drives the legend's capital-class
  // sub-legend (grant / TIF / federal / tax-credit). Set on each fetch.
  const [investmentPresentCapitalClasses, setInvestmentPresentCapitalClasses] = useState<CapitalClass[]>([]);
  // Number of tracked foundation HQs (the Arcs "Foundation flows (N tracked HQs)"
  // honest label). Set from the gated fetch's funderHqs.length.
  const [investmentFunderHqCount, setInvestmentFunderHqCount] = useState(0);
  // Year range + funderType checkboxes seed from the SHARED investment session
  // (lib/investment-session.ts) so a filter set on the map survives a round-trip
  // to the /investment analysis pages and back (Sol #1). Same sessionStorage-in-
  // initializer pattern as the toggle/view-mode above.
  const [investmentYearRange, setInvestmentYearRange] = useState<string>(
    () => loadInvestmentSession().yearWindow ?? DEFAULT_INVESTMENT_YEAR_RANGE
  );
  const setInvestmentYearRangePersistent = useCallback((id: string) => {
    setInvestmentYearRange(id);
    patchInvestmentSession({ yearWindow: id });
  }, []);
  const [investmentFunderTypes, setInvestmentFunderTypes] = useState<Record<FunderType, boolean>>(
    () => funderTypeRecordFromSession(loadInvestmentSession().funderTypes)
  );
  const [investmentCitywide, setInvestmentCitywide] = useState<{ count: number; totalDollars: number } | null>(
    null
  );
  // All plotted point features from the last fetch, kept in a ref so the
  // year/funderType filter effect can rebuild the source (setData) without a
  // re-fetch — mirrors VacancyReportMap's featuresRef distress-filter pattern.
  const investmentFeaturesRef = useRef<InvestmentPointFeature[]>([]);
  // Citywide (non-plotting) entries from the last fetch, kept in a ref so the
  // same filter effect can re-scope the legend's "Citywide commitments" figure
  // to the active year/funderType instead of freezing it at the unfiltered total.
  const investmentCitywideEntriesRef = useRef<CitywideInvestmentEntry[]>([]);
  const toggleInvestmentFunderType = useCallback((key: FunderType) => {
    setInvestmentFunderTypes((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Mirror the new checkbox set into the shared session so it survives a
      // map ↔ analysis round-trip.
      patchInvestmentSession({ funderTypes: sessionFunderTypesFromRecord(next) });
      return next;
    });
  }, []);

  // Density metric (Sol #4): dollars ($ awarded per bin) | records (grant count
  // per bin). Component state — the choice is not persisted across the /report
  // remount (unlike the view mode). Dots is unaffected.
  const [investmentDensityMetric, setInvestmentDensityMetric] =
    useState<InvestmentDensityMetric>(DEFAULT_INVESTMENT_DENSITY_METRIC);

  // Admin-only VIEW MODES for the investment layer (Dots | Arcs | Density).
  // sessionStorage-persisted like the toggle so the choice survives the /report
  // remount; Dots is the unchanged default (the existing mapbox circle layer).
  // Arcs/Density render through a single deck.gl MapboxOverlay (created lazily,
  // fully removed when the layer is hidden or the component unmounts — no leaked
  // WebGL contexts). All three share the same year/funderType filters.
  const [investmentViewMode, setInvestmentViewMode] = useState<InvestmentViewMode>(() =>
    loadStoredInvestmentViewMode()
  );
  const setInvestmentViewModePersistent = useCallback((mode: InvestmentViewMode) => {
    setInvestmentViewMode(mode);
    storeInvestmentViewMode(mode);
  }, []);
  const [investmentMegaprojectsVisible, setInvestmentMegaprojectsVisible] = useState<boolean>(() =>
    loadStoredInvestmentMegaprojectsVisible()
  );
  const setInvestmentMegaprojectsVisiblePersistent = useCallback((visible: boolean) => {
    setInvestmentMegaprojectsVisible(visible);
    storeInvestmentMegaprojectsVisible(visible);
  }, []);
  const [publicInvestmentOverlays, setPublicInvestmentOverlays] = useState(
    () => loadStoredPublicInvestmentOverlayVisibility()
  );
  const setPublicInvestmentOverlayPersistent = useCallback(
    (id: PublicInvestmentOverlayId, visible: boolean) => {
      setPublicInvestmentOverlays((current) => {
        const next = withPublicInvestmentOverlayVisibility(current, id, visible);
        storePublicInvestmentOverlayVisibility(next);
        return next;
      });
    },
    []
  );
  // Foundation-HQ coordinates from the last gated fetch — the Arcs source.
  const investmentFunderHqsRef = useRef<FunderHq[]>([]);
  // The one deck.gl overlay (created on first entry into a non-Dots mode, torn
  // down when the layer is hidden / mode returns to Dots / on unmount).
  const prevInvestmentViewModeRef = useRef<string | null>(null);
  const prevInvestmentMegaprojectsVisibleRef = useRef<boolean | null>(null);
  // Previous overlay visibility, so the shared popup can be dismissed on an
  // overlay transition the same way it is on a view-mode/megaproject one.
  const prevPublicInvestmentOverlaysRef = useRef<PublicInvestmentOverlayVisibility | null>(null);
  const deckOverlayRef = useRef<MapboxOverlay | null>(null);
  // The shared mapbox dot popup, kept in a ref so the deck effect can close it
  // when entering a non-Dots mode (deck's picking tooltip takes over there).
  const sharedDotPopupRef = useRef<mapboxgl.Popup | null>(null);
  // "N grants without a mapped funder HQ shown as dots" — the Arcs fallback count.
  const [investmentArcMissingHqCount, setInvestmentArcMissingHqCount] = useState(0);

  // Megaprojects overlay: the mapbox-only layer of the major-development point
  // records. Built once per fetch (funderType private_development subset, sized
  // 6–24px by announcedInvestment, stamped with status group + truncated label)
  // and stashed in a ref for the source; its summary (per-group counts + total
  // ANNOUNCED capital) and the citywide (non-plotting) development names feed the
  // legend. It can sit over any base view and is independent of the
  // year/funderType filters. Development rows carry a null year, so a bounded
  // year window would empty the view.
  const megaprojectFeaturesRef = useRef<MegaprojectPointFeature[]>([]);
  const [megaprojectSummary, setMegaprojectSummary] = useState<MegaprojectSummary | null>(null);
  const [investmentCitywideDevelopmentNames, setInvestmentCitywideDevelopmentNames] = useState<string[]>([]);
  const stateCapitalFeaturesRef = useRef<InvestmentPointFeature[]>([]);
  const federalRestaurantReliefFeaturesRef = useRef<InvestmentPointFeature[]>([]);
  const countyReliefByZipRef = useRef<CountyReliefZipSummary[]>([]);
  const stateRecoveryByZipRef = useRef<HistoricalRecoveryZipSummary[]>([]);
  const countyReliefBoundariesRef = useRef<ZipBoundaryFeatureCollection | null>(null);
  const [stateCapitalPlottedCount, setStateCapitalPlottedCount] = useState(0);
  const [stateCapitalCitywideCount, setStateCapitalCitywideCount] = useState(0);
  const [countyReliefZipCount, setCountyReliefZipCount] = useState(0);
  const [stateRecoveryZipCount, setStateRecoveryZipCount] = useState(0);
  const [federalRestaurantReliefPlottedCount, setFederalRestaurantReliefPlottedCount] = useState(0);
  const [federalRestaurantReliefCitywideCount, setFederalRestaurantReliefCitywideCount] = useState(0);

  // Polygon draw tool
  const drawRef = useRef<MapboxDraw | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [polygonResults, setPolygonResults] = useState<GeoJSON.FeatureCollection | null>(null);
  const [polygonLoading, setPolygonLoading] = useState(false);
  const [polygonPanelOpen, setPolygonPanelOpen] = useState(false);
  const countyReliefRecipientsAbortRef = useRef<AbortController | null>(null);
  const [countyReliefRecipientsPanel, setCountyReliefRecipientsPanel] = useState<{
    sourceId: HistoricalRecoveryRecipientSource;
    programName: string;
    year: number;
    zipCode: string;
    status: CountyReliefRecipientsPanelStatus;
    recipients: HistoricalRecoveryRecipient[];
    sourceLink: string | null;
  } | null>(null);

  const openHistoricalRecoveryRecipients = useCallback((
    sourceId: HistoricalRecoveryRecipientSource,
    zipCode: string,
  ) => {
    if (!/^\d{5}$/.test(zipCode)) return;
    const defaults =
      sourceId === "illinois-b2b"
        ? {
            programName: "Illinois Back to Business Grant Program",
            year: 2022,
          }
        : {
            programName: "Cook County 2023 Source Grant",
            year: 2023,
          };

    countyReliefRecipientsAbortRef.current?.abort();
    const controller = new AbortController();
    countyReliefRecipientsAbortRef.current = controller;
    setSnapshotOpen(false);
    setPolygonPanelOpen(false);
    setCountyReliefRecipientsPanel({
      sourceId,
      ...defaults,
      zipCode,
      status: "loading",
      recipients: [],
      sourceLink: null,
    });

    fetchHistoricalRecoveryRecipients(sourceId, zipCode, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setCountyReliefRecipientsPanel((current) =>
          current?.zipCode === zipCode && current.sourceId === sourceId
            ? {
                sourceId,
                programName: result.programName,
                year: result.year,
                zipCode,
                status: result.status,
                recipients: result.recipients,
                sourceLink: result.sourceLink,
              }
            : current,
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCountyReliefRecipientsPanel((current) =>
          current?.zipCode === zipCode && current.sourceId === sourceId
            ? { ...current, status: "error", recipients: [], sourceLink: null }
            : current,
        );
      });
  }, []);

  const closeCountyReliefRecipients = useCallback(() => {
    countyReliefRecipientsAbortRef.current?.abort();
    countyReliefRecipientsAbortRef.current = null;
    setCountyReliefRecipientsPanel(null);
  }, []);

  // HARD-CLOSE the recipients panel on every teardown path, not just its own X
  // button. The panel lists recipient BUSINESS NAMES against award amounts — the
  // single most identifying surface in the layer, and the thing the ZIP-aggregate
  // design and the gated per-ZIP endpoint exist to protect. Previously
  // setCountyReliefRecipientsPanel(null) was reachable ONLY from the X, so
  // unchecking the overlay (or Community Investment entirely, or losing the admin
  // session) hid the polygons and emptied the source while the panel kept
  // rendering every name and dollar figure. The shared mapbox popup goes with it.
  useEffect(() => {
    if (!countyReliefRecipientsPanel) return;
    if (
      shouldKeepRecipientsPanelOpen({
        adminSessionActive,
        communityInvestmentVisible,
        overlays: publicInvestmentOverlays,
        sourceId: countyReliefRecipientsPanel.sourceId,
      })
    ) {
      return;
    }
    sharedDotPopupRef.current?.remove();
    closeCountyReliefRecipients();
  }, [
    countyReliefRecipientsPanel,
    adminSessionActive,
    communityInvestmentVisible,
    publicInvestmentOverlays,
    closeCountyReliefRecipients,
  ]);

  useEffect(
    () => () => {
      countyReliefRecipientsAbortRef.current?.abort();
    },
    [],
  );

  // Load programs for snapshot
  useEffect(() => {
    cachedFetch<Program[]>("/api/programs")
      .catch(() => cachedFetch<Program[]>("/data/programs.json"))
      .then(setAllPrograms)
      .catch(() => {});
  }, []);

  // Owner Files admin session probe (once, independent of map load) — gates
  // whether the ADMIN legend section renders at all.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/owner-file/session", { signal: controller.signal })
      .then((res) => setAdminSessionActive(res.status === 204))
      .catch(() => setAdminSessionActive(false));
    return () => controller.abort();
  }, []);


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
      } else if (Array.isArray(preset.zones)) {
        targetZones = new Set(preset.zones);
      } else {
        targetZones = new Set();
      }
      targetZones.delete("nofFundedProjects");

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

      if (typeof preset.zoning === "boolean") {
        const zoningUpdated: Record<string, boolean> = {};
        const vis = preset.zoning ? "visible" : "none";
        for (const cat of ZONING_CATEGORIES) {
          zoningUpdated[cat.key] = preset.zoning;
          if (map.getLayer(`zoning-${cat.key}-fill`)) {
            map.setLayoutProperty(`zoning-${cat.key}-fill`, "visibility", vis);
            map.setLayoutProperty(`zoning-${cat.key}-line`, "visibility", vis);
          }
        }
        setZoningVisible(zoningUpdated);
      }

      if (typeof preset.vacancy === "boolean") {
        setVacantVisible({
          vacantLand: preset.vacancy,
          vacantBuildings: preset.vacancy,
        });
      }

      if (typeof preset.parcels === "boolean") {
        setParcelsVisible(preset.parcels);
      }
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
          ownerName: parcelData?.ownerName,
          ownerType: parcelData?.ownerType,
          districtsLoading: true,
        });
        if (!label && data.tractId) {
          setSnapshotLabel(`Tract ${data.tractId}`);
        }

        // Async non-blocking fetch for political districts and current officials
        cachedFetch<DistrictData>(`/api/representatives?lat=${lat}&lon=${lon}`)
          .then((districts) => {
            setAreaStats((prev) => ({ ...prev, districts, districtsLoading: false }));
          })
          .catch(() => {
            setAreaStats((prev) => ({ ...prev, districtsLoading: false }));
          });

        getSiteSignals(lat, lon)
          .then((siteSignals) => {
            setAreaStats((prev) => ({ ...prev, siteSignals }));
          })
          .catch(() => {});

        getTransportAccess(lat, lon)
          .then((transport) => {
            setAreaStats((prev) => ({ ...prev, transport }));
          })
          .catch(() => {});
      }
    } catch {
      // Keep defaults
    }
  }, []);

  // Store loadCensusForPoint in a ref so the map.on("load") closure can use it
  const loadCensusRef = useRef(loadCensusForPoint);
  useEffect(() => { loadCensusRef.current = loadCensusForPoint; }, [loadCensusForPoint]);

  // Handle click for location zones + top programs (with parcel boost)
  const handleMapClick = useCallback(
    async (lat: number, lon: number) => {
      setLastClickLat(lat);
      setLastClickLon(lon);
      setCopiedLink(false);
      setTifFinanceLoading(true);
      try {
        const [data, parcelData, tifFinanceData] = await Promise.all([
          cachedFetch(`/api/zones/check?lat=${lat}&lon=${lon}`),
          cachedFetch<ParcelData>(`/api/parcel?lat=${lat}&lon=${lon}`).catch(() => null),
          cachedFetch<{ tifFinance?: TifFinanceContext | null }>(
            `/api/tif-finance?lat=${lat}&lon=${lon}`
          ).catch(() => null),
        ]);
        const normalized = normalizeZoneCheckResponse(data);
        if (!normalized) throw new Error("Unexpected zone check response");

        const { zones, zoneNames } = normalized;
        setLocationZones(zones);
        setLocationZoneNames(zoneNames);
        setSnapshotParcelData(parcelData ?? null);
        setSnapshotTifFinance(tifFinanceData?.tifFinance ?? null);
        // Compute top 3 programs client-side (with parcel boost)
        if (allPrograms.length > 0) {
          const results = runConfidenceEngine(allPrograms, zones, zoneNames, undefined, parcelData ?? undefined);
          setSnapshotPrograms(
            results.filter((r) => r.confidence !== "not_applicable").slice(0, 3)
          );
        }
      } catch {
        setLocationZoneNames(null);
        setSnapshotParcelData(null);
        setSnapshotTifFinance(null);
      } finally {
        setTifFinanceLoading(false);
      }
    },
    [allPrograms]
  );

  const snapshotContextSummary = useMemo(() => {
    if (!locationZones) return null;
    const locationContext = buildLocationContext(
      {
        reportType: "site-incentives",
        address: snapshotLabel,
        lat: lastClickLat,
        lon: lastClickLon,
      },
      allPrograms,
      {
        zones: locationZones,
        zoneNames: locationZoneNames ?? undefined,
        parcel: snapshotParcelData ?? undefined,
        siteSignals: areaStats.siteSignals ?? undefined,
        transport: areaStats.transport ?? undefined,
        tifFinance: snapshotTifFinance ?? undefined,
      }
    );
    return summarizeLocationContextForMap(locationContext);
  }, [
    allPrograms,
    areaStats.siteSignals,
    areaStats.transport,
    lastClickLat,
    lastClickLon,
    locationZoneNames,
    locationZones,
    snapshotLabel,
    snapshotParcelData,
    snapshotTifFinance,
  ]);
  const lastClickRef = useRef(handleMapClick);
  useEffect(() => { lastClickRef.current = handleMapClick; }, [handleMapClick]);

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
      setLoaded(true);
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

    // Mobile only: a second quick tap (a habitual double-tap, or a retry
    // after a tap that felt like it did nothing) must not also zoom the map.
    // That combination is the actual mechanism that turns a merely-late or
    // dropped click into the "tap zoomed instead of opening the snapshot"
    // complaint — see the click-handler comment below. Desktop keeps
    // double-click-to-zoom; pinch-to-zoom (touchZoomRotate) is untouched.
    if (window.matchMedia("(max-width: 768px)").matches) {
      map.doubleClickZoom.disable();
    }

    // Which zone fill layers currently exist on the map. Recomputed on every
    // call (not memoized) because zone layers are added asynchronously as
    // each zone's data loads inside `map.on("load", ...)` below — the set
    // only grows over time, so a click/hover that lands before a zone has
    // loaded just sees fewer layers rather than querying a missing one.
    const getLoadedZoneFillLayers = () =>
      ZONE_KEYS.map((k) => `zone-${k}-fill`).filter((id) => map.getLayer(id));

    /* Hover + click for zones — bound immediately instead of inside the
       `load` handler. Mapbox's canvas accepts pointer events as soon as the
       map is constructed; queryRenderedFeatures/getLayer are both safe to
       call before the style finishes loading (they just report "nothing
       here yet"). Binding here closes the dead-tap window that used to
       exist between "map looks interactive" (base style visible, mobile
       hint text already showing) and "the load handler's awaited fetches
       finished" — a tap in that window used to do nothing, and a
       frustrated retry tap would then double-tap-zoom instead of opening
       the snapshot (the exact bug this file already has one fix for). It
       also means a single rejected fetch inside `load` can no longer
       prevent this handler from ever binding. */
    let hoveredId: string | number | null = null;
    let hoveredSource: string = "";

    map.on("mousemove", (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: getLoadedZoneFillLayers(),
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

    /* One shared tap action, fed by two entry points:
       1. map "click" — mouse clicks, plus the browser's touch-compat click
          where it still exists;
       2. the touch-tap recognizer below — real touches.
       mapbox-gl-draw preventDefaults every touchend on the canvas ("Prevent
       emulated mouse events", draw's events.js), which stops WebKit/Blink
       from synthesizing a compat click for a touch — so on real touch
       devices map "click" never fires and the recognizer is the only path
       that opens the snapshot. Draw only suppresses the browser's compat
       events, not Mapbox's event bus, so the touch map events still arrive. */
    const openSnapshotAt = (point: mapboxgl.Point, lngLat: mapboxgl.LngLat) => {
      const isMobileView = window.matchMedia("(max-width: 768px)").matches;

      /* Zone popup — desktop only: zone fills blanket whole corridors, so on
         mobile every tap would stack a popup under the snapshot sheet */
      const features = map.queryRenderedFeatures(point, {
        layers: getLoadedZoneFillLayers(),
      });
      if (!isMobileView && features.length > 0) {
        const props = features[0].properties || {};
        const sourceKey = (features[0].source ?? "").replace("zone-", "");
        const label = ZONE_LABELS[sourceKey] || sourceKey;
        const name = props.name || props.Name || props.NAME || "";
        new mapboxgl.Popup({ maxWidth: "260px", className: "bureau-popup" })
          .setLngLat(lngLat)
          .setHTML(
            `<div style="font-family:Inter,sans-serif">
              <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#2563EB;margin-bottom:4px">${label}</div>
              ${name ? `<div style="font-size:14px;font-weight:600;color:#0C1B33">${name}</div>` : ""}
            </div>`
          )
          .addTo(map);
      }

      /* POI popup — desktop only, same reasoning as the zone popup above:
         on mobile the snapshot sheet already surfaces this tap, so a second
         popup would just stack underneath it. */
      const poiLayers = Object.keys(POI_LAYERS)
        .map((k) => `poi-${k}`)
        .filter((id) => map.getLayer(id));
      if (!isMobileView && poiLayers.length > 0) {
        const poiFeats = map.queryRenderedFeatures(point, {
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
            .setLngLat(lngLat)
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

      /* Area data (label + neighborhood zoom + snapshot card) — a tap opens
         the snapshot on every viewport and zooms to the tapped neighborhood
         (mobile pads the fit so the area lands above the bottom sheet). */
      const drawing = drawRef.current?.getMode?.() === "draw_polygon";
      if (!drawing) {
        // Skip community-area zoom if the click landed on a parcel
        const clickedParcel = map.getLayer("parcels-fill")
          ? map.queryRenderedFeatures(point, { layers: ["parcels-fill"] }).length > 0
          : false;

        let areaLabel: string | undefined;
        if (map.getLayer("community-areas-fill")) {
          const caFeats = map.queryRenderedFeatures(point, {
            layers: ["community-areas-fill"],
          });
          if (caFeats.length > 0) {
            const community = caFeats[0].properties?.community;
            if (community) {
              areaLabel = community
                .toLowerCase()
                .replace(/\b\w/g, (c: string) => c.toUpperCase());

              // Zoom to the community area boundary (skip when clicking a
              // parcel or already at parcel zoom). On mobile the snapshot
              // sheet covers the bottom ~60% of the screen, so pad the fit
              // asymmetrically to land the neighborhood in the visible strip
              // above the sheet instead of centering it behind it.
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
                    let padding: number | mapboxgl.PaddingOptions = 60;
                    if (isMobileView) {
                      const mapH = map.getContainer().clientHeight;
                      const bottom = Math.min(Math.round(mapH * 0.58), mapH - 220);
                      padding = { top: 60, left: 24, right: 24, bottom: Math.max(bottom, 0) };
                    }
                    map.fitBounds(bounds, { padding, duration: 1200, maxZoom: 14.5 });
                  }
                }
              }
            }
          }
        }

        loadCensusRef.current(lngLat.lat, lngLat.lng, areaLabel);
        lastClickRef.current(lngLat.lat, lngLat.lng);
        snapshotOpenedAtRef.current = Date.now();
        setSnapshotOpen(true);
      }
    };

    let lastTouchTapAt = 0;
    let touchTapStart: { x: number; y: number; startedAt: number } | null = null;

    map.on("click", (e) => {
      // The recognizer below just handled this tap; if the browser also
      // synthesized a compat click for it, drop the duplicate. Mouse clicks
      // never set lastTouchTapAt, so desktop behavior is unchanged.
      if (Date.now() - lastTouchTapAt < 700) return;
      openSnapshotAt(e.point, e.lngLat);
    });

    /* Touch-tap recognizer: a single stationary finger, down-to-up within
       900ms and ~12px, is a tap. Runs on every viewport (a desktop-width
       iPad has the same dead compat click); pans, pinches, and long presses
       fall through to Mapbox's gesture handlers untouched. */
    map.on("touchstart", (e) => {
      if (e.points.length !== 1) {
        touchTapStart = null;
        return;
      }
      touchTapStart = { x: e.point.x, y: e.point.y, startedAt: Date.now() };
    });
    map.on("touchmove", (e) => {
      if (!touchTapStart) return;
      const dx = e.point.x - touchTapStart.x;
      const dy = e.point.y - touchTapStart.y;
      if (e.points.length !== 1 || dx * dx + dy * dy > 144) {
        touchTapStart = null;
      }
    });
    map.on("touchcancel", () => {
      touchTapStart = null;
    });
    map.on("touchend", (e) => {
      const start = touchTapStart;
      touchTapStart = null;
      if (!start || e.points.length !== 1) return;
      const dx = e.point.x - start.x;
      const dy = e.point.y - start.y;
      if (Date.now() - start.startedAt > 900 || dx * dx + dy * dy > 144) return;
      lastTouchTapAt = Date.now();
      openSnapshotAt(e.point, e.lngLat);
    });

    // Keep Mapbox's canvas + tap→location mapping in sync with the container.
    // On iOS Safari the toolbar show/hide changes 100dvh (and thus the map
    // height) after init; without a resize, taps over much of the map land on
    // stale coordinates or stop registering. ResizeObserver covers dvh/layout
    // changes; visualViewport+orientation cover the toolbar collapse.
    const handleResize = () => requestAnimationFrame(() => mapRef.current?.resize());
    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    window.visualViewport?.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

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

        // Heavy-coverage layers get reduced opacity so they don't block the whole
        // map. On small screens, fills are toned down further (outlines stay) so
        // the map reads cleanly instead of a saturated wash.
        const mobileDensity = window.matchMedia("(max-width: 768px)").matches ? 0.55 : 1;
        const baseOpacity = (HEAVY_COVERAGE_KEYS.has(key) ? 0.08 : 0.18) * mobileDensity;
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

      // Promise.allSettled (not Promise.all): one zone's addSource/addLayer
      // throwing must not abort the rest of map init — the zoning-districts
      // fetch, the parcels/vacant-properties layers, the draw control, and
      // setLoaded(true) all run after this line and would otherwise never
      // run, permanently leaving the "Drawing zone boundaries" loading
      // overlay up with no visible error.
      const zoneLoadResults = await Promise.allSettled(zoneLoadPromises);
      zoneLoadResults.forEach((result, i) => {
        if (result.status === "rejected") {
          console.warn(`[MapView] Zone layer "${ZONE_KEYS[i]}" failed to load:`, result.reason);
        }
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

            // Click popup — show code + human-readable description. Desktop
            // only: zoning blankets the city, so on mobile it would stack a
            // popup under the snapshot sheet on every tap.
            map.on("click", layerId, (e) => {
              if (!e.features?.length) return;
              if (window.matchMedia("(max-width: 768px)").matches) return;
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

      /* One shared popup instance for ALL unclustered-dot layers (vacant,
         ownership clusters, community investment). Mapbox fires every
         layer-scoped click handler with a rendered feature under the pointer, so
         a single click where two admin dot layers overlap would otherwise open
         (and stack) a separate popup per layer. Reusing ONE popup — setLngLat +
         setHTML + addTo moves and re-fills the same element — guarantees exactly
         one dot popup on screen at a time. */
      const sharedDotPopup = new mapboxgl.Popup({ maxWidth: "320px", className: "bureau-popup" });
      // Exposed via ref so the deck view-mode effect can close it when entering
      // Arcs/Density (deck's picking tooltip replaces the mapbox dot popup there).
      sharedDotPopupRef.current = sharedDotPopup;

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

        // Owner info
        const ownerName = p.ownerName || null;
        const ownerType = p.ownerType as OwnerType | null;
        const ownerLabel = ownerType ? (OWNER_TYPE_LABELS[ownerType] || ownerType) : null;
        const ownerColor = ownerType ? (OWNER_TYPE_COLORS[ownerType] || "#9CA3AF") : "#9CA3AF";
        const ownerHtml = ownerName
          ? `<div style="margin-top:6px;padding:6px 8px;background:#F8FAFC;border-radius:4px;border:1px solid #E2E8F0">
              <div style="font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#64748B;margin-bottom:2px">Owner</div>
              <div style="font-size:12px;font-weight:600;color:#0C1B33">${ownerName}</div>
              ${ownerLabel ? `<span style="display:inline-block;margin-top:3px;background:${ownerColor}15;color:${ownerColor};border:1px solid ${ownerColor}30;padding:1px 6px;border-radius:2px;font-size:9px;font-weight:500">${ownerLabel}</span>` : ""}
            </div>`
          : "";

        sharedDotPopup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:Inter,sans-serif">
              <div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:${VACANT_COLORS.vacantLand};margin-bottom:4px;font-weight:500">Vacant Property</div>
              <div style="font-size:14px;font-weight:600;color:#0C1B33">${addr}</div>
              ${meta ? `<div style="font-size:11px;color:#5A6478;margin-top:3px">${meta}</div>` : ""}
              ${ownerHtml}
              ${badges ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap">${badges}</div>` : ""}
              ${p.incentiveCount > 0 ? `<div style="font-size:10px;color:#059669;margin-top:6px;font-weight:500">${p.incentiveCount} incentive zone${p.incentiveCount > 1 ? "s" : ""} overlap</div>` : ""}
              ${p.source === "cols" ? `<a href="https://www.cookcountyassessoril.gov/pin/${p.id?.replace("cols-", "")}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;font-size:10px;color:#2563EB;text-decoration:underline">View on Cook County Assessor →</a>` : `<span style="display:inline-block;margin-top:8px;font-size:10px;color:#64748B">Source: 311 Report</span>`}
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

      /* ── Admin ownership-cluster layer (Owner Files, PRs #65/#67/#68) ──
         Gated: only rendered/toggleable when the ADMIN legend section is
         visible (adminSessionActive), and only fetched when toggled on —
         see the "Admin ownership-cluster loading" effect below. Mirrors the
         Vacant Properties layer above (clustered GeoJSON, unclustered circles,
         cluster zoom-in, popup) so it behaves identically at the map level;
         added once here inside map.on("load", ...), same as vacant-properties,
         since this app has no basemap/style switcher to survive. */
      map.addSource("owner-clusters", {
        type: "geojson",
        data: EMPTY_FC,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      map.addLayer({
        id: "owner-clusters-clusters",
        type: "circle",
        source: "owner-clusters",
        filter: ["has", "point_count"],
        layout: { visibility: "none" },
        paint: {
          "circle-color": [
            "step", ["get", "point_count"],
            "#7C3AED",
            10, "#6D28D9",
            50, "#5B21B6",
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

      map.addLayer({
        id: "owner-clusters-cluster-count",
        type: "symbol",
        source: "owner-clusters",
        filter: ["has", "point_count"],
        layout: {
          visibility: "none",
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-size": 12,
        },
        paint: { "text-color": "#ffffff" },
      });

      map.addLayer({
        id: "owner-clusters-unclustered",
        type: "circle",
        source: "owner-clusters",
        filter: ["!", ["has", "point_count"]],
        layout: { visibility: "none" },
        paint: {
          "circle-color": [
            "match", ["get", "ownerType"],
            "city_public", OWNER_TYPE_COLORS.city_public,
            "out_of_state", OWNER_TYPE_COLORS.out_of_state,
            "corporate_llc", OWNER_TYPE_COLORS.corporate_llc,
            "local_private", OWNER_TYPE_COLORS.local_private,
            OWNER_TYPE_COLORS.unknown,
          ],
          // sqrt scale on clusterVacantCount, clamped 4–16px (interpolate
          // clamps to the first/last stop output outside the input domain).
          "circle-radius": [
            "interpolate", ["linear"], ["sqrt", ["get", "clusterVacantCount"]],
            1, 4,
            8, 16,
          ],
          "circle-opacity": ["case", ["==", ["get", "vacant"], true], 1, 0.35],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("click", "owner-clusters-unclustered", (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties || {};
        sharedDotPopup
          .setLngLat(e.lngLat)
          .setHTML(buildOwnerClusterPopupHtml(p))
          .addTo(map);
      });

      map.on("click", "owner-clusters-clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["owner-clusters-clusters"] });
        if (!features.length) return;
        const clusterId = features[0].properties?.cluster_id;
        const src = map.getSource("owner-clusters") as mapboxgl.GeoJSONSource;
        src.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.easeTo({
            center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
            zoom: zoom!,
          });
        });
      });

      map.on("mouseenter", "owner-clusters-clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "owner-clusters-clusters", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "owner-clusters-unclustered", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "owner-clusters-unclustered", () => { map.getCanvas().style.cursor = ""; });

      /* ── Admin community-investment layer (Community Investment) ──
         Gated + toggled exactly like the ownership-cluster layer: only
         rendered/toggleable when adminSessionActive, only fetched when toggled
         on (the "Community investment layer: toggle + one-time fetch" effect
         below). A single unclustered circle layer — colored by funderType,
         radius scaled by amountAwarded (sqrt, clamped 4–18px), slight opacity.
         Citywide records never reach this source (excluded client-side); they
         surface only in the legend's "Citywide commitments" note. */
      map.addSource(COUNTY_RELIEF_SOURCE_ID, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: COUNTY_RELIEF_FILL_LAYER_ID,
        type: "fill",
        source: COUNTY_RELIEF_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "fill-color": COUNTY_RELIEF_FILL_COLOR,
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["to-number", ["get", "intensity"], 0],
            0,
            0.12,
            1,
            0.5,
          ],
        },
      }, "owner-clusters-clusters");
      map.addLayer({
        id: COUNTY_RELIEF_LINE_LAYER_ID,
        type: "line",
        source: COUNTY_RELIEF_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "line-color": COUNTY_RELIEF_LINE_COLOR,
          "line-width": 1.25,
          "line-opacity": 0.8,
        },
      }, "owner-clusters-clusters");

      map.on("click", COUNTY_RELIEF_FILL_LAYER_ID, (e) => {
        if (!e.features?.length) return;
        const properties = e.features[0].properties || {};
        const zipCode = String(properties.zipCode || "");
        sharedDotPopup
          .setLngLat(e.lngLat)
          .setHTML(buildCountyReliefPopupHtml(properties))
          .addTo(map);
        const recipientsButton = sharedDotPopup
          .getElement()
          ?.querySelector<HTMLButtonElement>("[data-county-relief-recipients]");
        recipientsButton?.addEventListener(
          "click",
          () => {
            sharedDotPopup.remove();
            openHistoricalRecoveryRecipients("cook-source-2023", zipCode);
          },
          { once: true },
        );
      });
      map.on("mouseenter", COUNTY_RELIEF_FILL_LAYER_ID, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", COUNTY_RELIEF_FILL_LAYER_ID, () => { map.getCanvas().style.cursor = ""; });

      map.addSource(STATE_RECOVERY_SOURCE_ID, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: STATE_RECOVERY_FILL_LAYER_ID,
        type: "fill",
        source: STATE_RECOVERY_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "fill-color": STATE_RECOVERY_FILL_COLOR,
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["to-number", ["get", "intensity"], 0],
            0,
            0.1,
            1,
            0.46,
          ],
        },
      }, "owner-clusters-clusters");
      map.addLayer({
        id: STATE_RECOVERY_LINE_LAYER_ID,
        type: "line",
        source: STATE_RECOVERY_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "line-color": STATE_RECOVERY_LINE_COLOR,
          "line-width": 1.25,
          "line-opacity": 0.82,
        },
      }, "owner-clusters-clusters");
      map.on("click", STATE_RECOVERY_FILL_LAYER_ID, (e) => {
        if (!e.features?.length) return;
        const properties = e.features[0].properties || {};
        const zipCode = String(properties.zipCode || "");
        sharedDotPopup
          .setLngLat(e.lngLat)
          .setHTML(buildHistoricalRecoveryZipPopupHtml(properties))
          .addTo(map);
        const recipientsButton = sharedDotPopup
          .getElement()
          ?.querySelector<HTMLButtonElement>("[data-historical-recovery-recipients]");
        recipientsButton?.addEventListener(
          "click",
          () => {
            sharedDotPopup.remove();
            openHistoricalRecoveryRecipients("illinois-b2b", zipCode);
          },
          { once: true },
        );
      });
      map.on("mouseenter", STATE_RECOVERY_FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", STATE_RECOVERY_FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      map.addSource("community-investment", { type: "geojson", data: EMPTY_FC });

      map.addLayer({
        id: "community-investment-points",
        type: "circle",
        source: "community-investment",
        layout: { visibility: "none" },
        paint: {
          "circle-color": [
            "match", ["get", "funderType"],
            "government", FUNDER_TYPE_COLORS.government,
            "philanthropic", FUNDER_TYPE_COLORS.philanthropic,
            "private_development", FUNDER_TYPE_COLORS.private_development,
            INVESTMENT_FALLBACK_COLOR,
          ],
          // Radius encodes MAGNITUDE, but from different fields by capital kind:
          //   • DEVELOPMENT dots read `radiusPx` — a precomputed 4–18px radius
          //     sized by announcedInvestment over the development set (a
          //     domain-normalized sqrt scale a mapbox expression can't express;
          //     stamped in investmentRecordsToPointFeatures). A null-capital
          //     development carries radiusPx=4 (the floor). NEVER amountAwarded.
          //   • NON-GRANT capital dots (capitalClass != grant: TIF / federal /
          //     tax-credit, amountAwarded=null) ALSO read a precomputed `radiusPx`,
          //     sized by their OWN money field on a per-class sqrt domain — so they
          //     no longer all collapse to the 4px floor under an amountAwarded paint.
          //   • grant dots keep the sqrt(amountAwarded) scale, clamped 4–18px
          //     (interpolate clamps outside the domain; to-number coerces a null
          //     amount to 0 → the 4px floor).
          "circle-radius": [
            "case",
            ["==", ["get", "funderType"], "private_development"],
            ["to-number", ["get", "radiusPx"], 4],
            ["!=", ["get", "capitalClass"], "grant"],
            ["to-number", ["get", "radiusPx"], 4],
            [
              "interpolate", ["linear"], ["sqrt", ["to-number", ["get", "amountAwarded"]]],
              50, 4,
              2500, 18,
            ],
          ],
          "circle-opacity": 0.7,
          // OUTLINE encodes CAPITAL CLASS (a mapbox circle can't dash, so a
          // distinct stroke color carries it): a grant keeps the white ring, while
          // the three base-map non-grant classes — all government / blue fill —
          // are told apart by an amber / navy / magenta ring (CAPITAL_CLASS_OUTLINE)
          // + the legend sub-key. Non-grant rings are 1.5px so they read.
          "circle-stroke-width": [
            "match", ["get", "capitalClass"],
            "tif_subsidy", 1.5,
            "federal_program", 1.5,
            "tax_credit", 1.5,
            1,
          ],
          "circle-stroke-color": [
            "match", ["get", "capitalClass"],
            "tif_subsidy", CAPITAL_CLASS_OUTLINE.tif_subsidy,
            "federal_program", CAPITAL_CLASS_OUTLINE.federal_program,
            "tax_credit", CAPITAL_CLASS_OUTLINE.tax_credit,
            CAPITAL_CLASS_OUTLINE.grant,
          ],
        },
      });

      map.on("click", "community-investment-points", (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties || {};
        sharedDotPopup
          .setLngLat(e.lngLat)
          .setHTML(buildInvestmentPopupHtml(p))
          .addTo(map);
      });

      map.on("mouseenter", "community-investment-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "community-investment-points", () => { map.getCanvas().style.cursor = ""; });

      /* DCEO capital listings are a separate overlay because their published
         balance is neither an awarded grant nor a current funding opportunity.
         Keeping them out of the base Dots/Arcs/Density source prevents a density
         total or mode switch from changing that meaning. */
      map.addSource("community-investment-state-capital", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "community-investment-state-capital-points",
        type: "circle",
        source: "community-investment-state-capital",
        layout: { visibility: "none" },
        paint: {
          "circle-color": CAPITAL_CLASS_OUTLINE.state_appropriation,
          "circle-radius": ["to-number", ["get", "radiusPx"], 5],
          "circle-opacity": 0.78,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.on("click", "community-investment-state-capital-points", (e) => {
        if (!e.features?.length) return;
        sharedDotPopup
          .setLngLat(e.lngLat)
          .setHTML(buildInvestmentPopupHtml(e.features[0].properties || {}))
          .addTo(map);
      });
      map.on("mouseenter", "community-investment-state-capital-points", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "community-investment-state-capital-points", () => {
        map.getCanvas().style.cursor = "";
      });

      /* SBA Restaurant Revitalization Fund grants are a closed historical
         recovery overlay. They remain separate from the base investment source
         so Dots/Arcs/Density never treats them as current awarded capital. */
      map.addSource("community-investment-federal-restaurant-relief", {
        type: "geojson",
        data: EMPTY_FC,
      });
      map.addLayer({
        id: "community-investment-federal-restaurant-relief-points",
        type: "circle",
        source: "community-investment-federal-restaurant-relief",
        layout: { visibility: "none" },
        paint: {
          "circle-color":
            PUBLIC_INVESTMENT_OVERLAY_COLORS.federal_restaurant_relief,
          "circle-radius": 5,
          "circle-opacity": 0.76,
          "circle-stroke-width": 1.25,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.on(
        "click",
        "community-investment-federal-restaurant-relief-points",
        (e) => {
          if (!e.features?.length) return;
          sharedDotPopup
            .setLngLat(e.lngLat)
            .setHTML(buildInvestmentPopupHtml(e.features[0].properties || {}))
            .addTo(map);
        },
      );
      map.on(
        "mouseenter",
        "community-investment-federal-restaurant-relief-points",
        () => {
          map.getCanvas().style.cursor = "pointer";
        },
      );
      map.on(
        "mouseleave",
        "community-investment-federal-restaurant-relief-points",
        () => {
          map.getCanvas().style.cursor = "";
        },
      );

      /* ── Megaprojects overlay (mapbox-only) ──
         A SECOND source/layer pair for the admin Megaprojects overlay: ONLY the
         major-development point records, circles colored by status GROUP and
         sized by announcedInvestment (radiusPx, 6–24px, precomputed in
         buildMegaprojectFeatures), plus a zoom-gated project-name label layer.
         Hidden by default; the view-mode effect shows this pair independently
         of the selected base view. No deck.gl — plain mapbox. */
      map.addSource("community-investment-megaprojects", { type: "geojson", data: EMPTY_FC });

      map.addLayer({
        id: "community-investment-megaproject-points",
        type: "circle",
        source: "community-investment-megaprojects",
        layout: { visibility: "none" },
        paint: {
          "circle-color": [
            "match", ["get", "statusGroup"],
            "open", MEGAPROJECT_STATUS_GROUP_COLORS.open,
            "building", MEGAPROJECT_STATUS_GROUP_COLORS.building,
            "planned", MEGAPROJECT_STATUS_GROUP_COLORS.planned,
            "stalled", MEGAPROJECT_STATUS_GROUP_COLORS.stalled,
            INVESTMENT_FALLBACK_COLOR,
          ],
          // Precomputed 6–24px sqrt-domain radius (announcedInvestment); a
          // null-capital development (e.g. the Fire-stadium subset row) sits at
          // the 6px floor and its popup explains the null.
          "circle-radius": ["to-number", ["get", "radiusPx"], 6],
          "circle-opacity": 0.75,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "community-investment-megaproject-labels",
        type: "symbol",
        source: "community-investment-megaprojects",
        // Labels appear only once zoomed in (>= 10.5) so the citywide view is not
        // a wall of overlapping text; mapbox collision handling drops the rest.
        minzoom: 10.5,
        layout: {
          visibility: "none",
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-anchor": "top",
          "text-offset": [0, 0.7],
          "text-allow-overlap": false,
          "text-optional": true,
          "text-max-width": 10,
        },
        paint: {
          // Text wears TEXT tokens (ink + white halo), never the status color, so
          // the label reads as a name and only the dot carries the status hue.
          "text-color": "#0C1B33",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      // Reuse the SAME development popup (buildInvestmentPopupHtml → "Announced")
      // via the shared dot popup instance — click + hover wired exactly like the
      // base community-investment-points layer.
      map.on("click", "community-investment-megaproject-points", (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties || {};
        sharedDotPopup
          .setLngLat(e.lngLat)
          .setHTML(buildInvestmentPopupHtml(p))
          .addTo(map);
      });
      map.on("mouseenter", "community-investment-megaproject-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "community-investment-megaproject-points", () => { map.getCanvas().style.cursor = ""; });

      // ── Polygon draw control ──
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {},
        defaultMode: "simple_select",
        styles: [
          { id: "gl-draw-polygon-fill", type: "fill", filter: ["all", ["==", "$type", "Polygon"]], paint: { "fill-color": "#2563EB", "fill-opacity": 0.1 } },
          { id: "gl-draw-polygon-stroke", type: "line", filter: ["all", ["==", "$type", "Polygon"]], paint: { "line-color": "#2563EB", "line-width": 2, "line-dasharray": [2, 2] } },
          { id: "gl-draw-point", type: "circle", filter: ["all", ["==", "$type", "Point"]], paint: { "circle-radius": 5, "circle-color": "#2563EB" } },
          { id: "gl-draw-line", type: "line", filter: ["all", ["==", "$type", "LineString"]], paint: { "line-color": "#2563EB", "line-width": 2, "line-dasharray": [2, 2] } },
        ],
      });
      drawRef.current = draw;
      map.addControl(draw, "top-right");

      map.on("draw.create", (e: { features: GeoJSON.Feature[] }) => {
        const feature = e.features[0];
        if (feature?.geometry?.type === "Polygon") {
          const geom = feature.geometry;
          // Keep only the latest polygon
          const allFeatures = draw.getAll();
          if (allFeatures.features.length > 1) {
            const toDelete = allFeatures.features
              .filter((f) => f.id !== feature.id)
              .map((f) => String(f.id));
            if (toDelete.length > 0) draw.delete(toDelete);
          }
          // Fetch vacant properties within polygon
          setPolygonLoading(true);
          setPolygonPanelOpen(true);
          setSnapshotOpen(false);
          const polygonJson = JSON.stringify(geom);
          fetch(`/api/vacant?polygon=${encodeURIComponent(polygonJson)}`)
            .then((res) => res.json())
            .then((data: GeoJSON.FeatureCollection) => {
              setPolygonResults(data);
              setPolygonLoading(false);
              setDrawMode(false);
            })
            .catch(() => {
              setPolygonLoading(false);
              setDrawMode(false);
            });
        }
      });

      map.on("draw.delete", () => {
        setPolygonResults(null);
        setPolygonPanelOpen(false);
      });

      setLoaded(true);
    });

    return () => {
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      // Tear down the deck overlay BEFORE map.remove() so its GL resources are
      // finalized cleanly rather than orphaned on the destroyed map.
      if (deckOverlayRef.current) {
        try {
          map.removeControl(deckOverlayRef.current as unknown as mapboxgl.IControl);
        } catch {
          // Already removed / map mid-teardown — nothing to free.
        }
        deckOverlayRef.current = null;
      }
      sharedDotPopupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [openHistoricalRecoveryRecipients]);

  /* ── Toggle zone visibility ────────────── */
  const toggleZone = useCallback(
    (key: string) => {
      if (!mapRef.current || !loaded) return;
      const map = mapRef.current;
      // Only toggle if layer exists on the map
      if (!map.getLayer(`zone-${key}-fill`)) return;
      if (key === "nofFundedProjects" && !zoneVisible.nof) return;
      const next = !zoneVisible[key];
      setZoneVisible((prev) => ({
        ...prev,
        [key]: next,
        ...(key === "nof" && !next ? { nofFundedProjects: false } : {}),
      }));
      const vis = next ? "visible" : "none";
      map.setLayoutProperty(`zone-${key}-fill`, "visibility", vis);
      map.setLayoutProperty(`zone-${key}-line`, "visibility", vis);
      if (key === "nof" && !next && map.getLayer("zone-nofFundedProjects-fill")) {
        map.setLayoutProperty("zone-nofFundedProjects-fill", "visibility", "none");
        map.setLayoutProperty("zone-nofFundedProjects-line", "visibility", "none");
      }
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      setSnapshotOpen(true);
      lastClickRef.current(result.lat, result.lon);
      loadCensusRef.current(result.lat, result.lon, result.label.split(" — ")[0]);
    },
    []
  );

  /* ── Deep link: /map?lat=&lon=[&label=] ── */
  // Used by "View on map" links from workspace watched areas. Reuses the
  // search-result flow (fly to point, drop marker, open the snapshot panel).
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (!loaded || deepLinkHandledRef.current) return;
    deepLinkHandledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const lat = Number(params.get("lat"));
    const lon = Number(params.get("lon"));
    if (!params.get("lat") || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }
    handleSearchResult({
      lat,
      lon,
      label: params.get("label") || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    });
  }, [loaded, handleSearchResult]);

  /* ── Deep link: /map?investment=1[&area=&year=&types=] ── */
  // The "Show on map →" links from the /investment analysis + compare pages
  // (Sol #1): enable the admin Community Investment layer, restore the shared
  // session's year/funderType filters from the URL, and fly to the named
  // community area. Runs once; the layer only actually renders when the viewer
  // is admin (the fetch effect gates on adminSessionActive), so a non-admin who
  // lands on the link simply sees no layer.
  const investmentDeepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (!loaded || investmentDeepLinkHandledRef.current) return;
    investmentDeepLinkHandledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("investment") !== "1") return;

    // Merge any filter context carried in the URL into the shared session, then
    // apply it to the layer state so the analysis → map round-trip restores view.
    const fromUrl = sessionFromQuery(params);
    if (Object.keys(fromUrl).length > 0) patchInvestmentSession(fromUrl);
    if (fromUrl.yearWindow) setInvestmentYearRange(fromUrl.yearWindow);
    if ("funderTypes" in fromUrl) {
      setInvestmentFunderTypes(funderTypeRecordFromSession(fromUrl.funderTypes));
      if (fromUrl.funderTypes?.includes("private_development")) {
        setInvestmentMegaprojectsVisiblePersistent(true);
      }
    }

    // Optional base view mode. The former mode=megaprojects deep link migrates
    // to Dots + the independent overlay so existing links keep their meaning.
    const modeParam = params.get("mode");
    if (modeParam === "megaprojects") {
      setInvestmentViewModePersistent("dots");
      setInvestmentMegaprojectsVisiblePersistent(true);
    } else if (isInvestmentViewMode(modeParam)) {
      setInvestmentViewModePersistent(modeParam);
    }
    const megaprojectsParam = params.get("megaprojects");
    if (megaprojectsParam === "1") setInvestmentMegaprojectsVisiblePersistent(true);
    if (megaprojectsParam === "0") setInvestmentMegaprojectsVisiblePersistent(false);
    const countyReliefParam = params.get("countyRelief");
    if (countyReliefParam === "1") {
      setPublicInvestmentOverlayPersistent("county_relief_awards", true);
    }
    if (countyReliefParam === "0") {
      setPublicInvestmentOverlayPersistent("county_relief_awards", false);
    }
    const stateRecoveryParam = params.get("stateRecovery");
    if (stateRecoveryParam === "1") {
      setPublicInvestmentOverlayPersistent("state_recovery_awards", true);
    }
    if (stateRecoveryParam === "0") {
      setPublicInvestmentOverlayPersistent("state_recovery_awards", false);
    }
    const restaurantReliefParam = params.get("restaurantRelief");
    if (restaurantReliefParam === "1") {
      setPublicInvestmentOverlayPersistent("federal_restaurant_relief", true);
    }
    if (restaurantReliefParam === "0") {
      setPublicInvestmentOverlayPersistent("federal_restaurant_relief", false);
    }
    const stateCapitalParam = params.get("stateCapital");
    if (stateCapitalParam === "1") {
      setPublicInvestmentOverlayPersistent("state_capital_projects", true);
    }
    if (stateCapitalParam === "0") {
      setPublicInvestmentOverlayPersistent("state_capital_projects", false);
    }

    setCommunityInvestmentVisiblePersistent(true);

    const area = params.get("area");
    if (area) {
      const ca = CHICAGO_COMMUNITY_AREAS.find(
        (c) => c.name.toLowerCase() === area.trim().toLowerCase()
      );
      if (ca && mapRef.current) {
        mapRef.current.flyTo({ center: [ca.lon, ca.lat], zoom: 12.5, duration: 1500 });
      }
    }
  }, [
    loaded,
    setCommunityInvestmentVisiblePersistent,
    setInvestmentMegaprojectsVisiblePersistent,
    setInvestmentViewModePersistent,
    setPublicInvestmentOverlayPersistent,
  ]);

  const handleGenerateSnapshot = useCallback(async () => {
    if (isGeneratingSnapshot) return;

    if (lastClickLat !== null && lastClickLon !== null) {
      trackEvent("location_snapshot_requested", {
        source: "map",
        address: snapshotLabel || null,
        lat: lastClickLat,
        lon: lastClickLon,
      });
      const params = new URLSearchParams({
        instant: "true",
        lat: lastClickLat.toFixed(5),
        lon: lastClickLon.toFixed(5),
        addr: snapshotLabel,
        source: "map",
      });
      window.location.href = `/report?${params.toString()}`;
      return;
    }

    const query = searchQuery.trim();
    if (!query) {
      window.location.href = "/report?source=map";
      return;
    }

    setIsGeneratingSnapshot(true);
    try {
      const res = await fetch(`/api/geocode?address=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error("Geocode failed");
      const data = await res.json();
      if (!data.lat || !data.lon) throw new Error("Address not found");

      const lat = Number(data.lat);
      const lon = Number(data.lon);
      const addr = data.displayName || data.display_name || query;
      trackEvent("location_snapshot_requested", {
        source: "map",
        address: addr,
        lat,
        lon,
      });
      const params = new URLSearchParams({
        instant: "true",
        lat: lat.toFixed(5),
        lon: lon.toFixed(5),
        addr,
        source: "map",
      });
      window.location.href = `/report?${params.toString()}`;
    } catch {
      window.location.href = `/report?addr=${encodeURIComponent(query)}&source=map`;
    } finally {
      setIsGeneratingSnapshot(false);
    }
  }, [isGeneratingSnapshot, lastClickLat, lastClickLon, searchQuery, snapshotLabel]);

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

  const activeMobilePreset: MobileMapPresetId | null =
    activePreset &&
    ["city", "state", "federal", "environmental", "zoning", "vacancy"].includes(activePreset)
      ? (activePreset as MobileMapPresetId)
      : null;

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

        const ownerParam = ownerFilter !== "all" ? `&ownerType=${ownerFilter}` : "";
        fetch(`/api/vacant?bounds=${boundsStr}&limit=1000${ownerParam}`, { signal: controller.signal })
          .then((res) => res.json())
          .then((data: GeoJSON.FeatureCollection) => {
            if (data?.type === "FeatureCollection" && data.features) {
              // Filter by visible sub-types (client-side for instant toggle)
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
  }, [vacantVisible, loaded, vacantLoaded, ownerFilter]);

  /* ── Admin ownership-cluster layer: toggle + one-time fetch ──
     Unlike vacant properties (a citywide live query re-fetched on every
     moveend), the ownership-cluster dataset is a small nine-ZIP admin-only
     pilot export — fetched once per toggle-on rather than following the
     viewport, then cached client-side (ownerClustersLoaded) until the
     component unmounts. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const vis = ownerClustersVisible ? "visible" : "none";
    if (map.getLayer("owner-clusters-clusters")) map.setLayoutProperty("owner-clusters-clusters", "visibility", vis);
    if (map.getLayer("owner-clusters-cluster-count")) map.setLayoutProperty("owner-clusters-cluster-count", "visibility", vis);
    if (map.getLayer("owner-clusters-unclustered")) map.setLayoutProperty("owner-clusters-unclustered", "visibility", vis);

    if (!adminSessionActive || !ownerClustersVisible) {
      if (!ownerClustersVisible) {
        const src = map.getSource("owner-clusters") as mapboxgl.GeoJSONSource | undefined;
        if (src) src.setData(EMPTY_FC);
        setOwnerClustersLoaded(false);
        setOwnerClustersPresentTypes([]);
      }
      return;
    }

    if (ownerClustersLoaded) return;

    const controller = new AbortController();
    setOwnerClustersLoading(true);
    setOwnerClustersError(null);

    fetch("/api/owner-file/geo", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Ownership-cluster fetch failed (${res.status})`);
        return res.json();
      })
      .then((data: GeoJSON.FeatureCollection) => {
        const m = mapRef.current;
        if (!m || data?.type !== "FeatureCollection") return;
        const src = m.getSource("owner-clusters") as mapboxgl.GeoJSONSource | undefined;
        if (src) src.setData(data);
        setOwnerClustersLoaded(true);
        const ownerTypes = (data.features ?? []).map(
          (feature) => (feature.properties as { ownerType?: string } | null)?.ownerType
        );
        setOwnerClustersPresentTypes(presentOwnerTypesInOrder(ownerTypes));
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        console.warn("[OwnerClusters] fetch error:", err);
        setOwnerClustersError("Ownership clusters could not be loaded.");
      })
      .finally(() => setOwnerClustersLoading(false));

    return () => controller.abort();
  }, [ownerClustersVisible, adminSessionActive, loaded, ownerClustersLoaded]);

  /* ── Community-investment layer: toggle + one-time fetch ──
     Mirrors the ownership-cluster effect above: set layer visibility from the
     toggle; when off, clear the source and reset the loaded flag so a later
     toggle-on refetches; when on (and admin) and not yet loaded, fetch the
     gated export ONCE and stash the plotted point features in a ref. The
     year/funderType filter effect below turns those features into the rendered
     source (setData), so this effect never touches the source data itself
     beyond clearing it. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    // Base-circle visibility is owned by the deck view-mode effect below (so
    // Arcs/Density can hide it); this effect only fetches + clears data.
    if (!adminSessionActive || !communityInvestmentVisible) {
      if (!communityInvestmentVisible) {
        const src = map.getSource("community-investment") as mapboxgl.GeoJSONSource | undefined;
        if (src) src.setData(EMPTY_FC);
        const megaSrc = map.getSource("community-investment-megaprojects") as mapboxgl.GeoJSONSource | undefined;
        if (megaSrc) megaSrc.setData(EMPTY_FC);
        const stateSrc = map.getSource("community-investment-state-capital") as mapboxgl.GeoJSONSource | undefined;
        if (stateSrc) stateSrc.setData(EMPTY_FC);
        const countySrc = map.getSource(COUNTY_RELIEF_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (countySrc) countySrc.setData(EMPTY_FC);
        const stateRecoverySrc = map.getSource(STATE_RECOVERY_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (stateRecoverySrc) stateRecoverySrc.setData(EMPTY_FC);
        const federalRestaurantSrc = map.getSource(
          "community-investment-federal-restaurant-relief",
        ) as mapboxgl.GeoJSONSource | undefined;
        if (federalRestaurantSrc) federalRestaurantSrc.setData(EMPTY_FC);
        investmentFeaturesRef.current = [];
        investmentCitywideEntriesRef.current = [];
        investmentFunderHqsRef.current = [];
        megaprojectFeaturesRef.current = [];
        stateCapitalFeaturesRef.current = [];
        federalRestaurantReliefFeaturesRef.current = [];
        countyReliefByZipRef.current = [];
        stateRecoveryByZipRef.current = [];
        setCommunityInvestmentLoaded(false);
        setInvestmentPresentFunderTypes([]);
        setInvestmentPresentCapitalClasses([]);
        setInvestmentFunderHqCount(0);
        setInvestmentCitywide(null);
        setInvestmentArcMissingHqCount(0);
        setMegaprojectSummary(null);
        setInvestmentCitywideDevelopmentNames([]);
        setStateCapitalPlottedCount(0);
        setStateCapitalCitywideCount(0);
        setCountyReliefZipCount(0);
        setStateRecoveryZipCount(0);
        setFederalRestaurantReliefPlottedCount(0);
        setFederalRestaurantReliefCitywideCount(0);
      }
      return;
    }

    if (communityInvestmentLoaded) return;

    const controller = new AbortController();
    setCommunityInvestmentLoading(true);
    setCommunityInvestmentError(null);

    fetchCommunityInvestmentLayer({ signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.status === "ready") {
          investmentFeaturesRef.current = result.pointFeatures;
          investmentCitywideEntriesRef.current = result.citywideEntries;
          investmentFunderHqsRef.current = result.funderHqs;
          stateCapitalFeaturesRef.current = result.pointFeatures.filter(
            (feature) => feature.properties.source === "dceo-capital"
          );
          federalRestaurantReliefFeaturesRef.current = result.pointFeatures.filter(
            (feature) => feature.properties.source === "sba-rrf",
          );
          countyReliefByZipRef.current = result.countyReliefByZip;
          stateRecoveryByZipRef.current = result.stateRecoveryByZip;
          setStateCapitalCitywideCount(result.stateCapitalCitywideCount);
          setFederalRestaurantReliefCitywideCount(
            result.federalRestaurantReliefCitywideCount,
          );
          // Megaprojects overlay: the development subset, built once and summarized
          // for the legend (unaffected by the year/funderType filters below).
          const megaFeatures = buildMegaprojectFeatures(result.pointFeatures);
          megaprojectFeaturesRef.current = megaFeatures;
          setMegaprojectSummary(summarizeMegaprojects(megaFeatures));
          setInvestmentCitywideDevelopmentNames(result.citywideDevelopmentNames);
          setInvestmentPresentFunderTypes(
            result.presentFunderTypes.filter((type) => type !== "private_development")
          );
          setInvestmentPresentCapitalClasses(result.presentCapitalClasses);
          setInvestmentFunderHqCount(result.funderHqs.length);
          setInvestmentCitywide(result.citywide);
          setCommunityInvestmentLoaded(true);
        } else if (result.status === "unauthorized") {
          setCommunityInvestmentError("Community investment is admin-only.");
        } else {
          setCommunityInvestmentError("Community investment data could not be loaded.");
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        console.warn("[CommunityInvestment] fetch error:", err);
        setCommunityInvestmentError("Community investment data could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCommunityInvestmentLoading(false);
      });

    return () => controller.abort();
  }, [communityInvestmentVisible, adminSessionActive, loaded, communityInvestmentLoaded]);

  /* ── Community-investment layer: client-side year + funderType filter ──
     Rebuilds the clustered-free source data (setData) from the cached point
     features whenever the year range or funderType checkboxes change — the
     distress-filter pattern from VacancyReportMap (source re-set, not a layer
     filter). Runs only while the layer is visible and loaded. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !communityInvestmentVisible || !communityInvestmentLoaded) return;
    const src = map.getSource("community-investment") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    const activeFunderTypes = new Set<FunderType>(
      FUNDER_TYPE_ORDER.filter((k) => k !== "private_development" && investmentFunderTypes[k])
    );
    const filtered = excludeMegaprojectFeatures(
      filterInvestmentPointFeatures(investmentFeaturesRef.current, {
        yearRangeId: investmentYearRange,
        activeFunderTypes,
      }).filter(
        (feature) => publicInvestmentOverlayIdForSource(feature.properties.source) === null
      )
    );
    src.setData(investmentFeatureCollection(filtered));
    // Re-scope the legend's citywide figure to the SAME filters as the dots, so
    // narrowing to one year never leaves an unfiltered "$X awarded" reading as if
    // it belonged to that year.
    setInvestmentCitywide(
      summarizeCitywideEntries(investmentCitywideEntriesRef.current, {
        yearRangeId: investmentYearRange,
        activeFunderTypes,
      })
    );
  }, [
    communityInvestmentVisible,
    communityInvestmentLoaded,
    investmentYearRange,
    investmentFunderTypes,
    loaded,
  ]);

  /* Additional public-investment overlays. They deliberately render through
     their own mapbox sources so neither Dots/Arcs/Density nor awarded-dollar
     density calculations can absorb them. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("community-investment-state-capital") as mapboxgl.GeoJSONSource | undefined;
    const layerId = "community-investment-state-capital-points";
    const visible =
      adminSessionActive &&
      communityInvestmentVisible &&
      communityInvestmentLoaded &&
      publicInvestmentOverlays.state_capital_projects;

    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
    const features = visible ? stateCapitalFeaturesRef.current : [];
    source?.setData(investmentFeatureCollection(features));
    setStateCapitalPlottedCount(features.length);
  }, [
    adminSessionActive,
    communityInvestmentVisible,
    communityInvestmentLoaded,
    publicInvestmentOverlays.state_capital_projects,
    loaded,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource(
      "community-investment-federal-restaurant-relief",
    ) as mapboxgl.GeoJSONSource | undefined;
    const layerId = "community-investment-federal-restaurant-relief-points";
    const visible =
      adminSessionActive &&
      communityInvestmentVisible &&
      communityInvestmentLoaded &&
      publicInvestmentOverlays.federal_restaurant_relief;

    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
    const features = visible ? federalRestaurantReliefFeaturesRef.current : [];
    source?.setData(investmentFeatureCollection(features));
    setFederalRestaurantReliefPlottedCount(features.length);
  }, [
    adminSessionActive,
    communityInvestmentVisible,
    communityInvestmentLoaded,
    publicInvestmentOverlays.federal_restaurant_relief,
    loaded,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource(COUNTY_RELIEF_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    const visible =
      adminSessionActive &&
      communityInvestmentVisible &&
      communityInvestmentLoaded &&
      publicInvestmentOverlays.county_relief_awards;

    for (const layerId of [COUNTY_RELIEF_FILL_LAYER_ID, COUNTY_RELIEF_LINE_LAYER_ID]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
      }
    }
    if (!visible) {
      source?.setData(EMPTY_FC);
      setCountyReliefZipCount(0);
      return;
    }

    const applyBoundaries = (boundaries: ZipBoundaryFeatureCollection) => {
      const collection = buildCountyReliefFeatureCollection(
        boundaries,
        countyReliefByZipRef.current
      );
      source?.setData(collection);
      setCountyReliefZipCount(collection.features.length);
    };
    if (countyReliefBoundariesRef.current) {
      applyBoundaries(countyReliefBoundariesRef.current);
      return;
    }

    const controller = new AbortController();
    fetch(COUNTY_RELIEF_BOUNDARIES_ENDPOINT, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`ZIP boundaries returned ${response.status}`);
        return response.json() as Promise<ZipBoundaryFeatureCollection>;
      })
      .then((boundaries) => {
        if (controller.signal.aborted || boundaries.type !== "FeatureCollection") return;
        countyReliefBoundariesRef.current = boundaries;
        applyBoundaries(boundaries);
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        console.warn("[CommunityInvestment] county relief ZIP boundary error:", error);
        source?.setData(EMPTY_FC);
        setCountyReliefZipCount(0);
      });
    return () => controller.abort();
  }, [
    adminSessionActive,
    communityInvestmentVisible,
    communityInvestmentLoaded,
    publicInvestmentOverlays.county_relief_awards,
    loaded,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource(STATE_RECOVERY_SOURCE_ID) as
      | mapboxgl.GeoJSONSource
      | undefined;
    const visible =
      adminSessionActive &&
      communityInvestmentVisible &&
      communityInvestmentLoaded &&
      publicInvestmentOverlays.state_recovery_awards;

    for (const layerId of [
      STATE_RECOVERY_FILL_LAYER_ID,
      STATE_RECOVERY_LINE_LAYER_ID,
    ]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
      }
    }
    if (!visible) {
      source?.setData(EMPTY_FC);
      setStateRecoveryZipCount(0);
      return;
    }

    const applyBoundaries = (boundaries: ZipBoundaryFeatureCollection) => {
      const collection = buildStateRecoveryFeatureCollection(
        boundaries,
        stateRecoveryByZipRef.current,
      );
      source?.setData(collection);
      setStateRecoveryZipCount(collection.features.length);
    };
    if (countyReliefBoundariesRef.current) {
      applyBoundaries(countyReliefBoundariesRef.current);
      return;
    }

    const controller = new AbortController();
    fetch(COUNTY_RELIEF_BOUNDARIES_ENDPOINT, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`ZIP boundaries returned ${response.status}`);
        }
        return response.json() as Promise<ZipBoundaryFeatureCollection>;
      })
      .then((boundaries) => {
        if (controller.signal.aborted || boundaries.type !== "FeatureCollection") {
          return;
        }
        countyReliefBoundariesRef.current = boundaries;
        applyBoundaries(boundaries);
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        console.warn("[CommunityInvestment] state recovery ZIP boundary error:", error);
        source?.setData(EMPTY_FC);
        setStateRecoveryZipCount(0);
      });
    return () => controller.abort();
  }, [
    adminSessionActive,
    communityInvestmentVisible,
    communityInvestmentLoaded,
    publicInvestmentOverlays.state_recovery_awards,
    loaded,
  ]);

  /* ── deck.gl picking tooltip for the Arcs/Density overlay ──
     Returns a plain-text tooltip (deck sets it as innerText, so recipient /
     funder strings need no HTML escaping). Never labels a dollar figure as
     "received/available" — Awarded only (repo iron rule). Stable identity so
     the overlay is created once. */
  const getInvestmentDeckTooltip = useCallback((info: PickingInfo) => {
    const object = info.object as unknown;
    if (!object) return null;
    const layerId = info.layer?.id;
    const style = {
      backgroundColor: "#0C1B33",
      color: "#ffffff",
      fontSize: "11px",
      lineHeight: "1.4",
      padding: "6px 8px",
      borderRadius: "4px",
      fontFamily: "Inter, sans-serif",
      whiteSpace: "pre-line" as const,
      maxWidth: "220px",
    };
    if (layerId === "investment-arcs") {
      const d = object as InvestmentArcDatum;
      return { text: `${d.recipient}\n${d.funderName}\nAwarded: ${formatAwardedAmount(d.amountAwarded)}`, style };
    }
    if (layerId === "investment-arc-fallback") {
      const p = (object as InvestmentPointFeature).properties;
      return { text: `${p.recipient}\n${p.funderName}\nAwarded: ${formatAwardedAmount(p.amountAwarded)}`, style };
    }
    if (layerId === "investment-hexagons") {
      const bin = object as {
        points?: unknown[];
        pointIndices?: unknown[];
        count?: number;
        colorValue?: number;
        value?: number;
        elevationValue?: number;
      };
      const count = bin.count ?? bin.points?.length ?? bin.pointIndices?.length ?? 0;
      // RECORDS mode bins EVERY point (grant + non-grant capital), so the honest
      // noun is "records" and there is NO dollar figure — the bin value is a count.
      if (investmentDensityMetric === "records") {
        return { text: `${count} record${count === 1 ? "" : "s"} in this bin`, style };
      }
      // DOLLARS mode: the layer data is filtered to amountAwarded>0 grant records
      // (see the density layer below), so the bin sum is a real awarded total and
      // every point in it is a grant.
      const total = bin.colorValue ?? bin.value ?? bin.elevationValue ?? 0;
      return {
        text: `${formatAwardedAmount(total)} awarded\n${count} grant${count === 1 ? "" : "s"} in this bin`,
        style,
      };
    }
    return null;
  }, [investmentDensityMetric]);

  /* ── Community-investment layer: deck.gl view modes (Arcs / Density) ──
     Owns the base circle layer's visibility (visible ONLY in Dots mode), the
     independent Megaprojects mapbox overlay, and the
     single deck.gl MapboxOverlay lifecycle. The overlay is created lazily on
     first entry into a non-Dots mode and FULLY removed (removeControl → deck
     finalize) when the layer is hidden, the mode returns to Dots, or the
     component unmounts (see the map-init cleanup) — no leaked WebGL contexts.
     Arcs/Density draw from the SAME year/funderType-filtered feature set as the
     dots, and use deck's picking tooltip (not the mapbox popup, which is closed
     on entry) so the two popup systems never fight. WebGL rendering cannot be
     visually verified in a sandboxed pane — covered by unit tests + build. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const baseId = "community-investment-points";
    const mode = investmentViewMode;
    const layerVisible = adminSessionActive && communityInvestmentVisible;

    if (map.getLayer(baseId)) {
      map.setLayoutProperty(baseId, "visibility", layerVisible && mode === "dots" ? "visible" : "none");
    }
    // Megaprojects overlay (mapbox-only, NO deck): show the circle + label
    // layers independently of the selected base view. Rendered independent
    // of the year/funderType filters — development rows carry a null year, so a
    // bounded window would empty the view, and the set is by definition the whole
    // private-development layer.
    const megaVisible =
      layerVisible && communityInvestmentLoaded && investmentMegaprojectsVisible;
    for (const id of [
      "community-investment-megaproject-points",
      "community-investment-megaproject-labels",
    ]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", megaVisible ? "visible" : "none");
      }
    }
    if (megaVisible) {
      const megaSrc = map.getSource("community-investment-megaprojects") as mapboxgl.GeoJSONSource | undefined;
      megaSrc?.setData(megaprojectFeatureCollection(megaprojectFeaturesRef.current));
    }
    // Close the shared mapbox popup on an actual view or overlay transition.
    // This effect also
    // re-runs on unrelated filter changes, and the popup instance is shared with
    // the vacant-property and owner-cluster layers, which must keep theirs open.
    // Unrelated re-runs (filter changes) still keep other layers' popups open.
    const modeChanged =
      prevInvestmentViewModeRef.current !== null &&
      prevInvestmentViewModeRef.current !== mode;
    const megaprojectsChanged =
      prevInvestmentMegaprojectsVisibleRef.current !== null &&
      prevInvestmentMegaprojectsVisibleRef.current !== investmentMegaprojectsVisible;
    // The four public-investment overlays were never in this check, so toggling
    // one off left its popup — opened by clicking a ZIP polygon or an overlay
    // point — floating over a layer that no longer exists.
    const prevOverlays = prevPublicInvestmentOverlaysRef.current;
    const overlaysChanged =
      prevOverlays !== null &&
      PUBLIC_INVESTMENT_OVERLAY_IDS.some((id) => prevOverlays[id] !== publicInvestmentOverlays[id]);
    if (modeChanged || megaprojectsChanged || overlaysChanged) {
      sharedDotPopupRef.current?.remove();
    }
    prevInvestmentViewModeRef.current = mode;
    prevInvestmentMegaprojectsVisibleRef.current = investmentMegaprojectsVisible;
    prevPublicInvestmentOverlaysRef.current = publicInvestmentOverlays;

    const removeOverlay = () => {
      if (deckOverlayRef.current) {
        try {
          map.removeControl(deckOverlayRef.current as unknown as mapboxgl.IControl);
        } catch {
          // Already detached / map mid-teardown — nothing to free.
        }
        deckOverlayRef.current = null;
      }
    };

    // The deck.gl overlay drives ONLY Arcs + Density. Dots and Megaprojects are
    // mapbox-only, so neither creates the deck overlay.
    const overlayActive = layerVisible && communityInvestmentLoaded && (mode === "arcs" || mode === "density");
    if (!overlayActive) {
      removeOverlay();
      if (mode !== "arcs") setInvestmentArcMissingHqCount(0);
      return;
    }

    const activeFunderTypes = new Set<FunderType>(
      FUNDER_TYPE_ORDER.filter((k) => k !== "private_development" && investmentFunderTypes[k])
    );
    const filtered = excludeMegaprojectFeatures(
      filterInvestmentPointFeatures(investmentFeaturesRef.current, {
        yearRangeId: investmentYearRange,
        activeFunderTypes,
      }).filter(
        (feature) => publicInvestmentOverlayIdForSource(feature.properties.source) === null
      )
    );

    let layers: Layer[] = [];
    if (mode === "arcs") {
      const hqIndex = indexFunderHqsByName(investmentFunderHqsRef.current);
      const { arcs, fallbackFeatures, missingHqCount } = buildInvestmentArcData(filtered, hqIndex);
      const fallbackDotRadius = (() => {
        const scale = makeArcWidthScale(fallbackFeatures.map((f) => f.properties.amountAwarded));
        return (f: InvestmentPointFeature) => scale(f.properties.amountAwarded);
      })();
      setInvestmentArcMissingHqCount(missingHqCount);
      layers = [
        new ArcLayer<InvestmentArcDatum>({
          id: "investment-arcs",
          data: arcs,
          getSourcePosition: (d) => d.sourcePosition,
          getTargetPosition: (d) => d.targetPosition,
          getSourceColor: PHILANTHROPIC_ARC_COLOR,
          getTargetColor: PHILANTHROPIC_ARC_COLOR,
          getWidth: (d) => d.width,
          widthUnits: "pixels",
          greatCircle: true,
          pickable: true,
        }),
        // Philanthropic grants with no mapped funder HQ fall back to dots.
        new ScatterplotLayer<InvestmentPointFeature>({
          id: "investment-arc-fallback",
          data: fallbackFeatures,
          getPosition: (f) => f.geometry.coordinates as [number, number],
          getRadius: fallbackDotRadius,
          radiusUnits: "pixels",
          radiusMinPixels: 3,
          radiusMaxPixels: 8,
          getFillColor: PHILANTHROPIC_ARC_COLOR,
          stroked: true,
          getLineColor: [255, 255, 255, 220],
          lineWidthMinPixels: 1,
          pickable: true,
        }),
      ];
    } else {
      // density
      setInvestmentArcMissingHqCount(0);
      // In DOLLARS mode, exclude the null-amount government points (TIF / CDBG-HOME
      // / LIHTC — amountAwarded=null) so a bin of only non-grant points does NOT
      // paint a phantom $0 hexagon under the "$ awarded" ramp (and does not pin the
      // color domain floor to 0). RECORDS mode keeps every point — it is a plain
      // record-density count and the honest picture there includes all records.
      const densityData =
        investmentDensityMetric === "dollars"
          ? filtered.filter((f) => (f.properties.amountAwarded ?? 0) > 0)
          : filtered;
      layers = [
        new HexagonLayer<InvestmentPointFeature>({
          id: "investment-hexagons",
          data: densityData,
          getPosition: (f) => f.geometry.coordinates as [number, number],
          // dollars → AWARDED dollars only (never announcedInvestment — a
          // development's announced capital must not heat a bin); records → a
          // plain count (every point weight 1). densityWeightForMetric is the one
          // selector the legend caption + the deck weight agree on.
          getColorWeight: densityWeightForMetric(investmentDensityMetric),
          colorAggregation: "SUM",
          radius: HEXAGON_RADIUS_M,
          extruded: false,
          colorRange: DENSITY_COLOR_RANGE,
          opacity: 0.65,
          pickable: true,
        }),
      ];
    }

    if (!deckOverlayRef.current) {
      deckOverlayRef.current = new MapboxOverlay({
        interleaved: true,
        layers,
        getTooltip: getInvestmentDeckTooltip,
      });
      map.addControl(deckOverlayRef.current as unknown as mapboxgl.IControl);
    } else {
      // Re-apply getTooltip too: it closes over investmentDensityMetric (records
      // vs dollars wording), so a metric switch on an existing overlay must refresh
      // it — otherwise a stale closure keeps the old bin text.
      deckOverlayRef.current.setProps({ layers, getTooltip: getInvestmentDeckTooltip });
    }
  }, [
    loaded,
    adminSessionActive,
    communityInvestmentVisible,
    communityInvestmentLoaded,
    investmentViewMode,
    investmentMegaprojectsVisible,
    investmentYearRange,
    investmentFunderTypes,
    investmentDensityMetric,
    getInvestmentDeckTooltip,
    publicInvestmentOverlays,
  ]);

  return (
    <div className="relative w-full h-[calc(100dvh-56px)] md:h-[calc(100vh-220px)] min-h-[520px]">
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
      {loaded && (
        <MapSearch
          onResult={handleSearchResult}
          onQueryChange={setSearchQuery}
        />
      )}

      {/* Legend toggle button — desktop text button */}
      <button
        onClick={() => setLegendOpen((o) => !o)}
        className="hidden md:block absolute top-3 left-3 z-10 bg-white/95 backdrop-blur border border-[#0C1B33]/10 px-3 py-1.5 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/70 hover:text-[#0C1B33] transition-colors"
      >
        {legendOpen ? "Hide Legend" : "Show Legend"}
      </button>

      {/* Mobile control cluster — compact icon buttons (top-right) */}
      {loaded && (
        <div className="md:hidden absolute top-32 right-3 z-10 flex flex-col gap-2">
          <button
            onClick={() => { setLegendOpen((o) => !o); setSnapshotOpen(false); }}
            aria-label="Map layers"
            className={`w-11 h-11 flex items-center justify-center rounded-full backdrop-blur border shadow-md transition-colors touch-manipulation ${
              legendOpen ? "bg-[#2563EB] text-white border-[#2563EB]" : "bg-white/95 text-[#0C1B33]/70 border-[#0C1B33]/10"
            }`}
          >
            <Layers className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Interaction hint */}
      <div className="absolute bottom-3 left-3 z-10 bg-white/90 backdrop-blur border border-[#0C1B33]/10 px-3 py-1.5 font-mono-bureau text-[9px] md:text-[9px] tracking-[0.1em] text-[#0C1B33]/40 hidden md:block">
        Click anywhere for area data &middot; Right-click for zoning
      </div>
      {/* Mobile hint */}
      <div className="absolute bottom-3 left-3 z-10 backdrop-blur border px-3 py-1.5 font-mono-bureau text-[10px] tracking-[0.1em] md:hidden bg-white/90 text-[#0C1B33]/45 border-[#0C1B33]/10">
        Tap the map for area data
      </div>

      {/* Mobile backdrop — legend only. The snapshot is a bottom sheet that must
          leave the map tappable (a tap inspects a new area), so it gets NO
          scrim. The 350ms guard ignores the synthetic "ghost click" iOS fires
          right after a tap, which was instantly dismissing the just-opened
          snapshot (it landed on this scrim before you could see the card). */}
      {legendOpen && (
        <div
          className="absolute inset-0 z-[15] bg-black/20 md:hidden"
          onClick={() => {
            if (Date.now() - legendOpenedAtRef.current < 350) return;
            setLegendOpen(false);
          }}
        />
      )}

      {/* ── LEFT: Zone Layer Legend ──────────── */}
      {legendOpen && (
        <MapLegendPanel
          zoneVisible={zoneVisible}
          poiVisible={poiVisible}
          zoningVisible={zoningVisible}
          vacantVisible={vacantVisible}
          parcelsVisible={parcelsVisible}
          ownerFilter={ownerFilter}
          expandedZone={expandedZone}
          zoningRefOpen={zoningRefOpen}
          classRefOpen={classRefOpen}
          inspectMode={inspectMode}
          activePreset={activePreset}
          adminSessionActive={adminSessionActive}
          ownerClustersVisible={ownerClustersVisible}
          ownerClustersLoading={ownerClustersLoading}
          ownerClustersError={ownerClustersError}
          ownerClustersPresentTypes={ownerClustersPresentTypes}
          communityInvestmentVisible={communityInvestmentVisible}
          communityInvestmentLoading={communityInvestmentLoading}
          communityInvestmentError={communityInvestmentError}
          investmentPresentFunderTypes={investmentPresentFunderTypes}
          investmentPresentCapitalClasses={investmentPresentCapitalClasses}
          investmentFunderHqCount={investmentFunderHqCount}
          investmentYearRange={investmentYearRange}
          investmentFunderTypes={investmentFunderTypes}
          investmentCitywide={investmentCitywide}
          investmentViewMode={investmentViewMode}
          investmentDensityMetric={investmentDensityMetric}
          investmentArcMissingHqCount={investmentArcMissingHqCount}
          investmentMegaprojectSummary={megaprojectSummary}
          investmentMegaprojectCitywideNames={investmentCitywideDevelopmentNames}
          investmentMegaprojectsVisible={investmentMegaprojectsVisible}
          publicInvestmentOverlays={publicInvestmentOverlays}
          countyReliefZipCount={countyReliefZipCount}
          stateRecoveryZipCount={stateRecoveryZipCount}
          federalRestaurantReliefPlottedCount={federalRestaurantReliefPlottedCount}
          federalRestaurantReliefCitywideCount={federalRestaurantReliefCitywideCount}
          stateCapitalPlottedCount={stateCapitalPlottedCount}
          stateCapitalCitywideCount={stateCapitalCitywideCount}
          onSetCommunityInvestmentVisible={setCommunityInvestmentVisiblePersistent}
          onSetInvestmentYearRange={setInvestmentYearRangePersistent}
          onSetInvestmentViewMode={setInvestmentViewModePersistent}
          onSetInvestmentDensityMetric={setInvestmentDensityMetric}
          onSetInvestmentMegaprojectsVisible={setInvestmentMegaprojectsVisiblePersistent}
          onSetPublicInvestmentOverlay={setPublicInvestmentOverlayPersistent}
          onToggleInvestmentFunderType={toggleInvestmentFunderType}
          onClose={() => setLegendOpen(false)}
          onToggleZone={toggleZone}
          onTogglePoi={togglePoi}
          onToggleZoningCategory={toggleZoningCategory}
          onToggleAllZoning={toggleAllZoning}
          onSetVacantVisible={setVacantVisible}
          onSetParcelsVisible={setParcelsVisible}
          onSetOwnerFilter={setOwnerFilter}
          onSetExpandedZone={setExpandedZone}
          onSetZoningRefOpen={setZoningRefOpen}
          onSetClassRefOpen={setClassRefOpen}
          onSetInspectMode={setInspectMode}
          onApplyPreset={applyPreset}
          onSetOwnerClustersVisible={setOwnerClustersVisiblePersistent}
        />
      )}


      {countyReliefRecipientsPanel && (
        <CountyReliefRecipientsPanel
          sourceId={countyReliefRecipientsPanel.sourceId}
          programName={countyReliefRecipientsPanel.programName}
          year={countyReliefRecipientsPanel.year}
          zipCode={countyReliefRecipientsPanel.zipCode}
          status={countyReliefRecipientsPanel.status}
          recipients={countyReliefRecipientsPanel.recipients}
          sourceLink={countyReliefRecipientsPanel.sourceLink}
          onClose={closeCountyReliefRecipients}
          onRetry={() =>
            openHistoricalRecoveryRecipients(
              countyReliefRecipientsPanel.sourceId,
              countyReliefRecipientsPanel.zipCode,
            )
          }
        />
      )}

      {/* ── RIGHT: Area Snapshot Panel ──────── */}
      {snapshotOpen && loaded && (
        <MapSnapshotPanel
          areaStats={areaStats}
          snapshotLabel={snapshotLabel}
          snapshotLat={lastClickLat}
          snapshotLon={lastClickLon}
          snapshotPrograms={snapshotPrograms}
          snapshotTifFinance={snapshotTifFinance}
          snapshotContextSummary={snapshotContextSummary}
          tifFinanceLoading={tifFinanceLoading}
          zoningInfo={zoningInfo}
          isGeneratingSnapshot={isGeneratingSnapshot}
          openedAt={snapshotOpenedAtRef.current}
          onClose={() => setSnapshotOpen(false)}
          onGenerateSnapshot={handleGenerateSnapshot}
          onDrawArea={() => {
            const draw = drawRef.current;
            if (!draw) return;
            draw.deleteAll();
            setPolygonResults(null);
            setPolygonPanelOpen(false);
            setSnapshotOpen(false);
            draw.changeMode("draw_polygon");
            setDrawMode(true);
          }}
        />
      )}


      {/* Polygon analysis panel */}
      {polygonPanelOpen && polygonResults && (
        <MapPolygonPanel
          results={polygonResults}
          loading={polygonLoading}
          onClose={() => setPolygonPanelOpen(false)}
          onClear={() => {
            drawRef.current?.deleteAll();
            setPolygonResults(null);
            setPolygonPanelOpen(false);
            setDrawMode(false);
          }}
        />
      )}

      {/* Snapshot toggle (when closed) — desktop text button */}
      {!snapshotOpen && !polygonPanelOpen && !countyReliefRecipientsPanel && loaded && (
        <button
          onClick={() => setSnapshotOpen(true)}
          className="hidden md:block absolute top-3 right-3 z-10 bg-white/95 backdrop-blur border border-[#0C1B33]/10 px-3 py-1.5 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/70 hover:text-[#0C1B33] transition-colors"
        >
          Location Snapshot
        </button>
      )}

      {loaded && isMobile && !legendOpen && !snapshotOpen && !polygonPanelOpen && !countyReliefRecipientsPanel && !drawMode && (
        <MapMobileSheet
          activePreset={activeMobilePreset}
          snapshotLabel={snapshotLabel}
          isGeneratingSnapshot={isGeneratingSnapshot}
          onApplyPreset={applyPreset}
          onGenerateSnapshot={handleGenerateSnapshot}
          onShowAdvanced={() => setLegendOpen(true)}
        />
      )}

      {/* Draw mode instruction banner */}
      {drawMode && loaded && (
        <div className="absolute top-28 md:top-12 left-1/2 -translate-x-1/2 z-20 bg-[#2563EB] text-white px-4 py-2 rounded-b shadow-md text-center">
          <div className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase">
            Click to place points — double-click to finish
          </div>
          <div className="text-[9px] opacity-70 mt-0.5">
            Draw a shape around the area you want to analyze
          </div>
        </div>
      )}

      {/* Draw Area button — hidden when right panels are open, always visible in draw mode */}
      {loaded && (drawMode || (!snapshotOpen && !polygonPanelOpen && !countyReliefRecipientsPanel && !isMobile)) && (
        <button
          onClick={() => {
            const draw = drawRef.current;
            const map = mapRef.current;
            if (!draw || !map) return;
            if (drawMode) {
              draw.changeMode("simple_select");
              setDrawMode(false);
            } else {
              draw.deleteAll();
              setPolygonResults(null);
              setPolygonPanelOpen(false);
              draw.changeMode("draw_polygon");
              setDrawMode(true);
              setSnapshotOpen(false);
            }
          }}
          className={`absolute bottom-16 left-3 md:bottom-24 md:right-3 md:left-auto z-10 backdrop-blur border px-3 py-2 md:py-1.5 font-mono-bureau tracking-[0.15em] uppercase transition-colors ${
            drawMode
              ? "bg-[#2563EB] text-white border-[#2563EB]"
              : "bg-white/95 text-[#0C1B33]/70 border-[#0C1B33]/10 hover:text-[#0C1B33]"
          }`}
        >
          <span className="text-[11px] md:text-[10px]">{drawMode ? "Cancel Draw" : "Draw Area"}</span>
          {!drawMode && (
            <span className="hidden md:block text-[8px] opacity-50 tracking-[0.1em] mt-0.5">
              Analyze vacant properties
            </span>
          )}
        </button>
      )}

    </div>
  );
}
