"use client";

import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Download,
  FileDown,
  FileText,
  Loader2,
  Mail,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { ZONE_COLORS, ZONE_LABELS } from "@/lib/constants";
import { OWNER_TYPE_LABELS, OWNER_TYPE_COLORS, type OwnerType } from "@/lib/owner-classify";
import { SECTION_IDS, type GeneratedReport } from "@/lib/report-engine";
import { programCount } from "@/lib/report-email";
import type { WizardState } from "@/lib/report-wizard-config";
import { SaveReportModal } from "@/components/workspace/SaveReportModal";
import { storePendingReport } from "@/components/workspace/PendingReportSaver";
import {
  fetchCommunityInvestmentLayer,
  type CommunityInvestmentLayerResult,
  type InvestmentPointFeature,
} from "@/lib/community-investment-layer";
import {
  buildDrawnAreaCsv,
  defaultDrawnAreaName,
  drawnAreaFilenameSlug,
  formatPolygonInvestmentAmount,
  investmentExclusionsFromLayer,
  polygonInvestmentBucket,
  polygonInvestmentExclusionNotes,
  polygonInvestmentYearSpanLabel,
  selectInvestmentPointsInArea,
  aggregateInvestmentPoints,
  PERMIT_AREA_LOOKUP_UNAVAILABLE_NOTE,
  POLYGON_INVESTMENT_EMPTY_NOTE,
  POLYGON_INVESTMENT_HEADING,
  POLYGON_INVESTMENT_NO_TOTAL_NOTE,
  type DrawnAreaInput,
  type PolygonInvestmentSummary,
} from "@/lib/polygon-investment";
import {
  fetchPermitArea,
  formatPermitAreaDate,
  formatPermitAreaCoverageLabel,
  PERMIT_AREA_ACTIVITY_NOTE,
  PERMIT_AREA_COVERAGE_NOTE,
  PERMIT_AREA_HEADING,
  type PermitAreaResult,
} from "@/lib/permit-area";
import {
  VACANCY_LOOKUP_UNAVAILABLE_NOTE,
  vacancyCoverageDisclosure,
  type VacancyCoverageMetadata,
} from "@/lib/drawn-area-vacancy";
import type { VacancyFreshnessFilter } from "@/lib/vacancy-evidence";
import {
  currentLicenseConflictSummary,
  isOfficialCclbaPublishedInventorySource,
  licenseScreeningReportItems,
  summarizeAreaVacancyTypes,
  vacancyCanonicalTypeLabel,
  vacancyFreshnessLabel,
  vacancySourceLabel,
  type VacancyLicenseFilter,
} from "@/lib/area-vacancy-presentation";
import { createDrawnAreaReportScope } from "@/lib/drawn-area-report-scope";
import { programContextToText } from "@/lib/vacancy-spreadsheet";
import { safeVacancyProgramUrl } from "@/lib/vacancy-spreadsheet-scope";
import { CCLBA_PUBLIC_PORTAL_URL } from "@/lib/vacancy-inventory-sources";
import {
  AREA_ANALYSIS_EVIDENCE_FAMILIES,
  AREA_ANALYSIS_PRACTITIONER_NOTES_MAX_LENGTH,
  DEFAULT_AREA_PERMIT_WORKSTATION_FILTERS,
  DEFAULT_AREA_VACANCY_WORKSTATION_FILTERS,
  activeAreaPermitFilterLabels,
  activeAreaVacancyFilterLabels,
  deriveAreaPermitFacetOptions,
  deriveAreaVacancyFacetOptions,
  filterAreaPermitWorkstationRecords,
  filterAreaVacancyWorkstationFeatures,
  hasActiveAreaPermitFilters,
  hasActiveAreaVacancyFilters,
  normalizeAreaPractitionerNotes,
  type AreaAnalysisEvidenceFamilyId,
  type AreaPermitWorkstationFilters,
  type AreaVacancyWorkstationFilters,
} from "@/lib/area-analysis-workstation";

/** Vacancy follow-up resources */
const RESOURCES = [
  {
    name: "CCSA Storefront Activation",
    desc: "$30.5M in grants for storefront improvements across 12 corridors",
    url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/ccsa.html",
  },
  {
    name: "Cook County Land Bank (CCLBA)",
    desc: "Acquire vacant lots and buildings cleared of back taxes",
    url: "https://cookcountylandbank.org/pre-qualification-application-purchasing-property/",
  },
  {
    name: "Chicago Large Lots Program",
    desc: "Purchase city-owned vacant lots for $1 in eligible areas",
    url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/large-lot-program.html",
  },
  {
    name: "Chi Block Builders",
    desc: "Community-led vacant lot activation and block development",
    url: "https://www.chiblockbuilders.com/",
  },
  {
    name: "Neighborhood Opportunity Fund",
    desc: "Grants for commercial projects on the South & West Sides",
    url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/neighborhood-opportunity-fund0.html",
  },
];

const PROPERTY_LIST_RENDER_LIMIT = 100;

/**
 * Module-scope cache for the gated Community Investment export so an admin who
 * draws several areas in one session pays for ONE fetch. The promise is dropped
 * on rejection so a transient failure can be retried by the next draw. Mirrors
 * the "fetch once per session" contract the map layer already honors with
 * `communityInvestmentLoaded` in MapView.
 */
let investmentLayerPromise: Promise<CommunityInvestmentLayerResult> | null = null;

function loadInvestmentLayerOnce(
  fetchImpl?: typeof fetch,
): Promise<CommunityInvestmentLayerResult> {
  if (!investmentLayerPromise) {
    investmentLayerPromise = fetchCommunityInvestmentLayer(
      fetchImpl ? { fetchImpl } : undefined,
    ).catch((err) => {
      investmentLayerPromise = null;
      throw err;
    });
  }
  return investmentLayerPromise;
}

/** Test-only cache reset so one spec's stub never leaks into the next. */
export function __resetPolygonInvestmentCache(): void {
  investmentLayerPromise = null;
}

interface MapPolygonPanelProps {
  results: GeoJSON.FeatureCollection;
  loading: boolean;
  /** Coverage contract returned by /api/vacant for this exact shape. */
  vacancyCoverage?: VacancyCoverageMetadata | null;
  /** HTTP or malformed-response failure; never interpret the empty collection as zero. */
  vacancyLoadFailed?: boolean;
  /** Draft editing is explicit; analyzed results remain tied to `polygon`. */
  editing?: boolean;
  editDirty?: boolean;
  onEdit?: () => void;
  onEditDone?: () => void;
  onEditCancel?: () => void;
  /** Keeps the point layer identical to the panel/report/export filter set. */
  onDisplayedFeaturesChange?: (features: readonly GeoJSON.Feature[]) => void;
  onClose: () => void;
  onClear: () => void;
  /**
   * The polygon the user drew, forwarded from MapView's draw.create handler.
   * Required for the admin investment section — without a shape there is
   * nothing to select against.
   */
  polygon?: DrawnAreaInput;
  /**
   * Result of MapView's one-time /api/owner-file/session probe. The investment
   * section renders ONLY when this is true; an unauthenticated viewer sees
   * nothing new anywhere in this panel, including in the CSV export.
   */
  adminSessionActive?: boolean;
  /**
   * Pre-loaded gated layer result. Supplied by tests (and available to MapView
   * if it ever wants to hand over its already-fetched copy); when absent the
   * panel lazily fetches once on the first polygon draw.
   */
  investmentLayer?: CommunityInvestmentLayerResult | null;
  /** Test seam for the gated fetch, mirroring fetchCommunityInvestmentLayer's. */
  investmentFetchImpl?: typeof fetch;
  /** Pre-loaded permit analysis for tests or callers that already queried it. */
  permitArea?: PermitAreaResult | null;
  /** Test seam for the public polygon permit lookup. */
  permitFetchImpl?: typeof fetch;
  /** Durable workstation state is owned by MapView so closing is non-destructive. */
  areaName?: string;
  onAreaNameChange?: (value: string) => void;
  practitionerNotes?: string;
  onPractitionerNotesChange?: (value: string) => void;
  activeEvidenceFamily?: AreaAnalysisEvidenceFamilyId;
  onActiveEvidenceFamilyChange?: (value: AreaAnalysisEvidenceFamilyId) => void;
  vacancyWorkstationFilters?: AreaVacancyWorkstationFilters;
  onVacancyWorkstationFiltersChange?: (value: AreaVacancyWorkstationFilters) => void;
  permitWorkstationFilters?: AreaPermitWorkstationFilters;
  onPermitWorkstationFiltersChange?: (value: AreaPermitWorkstationFilters) => void;
}

function permitPolygonFromArea(area: DrawnAreaInput): GeoJSON.Polygon | null {
  if (!area) return null;
  if (area.type === "Polygon") return area;
  if (area.type === "Feature" && area.geometry?.type === "Polygon") {
    return area.geometry;
  }
  return null;
}

export default function MapPolygonPanel({
  results,
  loading,
  vacancyCoverage = null,
  vacancyLoadFailed = false,
  editing = false,
  editDirty = false,
  onEdit,
  onEditDone,
  onEditCancel,
  onDisplayedFeaturesChange,
  onClose,
  onClear,
  polygon = null,
  adminSessionActive = false,
  investmentLayer = null,
  investmentFetchImpl,
  permitArea = null,
  permitFetchImpl,
  areaName: controlledAreaName,
  onAreaNameChange,
  practitionerNotes: controlledPractitionerNotes,
  onPractitionerNotesChange,
  activeEvidenceFamily: controlledActiveEvidenceFamily,
  onActiveEvidenceFamilyChange,
  vacancyWorkstationFilters: controlledVacancyFilters,
  onVacancyWorkstationFiltersChange,
  permitWorkstationFilters: controlledPermitFilters,
  onPermitWorkstationFiltersChange,
}: MapPolygonPanelProps) {
  const { status } = useSession();
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  // R1 finding 5: `handleDownloadPdf` was an un-caught async click handler —
  // a failed jsPDF render became a silent unhandled rejection and the reader
  // simply got no file, with nothing on screen to say so or to retry from.
  const [pdfDownloadFailed, setPdfDownloadFailed] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const editDoneButtonRef = useRef<HTMLButtonElement | null>(null);
  const loadingStatusRef = useRef<HTMLDivElement | null>(null);
  const wasEditingRef = useRef(editing);
  const restoreFocusAfterLoadingRef = useRef(false);
  const allFeatures = results.features;
  const [localAreaName, setLocalAreaName] = useState(() => defaultDrawnAreaName());
  const [localPractitionerNotes, setLocalPractitionerNotes] = useState("");
  const [localActiveEvidenceFamily, setLocalActiveEvidenceFamily] =
    useState<AreaAnalysisEvidenceFamilyId>("overview");
  const [localVacancyFilters, setLocalVacancyFilters] =
    useState<AreaVacancyWorkstationFilters>(() => ({
      ...DEFAULT_AREA_VACANCY_WORKSTATION_FILTERS,
      freshness: "current_screening",
    }));
  const [localPermitFilters, setLocalPermitFilters] =
    useState<AreaPermitWorkstationFilters>(() => ({
      ...DEFAULT_AREA_PERMIT_WORKSTATION_FILTERS,
    }));
  const areaName = controlledAreaName ?? localAreaName;
  const practitionerNotes = controlledPractitionerNotes ?? localPractitionerNotes;
  const activeEvidenceFamily =
    controlledActiveEvidenceFamily ?? localActiveEvidenceFamily;
  const vacancyFilters = controlledVacancyFilters ?? localVacancyFilters;
  const permitFilters = controlledPermitFilters ?? localPermitFilters;
  const updateAreaName = onAreaNameChange ?? setLocalAreaName;
  const updatePractitionerNotes =
    onPractitionerNotesChange ?? setLocalPractitionerNotes;
  const updateActiveEvidenceFamily =
    onActiveEvidenceFamilyChange ?? setLocalActiveEvidenceFamily;
  const updateVacancyFilters =
    onVacancyWorkstationFiltersChange ?? setLocalVacancyFilters;
  const updatePermitFilters =
    onPermitWorkstationFiltersChange ?? setLocalPermitFilters;
  const freshnessFilter: VacancyFreshnessFilter =
    vacancyFilters.freshness === "all"
      ? "all_records"
      : vacancyFilters.freshness;
  const licenseScreening = vacancyCoverage?.licenseScreening ?? null;
  const licenseMalformedRowCount = licenseScreening?.malformedRowCount ?? 0;
  const licensePartialReasonSummary =
    licenseScreening?.partialReasons?.join(", ") || "none";
  const licenseFilterAvailable =
    licenseScreening?.status === "available" ||
    licenseScreening?.status === "partial";
  const effectiveLicenseFilter: VacancyLicenseFilter = licenseFilterAvailable
    ? vacancyFilters.licenseConflict
    : "all";
  const freshnessFilterLabel =
    freshnessFilter === "current_screening"
      ? "Current screen — public inventory + reports within 3 years"
      : freshnessFilter === "recent_reports"
        ? "Reports within 3 years only"
        : "All retained source records — 311 window is 5 years";
  const licenseFilterLabel =
    effectiveLicenseFilter === "conflicts"
      ? "Current-license conflicts only"
      : "All signals in this screen";
  const features = useMemo(
    () =>
      filterAreaVacancyWorkstationFeatures(allFeatures, {
        ...vacancyFilters,
        licenseConflict: effectiveLicenseFilter,
      }),
    [allFeatures, effectiveLicenseFilter, vacancyFilters],
  );
  useEffect(() => {
    onDisplayedFeaturesChange?.(editing ? [] : features);
  }, [editing, features, onDisplayedFeaturesChange]);
  useEffect(() => {
    const wasEditing = wasEditingRef.current;
    wasEditingRef.current = editing;
    if (editing && !wasEditing) {
      requestAnimationFrame(() => editDoneButtonRef.current?.focus());
    } else if (!editing && wasEditing) {
      requestAnimationFrame(() => {
        if (loading) {
          restoreFocusAfterLoadingRef.current = true;
          loadingStatusRef.current?.focus();
        } else {
          editButtonRef.current?.focus();
        }
      });
    } else if (!editing && !loading && restoreFocusAfterLoadingRef.current) {
      restoreFocusAfterLoadingRef.current = false;
      requestAnimationFrame(() => editButtonRef.current?.focus());
    }
  }, [editing, loading]);
  const vacancyCoverageNote = vacancyLoadFailed
    ? VACANCY_LOOKUP_UNAVAILABLE_NOTE
    : vacancyCoverageDisclosure(vacancyCoverage);
  const vacancyCoverageIncomplete =
    vacancyLoadFailed ||
    vacancyCoverage?.coverageStatus === "partial" ||
    vacancyCoverage?.coverageStatus === "truncated";
  const vacancyFiltersAreRefined =
    vacancyFilters.freshness !== "current_screening" ||
    hasActiveAreaVacancyFilters({
      ...vacancyFilters,
      // Freshness is compared to the workstation baseline above. Neutralize it
      // here so the shared helper can evaluate the remaining controls.
      freshness: DEFAULT_AREA_VACANCY_WORKSTATION_FILTERS.freshness,
    });

  /* Public, source-backed permit analysis for this exact drawn polygon. */
  const permitPolygon = useMemo(() => permitPolygonFromArea(polygon), [polygon]);
  const permitRequestKey = useMemo(
    () => (permitPolygon ? JSON.stringify(permitPolygon) : null),
    [permitPolygon],
  );
  const [permitLookup, setPermitLookup] = useState<{
    key: string;
    status: "loading" | "ready" | "failed";
    result: PermitAreaResult | null;
  } | null>(null);
  const [permitRetryNonce, setPermitRetryNonce] = useState(0);
  const currentPermitLookup =
    permitLookup?.key === permitRequestKey ? permitLookup : null;
  const fetchedPermitArea =
    currentPermitLookup?.status === "ready" ? currentPermitLookup.result : null;
  const permitLoadFailed = currentPermitLookup?.status === "failed";
  const permitAnalysis = permitArea ?? fetchedPermitArea;

  useEffect(() => {
    if (!permitPolygon || !permitRequestKey || permitArea) return;
    const controller = new AbortController();

    fetchPermitArea(permitPolygon, {
      fetchImpl: permitFetchImpl,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setPermitLookup({ key: permitRequestKey, status: "ready", result });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPermitLookup({ key: permitRequestKey, status: "failed", result: null });
        }
      });

    return () => {
      controller.abort();
    };
  }, [permitArea, permitFetchImpl, permitPolygon, permitRequestKey, permitRetryNonce]);

  const permitPending =
    !!permitPolygon &&
    !permitAnalysis &&
    currentPermitLookup?.status !== "failed";
  const permitRecords = useMemo(
    () => permitAnalysis?.records ?? [],
    [permitAnalysis],
  );
  const filteredPermitRecords = useMemo(
    () => filterAreaPermitWorkstationRecords(permitRecords, permitFilters),
    [permitFilters, permitRecords],
  );
  const permitFacetOptions = useMemo(
    () => deriveAreaPermitFacetOptions(permitRecords),
    [permitRecords],
  );
  const vacancyFacetOptions = useMemo(
    () => deriveAreaVacancyFacetOptions(allFeatures),
    [allFeatures],
  );
  const vacancyFilterLabels = useMemo(
    () =>
      activeAreaVacancyFilterLabels({
        ...vacancyFilters,
        licenseConflict: effectiveLicenseFilter,
      }),
    [effectiveLicenseFilter, vacancyFilters],
  );
  const permitFilterLabels = useMemo(
    () => activeAreaPermitFilterLabels(permitFilters),
    [permitFilters],
  );
  const normalizedPractitionerNotes = useMemo(
    () => normalizeAreaPractitionerNotes(practitionerNotes),
    [practitionerNotes],
  );
  const recentPermitYears = useMemo(
    () => (permitAnalysis?.yearBreakdown ?? []).slice(0, 6).reverse(),
    [permitAnalysis],
  );
  const maxRecentPermitYearCount = Math.max(
    1,
    ...recentPermitYears.map((row) => row.count),
  );
  const maxPermitTypeCount = Math.max(
    1,
    ...(permitAnalysis?.typeBreakdown ?? []).map((row) => row.count),
  );

  /* ── Admin-only community-investment analysis ──
     The evidence family renders only after the admin-session probe came back
     204. Ready data can enter the CSV; pending and failed requests expose only
     their status, never gated records. A non-admin never triggers the fetch. */
  const [fetchedLayer, setFetchedLayer] = useState<CommunityInvestmentLayerResult | null>(null);
  const [investmentLoadFailed, setInvestmentLoadFailed] = useState(false);
  const layerRequestedRef = useRef(false);
  /** A caller-supplied result wins over our own lazy fetch. */
  const layer = investmentLayer ?? fetchedLayer;

  useEffect(() => {
    if (!adminSessionActive || layer || !polygon) return;
    if (layerRequestedRef.current) return;
    layerRequestedRef.current = true;
    setInvestmentLoadFailed(false);
    let cancelled = false;
    loadInvestmentLayerOnce(investmentFetchImpl)
      .then((result) => {
        if (!cancelled) {
          setInvestmentLoadFailed(false);
          setFetchedLayer(result);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Allow the next draw to retry rather than stranding the section.
        layerRequestedRef.current = false;
        setInvestmentLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [adminSessionActive, layer, polygon, investmentFetchImpl]);

  /** Derived states keep loading, failure, and a ready zero distinguishable. */
  const investmentPending =
    adminSessionActive && !!polygon && !layer && !investmentLoadFailed;
  const investmentUnavailable =
    adminSessionActive &&
    !!polygon &&
    (investmentLoadFailed || (!!layer && layer.status !== "ready"));
  const investmentUnauthorized = layer?.status === "unauthorized";

  /** Investment points inside the drawn area — null unless admin AND ready. */
  const investmentSelection = useMemo<InvestmentPointFeature[] | null>(() => {
    if (!adminSessionActive || !polygon) return null;
    if (!layer || layer.status !== "ready") return null;
    return selectInvestmentPointsInArea(polygon, layer.pointFeatures);
  }, [adminSessionActive, polygon, layer]);

  const investmentSummary = useMemo<PolygonInvestmentSummary | null>(() => {
    if (!investmentSelection || !layer) return null;
    return aggregateInvestmentPoints(investmentSelection, investmentExclusionsFromLayer(layer));
  }, [investmentSelection, layer]);

  const investmentMoneyBuckets = useMemo(
    () => (investmentSummary ? investmentSummary.buckets.filter((b) => b.count > 0) : []),
    [investmentSummary],
  );

  const investmentExclusionNotes = useMemo(
    () => (investmentSummary ? polygonInvestmentExclusionNotes(investmentSummary.exclusions) : []),
    [investmentSummary],
  );

  /* ── Summary counts: every canonical bucket sums back to displayed total. ── */
  const vacancyTypeCounts = useMemo(
    () => summarizeAreaVacancyTypes(features),
    [features],
  );
  const vacantLandCount = vacancyTypeCounts.land;
  const vacantBuildingCount = vacancyTypeCounts.building;
  const licenseConflictCount = features.filter(
    (feature) => feature.properties?.licenseCheckState === "match",
  ).length;
  const propertyListFeatures = features.slice(0, PROPERTY_LIST_RENDER_LIMIT);
  const hasOfficialCclbaPublishedInventory = useMemo(
    () =>
      features.some((feature) =>
        isOfficialCclbaPublishedInventorySource(feature.properties),
      ),
    [features],
  );

  /* ── Top community area ── */
  const topCommunityArea = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of features) {
      const ca = f.properties?.communityArea;
      if (ca) map.set(ca, (map.get(ca) ?? 0) + 1);
    }
    let top = "";
    let max = 0;
    for (const [k, v] of map) {
      if (v > max) { top = k; max = v; }
    }
    return top;
  }, [features]);

  /* ── Zone breakdown ── */
  const zoneCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of features) {
      const matches = f.properties?.zoneMatches ?? [];
      const featureZoneKeys = new Set<string>();
      for (const z of matches) {
        const key = typeof z === "string" ? z : z.zoneKey;
        if (key) featureZoneKeys.add(key);
      }
      for (const key of featureZoneKeys) {
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count }));
  }, [features]);

  /* ── Ownership breakdown ── */
  const ownerCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of features) {
      const ot: string = f.properties?.ownerType ?? "unknown";
      map.set(ot, (map.get(ot) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key: key as OwnerType, count }));
  }, [features]);

  /* ── Narrative summary ── */
  const narrative = useMemo(() => {
    if (features.length === 0) return "";
    const parts: string[] = [];
    parts.push(
      `The current filters show ${features.length} tracked public-record vacancy ${features.length === 1 ? "signal" : "signals"}`
    );
    if (topCommunityArea) {
      parts[0] += ` in ${topCommunityArea}`;
    }
    parts[0] += ".";

    const typeBreak: string[] = [];
    if (vacancyTypeCounts.land > 0) typeBreak.push(`${vacancyTypeCounts.land} land`);
    if (vacancyTypeCounts.building > 0) typeBreak.push(`${vacancyTypeCounts.building} building`);
    if (vacancyTypeCounts.storefront > 0) {
      typeBreak.push(`${vacancyTypeCounts.storefront} storefront`);
    }
    if (vacancyTypeCounts.other > 0) typeBreak.push(`${vacancyTypeCounts.other} other`);
    if (typeBreak.length > 0) {
      parts.push(`The complete type breakdown is ${typeBreak.join(", ")}.`);
    }

    if (licenseConflictCount > 0) {
      parts.push(
        `${licenseConflictCount} ${licenseConflictCount === 1 ? "has" : "have"} a current-license conflict signal; confirm present use before relying on the vacancy record.`,
      );
    }

    if (zoneCounts.length > 0) {
      const topZone = ZONE_LABELS[zoneCounts[0].key] ?? zoneCounts[0].key;
      parts.push(
        `${zoneCounts[0].count} of these fall within a ${topZone} zone${zoneCounts.length > 1 ? `, plus ${zoneCounts.length - 1} other incentive ${zoneCounts.length - 1 === 1 ? "zone" : "zones"}` : ""}.`
      );
    }

    const publicCount = ownerCounts.find((o) => o.key === "city_public")?.count ?? 0;
    if (publicCount > 0) {
      parts.push(
        `${publicCount} ${publicCount === 1 ? "is" : "are"} classified as public ownership. Review the source record to distinguish City inventory from Cook County Land Bank Authority records and to confirm any disposition path.`
      );
    }

    return parts.join(" ");
  }, [
    features,
    licenseConflictCount,
    topCommunityArea,
    vacancyTypeCounts,
    zoneCounts,
    ownerCounts,
  ]);

  const drawnAreaScope = useMemo(() => {
    if (!permitPolygon) return null;
    const result = createDrawnAreaReportScope({
      name: areaName.trim() || topCommunityArea || "Drawn Area",
      geometry: permitPolygon,
      generatedAt: new Date().toISOString(),
      vacancy: {
        loadFailed: vacancyLoadFailed,
        coverage: vacancyCoverage,
        freshnessFilter,
        licenseFilter: effectiveLicenseFilter,
        returnedCountBeforeFilters: vacancyLoadFailed ? null : allFeatures.length,
        selectedFeatures: features,
      },
      permit: {
        analysis: permitAnalysis,
        loadFailed: permitLoadFailed,
      },
      workstation: {
        activeEvidenceFamily,
        ...(normalizedPractitionerNotes
          ? { practitionerNotes: normalizedPractitionerNotes }
          : {}),
        vacancyFilters: {
          ...vacancyFilters,
          licenseConflict: effectiveLicenseFilter,
        },
        permitFilters,
      },
    });
    return result.ok ? result.scope : null;
  }, [
    allFeatures.length,
    activeEvidenceFamily,
    areaName,
    effectiveLicenseFilter,
    features,
    freshnessFilter,
    normalizedPractitionerNotes,
    permitAnalysis,
    permitFilters,
    permitLoadFailed,
    permitPolygon,
    topCommunityArea,
    vacancyCoverage,
    vacancyFilters,
    vacancyLoadFailed,
  ]);

  const areaReport = useMemo<GeneratedReport>(() => {
    const reportAreaName = areaName.trim() || topCommunityArea || "Drawn Area";
    const permitCoverageLabel = permitAnalysis
      ? formatPermitAreaCoverageLabel(permitAnalysis)
      : null;
    /* Save Report and Email This to Me render under the same gate as the CSV, so
       a 503 on the permit lookup reaches them too. A report that just drops the
       permit section reads as an area where permits were checked and none found
       — and unlike the panel, it is stored and re-read long after the outage. */
    const permitLookupUnavailable = permitLoadFailed && !permitAnalysis;
    const zoneItems = zoneCounts.map(({ key, count }) => ({
      label: ZONE_LABELS[key] || key,
      value: `${count} signal${count === 1 ? "" : "s"}`,
      detail: `${features.length > 0 ? Math.round((count / features.length) * 100) : 0}% of the displayed vacancy signals fall within this zone.`,
    }));

    const ownerItems = ownerCounts.map(({ key, count }) => ({
      label: OWNER_TYPE_LABELS[key] || key,
      value: `${count} signal${count === 1 ? "" : "s"}`,
      detail: `${features.length > 0 ? Math.round((count / features.length) * 100) : 0}% of the displayed vacancy signals.`,
    }));

    const propertyItems = features.slice(0, 20).map((feature) => {
      const p = feature.properties ?? {};
      const zones: unknown[] = p.zoneMatches ?? [];
      const sourceDate = typeof p.sourceRecordDate === "string"
        ? p.sourceRecordDate.slice(0, 10)
        : "source date unavailable";
      const conflict = currentLicenseConflictSummary(p.currentLicenseMatches);
      const sourceStatus =
        typeof p.status === "string" && p.status.trim()
          ? p.status.trim()
          : "not recorded";
      const programName =
        typeof p.programName === "string" && p.programName.trim()
          ? p.programName.trim()
          : null;
      const managingOrganization =
        typeof p.managingOrganization === "string" &&
        p.managingOrganization.trim()
          ? p.managingOrganization.trim()
          : null;
      const publishedSourceContext = programContextToText(p.programContext);
      const programContext = [
        programName ? `Published program / disposition context: ${programName}` : null,
        managingOrganization
          ? `Managing organization: ${managingOrganization}`
          : null,
        publishedSourceContext || null,
      ].filter((value): value is string => value !== null);
      const applicationUrl = safeVacancyProgramUrl(p.applicationUrl);
      return {
        label: String(p.address || "Unknown Address"),
        value: vacancyCanonicalTypeLabel(p.canonicalType),
        detail: `${vacancySourceLabel(p.source, p)} · Source status: ${sourceStatus} · ${sourceDate} · ${vacancyFreshnessLabel(p.freshnessClass)} · ${zones.length} incentive zone${zones.length !== 1 ? "s" : ""}${p.ownerType ? ` · ${OWNER_TYPE_LABELS[p.ownerType as OwnerType] || p.ownerType}` : ""}${programContext.length > 0 ? ` · ${programContext.join(" · ")} · Verify current availability and terms.` : ""}${conflict ? ` · Current-license conflict: ${conflict}` : ""}`,
        url: applicationUrl ?? undefined,
      };
    });

    const permitTypeItems = (permitAnalysis?.typeBreakdown ?? []).map((row) => ({
      label: row.label,
      value: `${row.count} filing${row.count === 1 ? "" : "s"}`,
      detail: "Exact City permit category count among geocoded filings inside the drawn area.",
    }));
    const permitRecordItems = filteredPermitRecords.slice(0, 25).map((record) => ({
      label: record.address || "Address not recorded",
      value: record.permitTypeLabel,
      detail: `${record.permitId} · ${formatPermitAreaDate(record.issueDate)} · ${record.permitStatus || "Status not recorded"}${record.workDescription ? ` · ${record.workDescription}` : ""}`,
    }));
    const permitRecordSnapshotItems = [
      {
        label: "Matching Recent Records",
        value: `${filteredPermitRecords.length} of ${permitRecords.length}`,
        detail:
          "Workstation filters narrow only the recent record-level review set. They do not recalculate the full-polygon permit aggregates.",
      },
      {
        label: "Records Included in This Snapshot",
        value: `${permitRecordItems.length} of ${filteredPermitRecords.length}`,
        detail:
          filteredPermitRecords.length > permitRecordItems.length
            ? `This report includes the first ${permitRecordItems.length} matching recent records. Export the CSV for all ${filteredPermitRecords.length} filtered recent records.`
            : "Every matching recent record is included in this report snapshot.",
      },
      ...permitRecordItems,
    ];

    const summaryParts = [
      vacancyLoadFailed
        ? VACANCY_LOOKUP_UNAVAILABLE_NOTE
        : narrative ||
          vacancyCoverageNote ||
          `No tracked vacancy signals matched the selected filters inside ${reportAreaName}.`,
    ];
    if (permitAnalysis) {
      summaryParts.push(
        `${permitAnalysis.totalFilings} geocoded permit filing${permitAnalysis.totalFilings === 1 ? "" : "s"} fall inside the area. ${permitCoverageLabel}.`,
      );
    } else if (permitLookupUnavailable) {
      summaryParts.push(PERMIT_AREA_LOOKUP_UNAVAILABLE_NOTE);
    }

    return {
      ...(drawnAreaScope ? { drawnAreaScope } : {}),
      title: `Area Analysis Report — ${reportAreaName}`,
      subtitle: "Drawn-area public-record vacancy signals and permit context",
      reportType: "best-location",
      generatedAt: drawnAreaScope?.generatedAt ?? new Date().toISOString(),
      summary: summaryParts.join(" "),
      sections: [
        ...(normalizedPractitionerNotes
          ? [
              {
                id: SECTION_IDS.practitionerNotes,
                title: "Practitioner Notes",
                description:
                  "User-authored context saved with this analysis. It is not source evidence and should be reviewed separately from public records.",
                items: [
                  {
                    label: "Note",
                    value: normalizedPractitionerNotes,
                  },
                ],
              },
            ]
          : []),
        {
          id: SECTION_IDS.areaSnapshot,
          title: "Area Snapshot",
          description: "Source-backed vacancy signals and permit context inside the drawn area.",
          items: [
            ...(vacancyLoadFailed
              ? [
                  {
                    label: "Vacancy Lookup",
                    value: "Unavailable",
                    detail: VACANCY_LOOKUP_UNAVAILABLE_NOTE,
                  },
                ]
              : [
                  {
                    label: "Vacancy Signals Shown",
                    value: String(features.length),
                    detail: `${allFeatures.length} source record${allFeatures.length === 1 ? " was" : "s were"} returned before the selected filters.${vacancyCoverageNote ? ` ${vacancyCoverageNote}` : ""}`,
                  },
                  {
                    label: "Vacancy Evidence Filter",
                    value: freshnessFilterLabel,
                    detail: `${allFeatures.length} source record${allFeatures.length === 1 ? " was" : "s were"} returned before filtering; ${features.length} ${features.length === 1 ? "is" : "are"} represented in this report.`,
                  },
                  {
                    label: "License Conflict Filter",
                    value: licenseFilterLabel,
                  },
                  {
                    label: "Active Vacancy View Filters",
                    value:
                      vacancyFilterLabels.length > 0
                        ? vacancyFilterLabels.join("; ")
                        : "None",
                    detail:
                      "These filters apply to the records returned for this area. They do not widen the upstream source query.",
                  },
                  {
                    label: "Tracked Land Signals",
                    value: String(vacantLandCount),
                  },
                  {
                    label: "Tracked Building Signals",
                    value: String(vacantBuildingCount),
                  },
                  {
                    label: "Tracked Storefront Signals",
                    value: String(vacancyTypeCounts.storefront),
                  },
                  {
                    label: "Other Tracked Signals",
                    value: String(vacancyTypeCounts.other),
                  },
                  {
                    label: "Current-License Conflicts",
                    value: String(licenseConflictCount),
                    detail:
                      "Issued, unexpired BACP licenses matched to exact published addresses. This is a conflict signal, not proof of occupancy.",
                  },
                  ...(licenseScreening
                    ? licenseScreeningReportItems(licenseScreening)
                    : []),
                ]),
            { label: "Community Area", value: topCommunityArea || "Drawn area" },
            ...(permitAnalysis
              ? [
                  {
                    label: "Geocoded Permit Filings",
                    value: String(permitAnalysis.totalFilings),
                    detail: PERMIT_AREA_ACTIVITY_NOTE,
                  },
                ]
              : permitLookupUnavailable
                ? [
                    {
                      label: "Permit Lookup",
                      value: "Unavailable",
                      detail: PERMIT_AREA_LOOKUP_UNAVAILABLE_NOTE,
                    },
                  ]
                : []),
          ],
        },
        ...(zoneItems.length > 0
          ? [
              {
                id: SECTION_IDS.incentiveZonesInArea,
                title: "Incentive Zones in Area",
                description: "Zone coverage among the vacancy signals shown by the selected filters.",
                items: zoneItems,
              },
            ]
          : []),
        ...(ownerItems.length > 0
          ? [
              {
                id: SECTION_IDS.ownershipBreakdown,
                title: "Ownership Breakdown",
                description: "Ownership classification among the displayed vacancy signals.",
                items: ownerItems,
              },
            ]
          : []),
        ...(propertyItems.length > 0
          ? [
              {
                id: SECTION_IDS.priorityProperties,
                title: "Priority Properties",
                description:
                  propertyItems.length < features.length
                    ? `Showing the first ${propertyItems.length} of ${features.length} signals. Export CSV for the full list.`
                    : "Public-record vacancy signals shown by the selected filters.",
                items: propertyItems,
              },
            ]
          : []),
        ...(permitAnalysis
          ? [
              {
                id: SECTION_IDS.permitFilingContext,
                title: "Permit Filing Context",
                description: `${PERMIT_AREA_ACTIVITY_NOTE} ${PERMIT_AREA_COVERAGE_NOTE}`,
                items: [
                  {
                    label: "Total Geocoded Filings",
                    value: String(permitAnalysis.totalFilings),
                  },
                  {
                    label: "Distinct Recorded Addresses",
                    value: String(permitAnalysis.distinctAddresses),
                  },
                  {
                    label: "Source Coverage",
                    value: permitCoverageLabel ?? permitAnalysis.dataWindow,
                  },
                  {
                    label: "Latest Filing in Area Data",
                    value: formatPermitAreaDate(
                      permitAnalysis.issueDateSpan?.latest ?? null,
                    ),
                  },
                  {
                    label: "Active Permit Record Filters",
                    value:
                      permitFilterLabels.length > 0
                        ? permitFilterLabels.join("; ")
                        : "None",
                    detail:
                      "These filters apply only to the recent record-level review. Full-polygon filing totals and aggregate charts remain unchanged.",
                  },
                  ...permitTypeItems,
                ],
              },
              ...(permitRecords.length > 0 || permitFilterLabels.length > 0
                ? [
                    {
                      id: SECTION_IDS.recentPermitRecordsInCurrentView,
                      title: "Recent Permit Records in Current View",
                      description: `${filteredPermitRecords.length} of ${permitRecords.length} recent record${permitRecords.length === 1 ? "" : "s"} match the workstation filters. This report snapshot includes ${permitRecordItems.length}${filteredPermitRecords.length > permitRecordItems.length ? ` of those ${filteredPermitRecords.length}` : ""}; the CSV includes every filtered recent record. Full-polygon permit aggregates above remain based on all ${permitAnalysis.totalFilings} geocoded filings.`,
                      items: permitRecordSnapshotItems,
                    },
                  ]
                : []),
            ]
          : []),
        ...(drawnAreaScope
          ? [
              {
                id: SECTION_IDS.provenanceChain,
                title: "Provenance Chain",
                description:
                  "The saved boundary, source coverage, filters, and generation-time record manifest connect this analysis to its report and CSV outputs.",
                items: [
                  {
                    label: "Selection Method",
                    value: "Point in saved polygon",
                    detail:
                      "Records are selected against the exact drawn GeoJSON polygon; community-area and ward labels are context only.",
                  },
                  {
                    label: "Boundary Fingerprint",
                    value: drawnAreaScope.scope.fingerprint,
                  },
                  {
                    label: "Generation-Time Record Manifest",
                    value: `${drawnAreaScope.provenance.vacancy.selectedCount} record reference${drawnAreaScope.provenance.vacancy.selectedCount === 1 ? "" : "s"}`,
                    detail:
                      "Stable record references are saved with the report so a later polygon refresh can disclose additions or removals.",
                  },
                  {
                    label: "Saved At",
                    value: drawnAreaScope.generatedAt,
                  },
                ],
              },
            ]
          : []),
      ],
      recommendedActions: [
        {
          label: "Export and review the area data",
          // Without an attached analysis the CSV carries no permit-filing rows —
          // only the "Permit coverage" note — so it must not be advertised as if
          // it did.
          description: permitAnalysis
            ? "Use the CSV to compare vacancy, ownership, incentive-zone, and permit-filing records without blending their meanings."
            : "Use the CSV to compare vacancy, ownership, and incentive-zone records without blending their meanings.",
          priority: "high",
        },
        {
          label: "Verify property status",
          description:
            "Vacancy signals can lag real conditions. Confirm status through site visits, assessor records, license records, or local partners.",
          priority: "medium",
        },
        ...(permitAnalysis && permitAnalysis.totalFilings > 0
          ? [
              {
                label: "Verify permit activity",
                description:
                  "Review current permit status and site conditions before treating a filing as active or completed construction.",
                priority: "medium" as const,
              },
            ]
          : []),
        {
          label: "Contact an acquisition or corridor partner",
          description:
            "Use the report to start conversations with CCLBA, DPD, CCSA, or a local business support organization.",
          priority: "medium",
        },
      ],
      metadata: {
        address: reportAreaName,
        projectType: "vacant-acquisition",
      },
      dataSources: [
        {
          id: "chicago-open-data",
          label: "City of Chicago Open Data",
          description: vacancyCoverageNote
            ? `Vacant property and public boundary data. ${vacancyCoverageNote}`
            : "Vacant property and public boundary data.",
          url: "https://data.cityofchicago.org/",
        },
        ...(hasOfficialCclbaPublishedInventory
          ? [
              {
                id: "cook-county-land-bank-inventory",
                label: "Cook County Land Bank Authority Published Property Inventory",
                description:
                  "Published land-bank property inventory retrieved by the Explorer. Publication is not proof of current availability or ownership; review the upstream status and confirm with CCLBA.",
                url: CCLBA_PUBLIC_PORTAL_URL,
              },
            ]
          : []),
        {
          id: "cook-county-assessor",
          label: "Cook County Assessor",
          description: "Property assessment and ownership context.",
          url: "https://www.cookcountyassessor.com/",
        },
        ...(licenseScreening
          ? [
              {
                id: "chicago-business-licenses",
                label: "City of Chicago Business Licenses",
                description: `Exact-address current-license conflict screening was ${licenseScreening.status}. Issued, unexpired matches may indicate current use; no match never establishes that a site is unoccupied.`,
                url: "https://data.cityofchicago.org/Community-Economic-Development/Business-Licenses/r5kz-chrr",
              },
            ]
          : []),
        ...(permitAnalysis
          ? [
              {
                id: "chicago-building-permits",
                label: permitAnalysis.source.label,
                description: `${PERMIT_AREA_ACTIVITY_NOTE} Located records only. ${permitCoverageLabel}.`,
                url: permitAnalysis.source.url,
              },
            ]
          : []),
      ],
    };
  }, [
    areaName,
    allFeatures,
    freshnessFilterLabel,
    features,
    hasOfficialCclbaPublishedInventory,
    drawnAreaScope,
    licenseConflictCount,
    licenseFilterLabel,
    licenseScreening,
    narrative,
    normalizedPractitionerNotes,
    ownerCounts,
    permitAnalysis,
    filteredPermitRecords,
    permitFilterLabels,
    permitRecords.length,
    permitLoadFailed,
    vacancyFilterLabels,
    topCommunityArea,
    vacantBuildingCount,
    vacantLandCount,
    vacancyTypeCounts.other,
    vacancyTypeCounts.storefront,
    vacancyCoverageNote,
    vacancyLoadFailed,
    zoneCounts,
  ]);

  const areaWizardState = useMemo<WizardState>(() => ({
    reportType: "dev-feasibility",
    address: areaName.trim() || topCommunityArea || "Drawn Area",
    lat: null,
    lon: null,
    neighborhood: topCommunityArea || "",
    industry: "",
    budgetRange: "",
    projectType: "",
    projectGoals: [],
    customGoal: "",
    proposedUse: "",
    fundingCommitted: "",
    remainingGap: "",
    timeline: "",
    siteControl: "",
    documentsAvailable: [],
    jobsImpact: "",
    supportNeeded: [],
    creditsToAnalyze: zoneCounts.map(({ key }) => key),
  }), [areaName, topCommunityArea, zoneCounts]);

  const handleSaveReport = useCallback(() => {
    if (!drawnAreaScope || loading || permitPending) return;
    if (status === "authenticated") {
      setSaveModalOpen(true);
      return;
    }

    storePendingReport({ reportData: areaReport, wizardState: areaWizardState });
    window.location.assign(
      `/login?callbackUrl=${encodeURIComponent("/workspace?savePending=1")}`
    );
  }, [areaReport, areaWizardState, drawnAreaScope, loading, permitPending, status]);

  const handleEmailReport = useCallback(() => {
    if (!drawnAreaScope || loading || permitPending) return;
    setEmailModalOpen(true);
  }, [drawnAreaScope, loading, permitPending]);

  const handleDownloadPdf = useCallback(async () => {
    if (!drawnAreaScope || loading || permitPending) return;
    setPdfDownloadFailed(false);
    try {
      const { generateReportPdf } = await import("@/lib/pdf-report");
      generateReportPdf(areaReport);
    } catch (err) {
      console.error("[map panel] area PDF download failed:", err);
      setPdfDownloadFailed(true);
    }
  }, [areaReport, drawnAreaScope, loading, permitPending]);

  /* ── Export CSV ──
     One file with source-separated vacancy, permit, and gated investment
     tables. Applicant-reported permit cost is never part of this export. */
  const handleExportCsv = useCallback(() => {
    if (!drawnAreaScope || loading || permitPending) return;
    const csv = buildDrawnAreaCsv({
      areaName,
      vacancyFeatures: features,
      vacancyReturnedCountBeforeFilters: allFeatures.length,
      vacancyFilterLabels,
      vacancyVisibleCount: features.length,
      vacancyFreshnessFilter: freshnessFilter,
      vacancyLicenseFilter: effectiveLicenseFilter,
      vacancyCoverage,
      vacancyLoadFailed,
      permitArea: permitAnalysis,
      permitRecords: filteredPermitRecords,
      permitRecordsBeforeFilters: permitRecords.length,
      permitFilterLabels,
      permitVisibleCount: filteredPermitRecords.length,
      practitionerNotes: normalizedPractitionerNotes,
      // The export button also renders on vacancy findings alone, so a 503 on
      // the permit lookup can reach this line. Without the flag the file says
      // "Not attached" — mis-describing a lookup that was attempted and failed
      // as one that was never run. Ignored when permitAnalysis is present.
      permitLoadFailed,
      scopeProvenance: drawnAreaScope
        ? {
            fingerprint: drawnAreaScope.scope.fingerprint,
            selectionMethod: "point_in_saved_polygon",
            generatedAt: drawnAreaScope.generatedAt,
            manifestSelectedCount:
              drawnAreaScope.provenance.vacancy.selectedCount,
          }
        : null,
      investment:
        investmentSummary && investmentSelection
          ? { summary: investmentSummary, selected: investmentSelection }
          : null,
    });

    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `area-report-${drawnAreaFilenameSlug(areaName)}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [
    areaName,
    allFeatures.length,
    drawnAreaScope,
    effectiveLicenseFilter,
    features,
    freshnessFilter,
    filteredPermitRecords,
    investmentSelection,
    investmentSummary,
    loading,
    permitAnalysis,
    permitFilterLabels,
    permitLoadFailed,
    permitPending,
    permitRecords.length,
    normalizedPractitionerNotes,
    vacancyCoverage,
    vacancyFilterLabels,
    vacancyLoadFailed,
  ]);

  /** Build report link for a property using its coordinates */
  const buildReportLink = (f: GeoJSON.Feature) => {
    const p = f.properties ?? {};
    const coords = f.geometry.type === "Point" ? (f.geometry as GeoJSON.Point).coordinates : null;
    if (!coords) return "/report";
    return `/report?instant=true&lat=${coords[1].toFixed(5)}&lon=${coords[0].toFixed(5)}&addr=${encodeURIComponent(p.address ?? "")}`;
  };

  return (
    <div
      data-testid="area-analysis-workstation"
      className="absolute inset-0 md:top-3 md:bottom-3 md:left-[28%] md:right-3 z-30 bg-[#FAF9F6] border border-[#0C1B33]/10 shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Mobile drag handle */}
      <div className="md:hidden flex flex-col items-center pt-2 pb-1 bg-white">
        <div className="w-10 h-1 bg-[#0C1B33]/15" />
      </div>

      {/* ── Branded Header ── */}
      <div className="bg-[#0C1B33] px-5 md:px-7 py-4 flex items-start justify-between shrink-0">
        <div>
          <div className="font-mono-bureau text-[9px] tracking-[0.3em] uppercase text-white/35">
            Area Analysis · Practitioner Workstation
          </div>
          <div className="font-editorial text-[24px] md:text-[30px] text-white leading-tight mt-1">
            {areaName.trim() || "Drawn area"}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-bureau text-[9px] tracking-[0.12em] uppercase text-white/50">
            {topCommunityArea && !loading && <span>{topCommunityArea}</span>}
            {!loading && !vacancyLoadFailed && (
              <span>
                {features.length.toLocaleString("en-US")} vacancy{" "}
                {features.length === 1 ? "signal" : "signals"} in view
              </span>
            )}
            {!permitPending && permitAnalysis && (
              <span>{permitAnalysis.totalFilings.toLocaleString("en-US")} permit filings in area</span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="text-white/35 hover:text-white text-[22px] leading-none transition-colors p-2 -mr-2 -mt-2"
          title="Return to map"
          aria-label="Close area analysis"
        >
          &times;
        </button>
      </div>

      {/* Durable work context: label + user-authored notes + explicit edit lifecycle. */}
      <div className="px-5 md:px-7 py-3 bg-white border-b border-[#0C1B33]/8 shrink-0">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.8fr)_minmax(300px,1.4fr)_auto] lg:items-end">
          <label className="block">
            <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/40">
              Search label
            </span>
            <input
              id="drawn-area-name"
              aria-label="Area Name"
              type="text"
              value={areaName}
              onChange={(event) => updateAreaName(event.target.value)}
              placeholder={defaultDrawnAreaName()}
              maxLength={120}
              className="mt-1 w-full border border-[#0C1B33]/12 px-3 py-2 text-[16px] md:text-[12px] text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/35 focus-visible:border-[#2563EB]"
            />
          </label>
          <label className="block">
            <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/40">
              Practitioner notes · optional
            </span>
            <textarea
              aria-label="Practitioner notes"
              value={practitionerNotes}
              onChange={(event) => updatePractitionerNotes(event.target.value)}
              maxLength={AREA_ANALYSIS_PRACTITIONER_NOTES_MAX_LENGTH}
              rows={2}
              placeholder="Add context for your review or handoff. Notes stay separate from source evidence."
              className="mt-1 w-full resize-none border border-[#0C1B33]/12 px-3 py-2 text-[16px] md:text-[12px] leading-relaxed text-[#0C1B33] placeholder:text-[#0C1B33]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/35 focus-visible:border-[#2563EB]"
            />
          </label>
          <div className="flex items-center justify-end gap-1">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={onEditCancel}
                  className="min-h-11 min-w-11 px-3 font-mono-bureau text-[10px] tracking-[0.12em] uppercase text-[#0C1B33]/55 hover:text-[#0C1B33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50"
                >
                  Cancel
                </button>
                <button
                  ref={editDoneButtonRef}
                  type="button"
                  onClick={onEditDone}
                  className="min-h-11 min-w-11 px-3 font-mono-bureau text-[10px] tracking-[0.12em] uppercase text-white bg-[#2563EB] hover:bg-[#1d4ed8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                {onEdit && (
                  <button
                    ref={editButtonRef}
                    type="button"
                    onClick={onEdit}
                    disabled={loading || !polygon}
                    className="min-h-11 min-w-11 px-3 font-mono-bureau text-[10px] tracking-[0.12em] uppercase text-[#2563EB] hover:text-[#1d4ed8] disabled:text-[#0C1B33]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50"
                  >
                    Edit area
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClear}
                  className="min-h-11 px-3 font-mono-bureau text-[10px] tracking-[0.12em] uppercase text-[#2563EB] hover:text-[#1d4ed8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50"
                >
                    Clear &amp; Redraw
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[8px] leading-snug text-[#0C1B33]/40">
            <span>Label, filters, and notes stay in place if you return to the map.</span>
            <span>
              {practitionerNotes.length.toLocaleString("en-US")} / {AREA_ANALYSIS_PRACTITIONER_NOTES_MAX_LENGTH.toLocaleString("en-US")} characters · User-authored, not source evidence
            </span>
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {editing
              ? `Area editing mode. ${editDirty ? "Boundary changed. Choose Done to refresh the analysis or Cancel to restore it." : "Move the boundary, then choose Done to refresh the analysis or Cancel to restore it."}`
              : "Area boundary locked. Dragging the map will pan without moving the analyzed area."}
          </p>
        </div>

      <nav
        aria-label="Area evidence"
        className="shrink-0 overflow-x-auto border-b border-[#0C1B33]/10 bg-[#F8FAFC] px-3 md:px-5"
      >
        <div className="flex min-w-max items-stretch">
          {AREA_ANALYSIS_EVIDENCE_FAMILIES.filter(
            (family) => family.id !== "investment" || adminSessionActive,
          ).map((family) => {
            const count =
              family.id === "vacancy"
                ? features.length
                : family.id === "permits"
                  ? permitAnalysis?.totalFilings
                  : family.id === "investment"
                    ? investmentSelection?.length
                    : undefined;
            return (
              <button
                key={family.id}
                type="button"
                aria-current={activeEvidenceFamily === family.id ? "page" : undefined}
                onClick={() => updateActiveEvidenceFamily(family.id)}
                className={`border-b-2 px-3 py-3 font-mono-bureau text-[9px] tracking-[0.14em] uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563EB]/40 ${
                  activeEvidenceFamily === family.id
                    ? "border-[#2563EB] bg-white text-[#0C1B33]"
                    : "border-transparent text-[#0C1B33]/45 hover:text-[#0C1B33]"
                }`}
              >
                {family.label}
                {typeof count === "number" && (
                  <span className="ml-1.5 text-[#2563EB]">
                    {count.toLocaleString("en-US")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#FAF9F6]">

      {editing && (
        <div className="px-5 py-3 bg-[#EFF6FF] border-b border-[#2563EB]/15" role="status">
          <div className="font-mono-bureau text-[9px] tracking-[0.18em] uppercase text-[#2563EB]">
            Editing area
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-[#0C1B33]/60">
            Move vertices or the boundary. Choose Done to run a new analysis, or Cancel to keep the current boundary and results.
          </p>
        </div>
      )}

      {/* ── Loading state ── */}
      {loading && (
        <div
          ref={loadingStatusRef}
          tabIndex={-1}
          role="status"
          className="px-5 py-10 flex flex-col items-center gap-3 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563EB]/40"
        >
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="block w-2 h-2 bg-[#2563EB] rounded-full"
                style={{ animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite` }}
              />
            ))}
          </div>
          <span className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/40">
            Analyzing area...
          </span>
        </div>
      )}

      {/* ── Results ── */}
      {!loading && !editing && (
        <>
          {/* ── Empty state ── */}
          {features.length === 0 && (
            <div className={`${activeEvidenceFamily === "overview" ? "" : "hidden"} px-5 md:px-7 py-10 text-center bg-white`}>
              <div className="font-editorial text-[18px] text-[#0C1B33]/45 mb-2">
                {vacancyLoadFailed
                  ? "Vacancy records unavailable"
                  : vacancyCoverageIncomplete
                    ? "Partial vacancy records"
                    : allFeatures.length > 0
                      ? "No vacancy signals match these filters"
                      : "No tracked vacancy signals returned"}
              </div>
              <div className="text-[11px] text-[#0C1B33]/40">
                {vacancyCoverageNote ??
                  (allFeatures.length > 0
                    ? "Adjust the evidence filters to review older, undated, or non-conflict records."
                    : "A successful zero means no tracked signals were returned; it does not establish that every property is occupied. Permit or investment records may still appear below.")}
              </div>
              {vacancyCoverageNote && (
                <div className="text-[10px] text-[#0C1B33]/35 mt-2">
                  Permit or investment records may still appear below for this area.
                </div>
              )}
            </div>
          )}

          {features.length > 0 && vacancyCoverageNote && (
            <div className={`${activeEvidenceFamily === "overview" ? "" : "hidden"} px-5 md:px-7 py-3 bg-[#FFF7ED] border-b border-[#9A3412]/10`}>
              <div className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#9A3412]/65 mb-1">
                Vacancy coverage
              </div>
              <p className="text-[10px] text-[#0C1B33]/55 leading-relaxed">
                {vacancyCoverageNote}
              </p>
            </div>
          )}

          {allFeatures.length > 0 && (
            <div className={`${activeEvidenceFamily === "vacancy" ? "" : "hidden"} px-5 md:px-7 py-5 bg-[#F8FAFC] border-b border-[#0C1B33]/8`}>
              <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
                <div>
                  <div className="font-mono-bureau text-[9px] tracking-[0.22em] uppercase text-[#0C1B33]/45">
                    Filter returned vacancy evidence
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-[#0C1B33]/45">
                    Search and facets narrow the {allFeatures.length.toLocaleString("en-US")} records returned for this boundary. They do not expand upstream source coverage.
                  </p>
                </div>
                {vacancyFiltersAreRefined && (
                  <button
                    type="button"
                    onClick={() =>
                      updateVacancyFilters({
                        ...DEFAULT_AREA_VACANCY_WORKSTATION_FILTERS,
                        freshness: "current_screening",
                      })
                    }
                    className="inline-flex min-h-10 items-center gap-1.5 border border-[#0C1B33]/12 bg-white px-3 font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/55 hover:text-[#0C1B33]"
                  >
                    <RotateCcw className="h-3 w-3" /> Reset filters
                  </button>
                )}
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <label className="relative block md:col-span-2 xl:col-span-4">
                  <span className="sr-only">Search vacancy records</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#0C1B33]/30" />
                  <input
                    type="search"
                    value={vacancyFilters.query}
                    onChange={(event) =>
                      updateVacancyFilters({ ...vacancyFilters, query: event.target.value })
                    }
                    placeholder="Search address, PIN, owner, source, status, or zone"
                    className="w-full border border-[#0C1B33]/15 bg-white py-2.5 pl-9 pr-3 text-[16px] text-[#0C1B33] placeholder:text-[#0C1B33]/30 md:text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                  />
                </label>
                <label className="block">
                  <span className="sr-only">Vacancy evidence timeframe</span>
                  <select
                    value={freshnessFilter}
                    onChange={(event) =>
                      updateVacancyFilters({
                        ...vacancyFilters,
                        freshness:
                          event.target.value === "all_records"
                            ? "all"
                            : (event.target.value as AreaVacancyWorkstationFilters["freshness"]),
                      })
                    }
                    className="w-full border border-[#0C1B33]/15 bg-white px-2.5 py-2.5 text-[16px] md:text-[11px] text-[#0C1B33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                  >
                    <option value="current_screening">Current inventory + recent reports</option>
                    <option value="recent_reports">Recent reports only</option>
                    <option value="all_records">All retained records</option>
                  </select>
                </label>
                <label className="block">
                  <span className="sr-only">Current-license conflict filter</span>
                  <select
                    value={effectiveLicenseFilter}
                    onChange={(event) =>
                      updateVacancyFilters({
                        ...vacancyFilters,
                        licenseConflict: event.target.value as VacancyLicenseFilter,
                      })
                    }
                    disabled={!licenseFilterAvailable}
                    className="w-full border border-[#0C1B33]/15 bg-white px-2.5 py-2.5 text-[16px] md:text-[11px] text-[#0C1B33] disabled:text-[#0C1B33]/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                  >
                    {vacancyFacetOptions.licenseConflicts.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} ({option.count})
                      </option>
                    ))}
                  </select>
                </label>
                {[
                  ["Vacancy type filter", "canonicalType", vacancyFacetOptions.canonicalTypes],
                  ["Owner type filter", "ownerType", vacancyFacetOptions.ownerTypes],
                  ["Incentive zone filter", "zoneKey", vacancyFacetOptions.zoneKeys],
                  ["Vacancy source filter", "source", vacancyFacetOptions.sources],
                ].map(([label, key, options]) => (
                  <label key={String(key)} className="block">
                    <span className="sr-only">{String(label)}</span>
                    <select
                      value={String(vacancyFilters[key as keyof AreaVacancyWorkstationFilters])}
                      onChange={(event) =>
                        updateVacancyFilters({
                          ...vacancyFilters,
                          [String(key)]: event.target.value,
                        })
                      }
                      className="w-full border border-[#0C1B33]/15 bg-white px-2.5 py-2.5 text-[16px] md:text-[11px] text-[#0C1B33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                    >
                      {(options as typeof vacancyFacetOptions.canonicalTypes).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} ({option.count})
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="mt-2 text-[9px] leading-relaxed text-[#0C1B33]/45">
                Showing {features.length.toLocaleString("en-US")} of {allFeatures.length.toLocaleString("en-US")} returned signals.
                {vacancyCoverage?.freshness
                  ? ` Source dates: ${vacancyCoverage.freshness.returnedCounts.recent} recent, ${vacancyCoverage.freshness.returnedCounts.stale} older, ${vacancyCoverage.freshness.returnedCounts.unknownDate} unknown. Retention policy: each sync requests the latest ${vacancyCoverage.freshness.retainedWithinYears} years of 311 records; using today’s policy reference, that window would begin ${vacancyCoverage.freshness.retentionPolicyCutoffDate.slice(0, 10)}. The exact last-sync cutoff is not persisted.`
                  : ""}
              </div>
              {licenseScreening && (
                <div
                  className={`mt-2 border-l-2 pl-2 text-[9px] leading-relaxed ${
                    licenseScreening.status === "available"
                      ? "border-[#059669]/30 text-[#0C1B33]/45"
                      : "border-[#D97706]/40 text-[#0C1B33]/55"
                  }`}
                >
                  License screening: {licenseScreening.status}. Checked {licenseScreening.checkedCount.toLocaleString("en-US")} of {licenseScreening.candidateCount.toLocaleString("en-US")} exact published addresses; {licenseScreening.matchedPropertyCount.toLocaleString("en-US")} returned signal{licenseScreening.matchedPropertyCount === 1 ? " has" : "s have"} an issued, unexpired license match. Address cap {licenseScreening.addressCap.toLocaleString("en-US")}; capped {licenseScreening.capped ? "yes" : "no"}; {licenseScreening.sourceCallCount} bounded source calls; root address groups {licenseScreening.successfulBatches} complete and {licenseScreening.failedBatches} incomplete. Partial reasons: {licensePartialReasonSummary}. {licenseMalformedRowCount > 0 ? `${licenseMalformedRowCount.toLocaleString("en-US")} malformed or policy-ineligible source rows were ignored. ` : ""}A match is a conflict signal, not proof of occupancy; no match is not proof a site is unoccupied.
                </div>
              )}
            </div>
          )}

          {allFeatures.length > 0 && features.length === 0 && (
            <div
              data-testid="vacancy-filter-empty-state"
              className={`${activeEvidenceFamily === "vacancy" ? "" : "hidden"} border-b border-[#0C1B33]/8 bg-white px-5 py-8 text-center md:px-7`}
            >
              <div className="font-editorial text-[18px] text-[#0C1B33]/55">
                No vacancy signals match these filters
              </div>
              <p className="mx-auto mt-2 max-w-xl text-[11px] leading-relaxed text-[#0C1B33]/45">
                The boundary returned {allFeatures.length.toLocaleString("en-US")} tracked signal{allFeatures.length === 1 ? "" : "s"}, but none match the current evidence view. Reset or adjust the filters to inspect them. You can still export this zero-match view with its label, notes, and active filters intact.
              </p>
            </div>
          )}

          {vacancyLoadFailed && (
            <div
              data-testid="vacancy-unavailable-state"
              className={`${activeEvidenceFamily === "vacancy" ? "" : "hidden"} border-b border-[#9A3412]/10 bg-[#FFF7ED] px-5 py-8 text-center md:px-7`}
            >
              <div className="font-editorial text-[18px] text-[#0C1B33]/60">
                Vacancy lookup unavailable
              </div>
              <p className="mx-auto mt-2 max-w-xl text-[11px] leading-relaxed text-[#0C1B33]/50">
                {VACANCY_LOOKUP_UNAVAILABLE_NOTE} Permit and public-investment evidence may still be available in their own tabs.
              </p>
            </div>
          )}

          {!vacancyLoadFailed && vacancyCoverageIncomplete && (
            <div
              data-testid="vacancy-partial-state"
              className={`${activeEvidenceFamily === "vacancy" ? "" : "hidden"} border-b border-[#D97706]/15 bg-[#FFF7ED] px-5 py-5 md:px-7`}
            >
              <div className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#9A3412]/70">
                Partial vacancy source coverage
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/50">
                {vacancyCoverageNote || "The vacancy lookup completed with incomplete source coverage."} Review any returned records as a partial view. An empty or missing row is not evidence that no tracked vacancy exists.
              </p>
            </div>
          )}

          {!vacancyLoadFailed && !vacancyCoverageIncomplete && allFeatures.length === 0 && (
            <div
              data-testid="vacancy-clean-zero-state"
              className={`${activeEvidenceFamily === "vacancy" ? "" : "hidden"} border-b border-[#0C1B33]/8 bg-white px-5 py-8 text-center md:px-7`}
            >
              <div className="font-editorial text-[18px] text-[#0C1B33]/55">
                No tracked vacancy signals returned
              </div>
              <p className="mx-auto mt-2 max-w-xl text-[11px] leading-relaxed text-[#0C1B33]/45">
                The vacancy lookup completed successfully with zero returned signals for this boundary. This does not establish that every property is occupied or available. Verify current conditions through the linked public sources.
              </p>
              {vacancyCoverageNote && (
                <p className="mx-auto mt-2 max-w-xl text-[9px] leading-relaxed text-[#0C1B33]/40">
                  {vacancyCoverageNote}
                </p>
              )}
            </div>
          )}

          {/* ── Narrative Summary ── */}
          {features.length > 0 && narrative && (
            <div className={`${activeEvidenceFamily === "overview" ? "" : "hidden"} px-5 md:px-7 pt-5 pb-4 bg-white border-b border-[#0C1B33]/8`}>
              <div className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/25 mb-2">
                Executive Snapshot
              </div>
              <p className="text-[13px] text-[#0C1B33]/60 leading-relaxed">
                {narrative}
              </p>
            </div>
          )}

          {/* ── At a Glance ── */}
          {features.length > 0 && (
            <div className={`${activeEvidenceFamily === "overview" ? "" : "hidden"} px-5 md:px-7 py-4 bg-white`}>
              <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-3">
                At a Glance
              </div>
              <div className="grid grid-cols-2 gap-px bg-[#0C1B33]/8 border border-[#0C1B33]/8">
                {[
                  {
                    label: "Signals shown",
                    value: features.length,
                  },
                  {
                    label: "Land",
                    value: vacantLandCount,
                  },
                  {
                    label: "Buildings",
                    value: vacantBuildingCount,
                  },
                  { label: "Storefronts", value: vacancyTypeCounts.storefront },
                  { label: "Other", value: vacancyTypeCounts.other },
                  { label: "License conflicts", value: licenseConflictCount },
                ].map((stat) => (
                  <div key={stat.label} className="bg-[#FAF9F6] px-3 py-3 text-center">
                    <div className="font-editorial text-[22px] leading-none text-[#0C1B33]">
                      {stat.value}
                    </div>
                    <div className="font-mono-bureau text-[7px] tracking-[0.18em] uppercase text-[#0C1B33]/35 mt-2">
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
              {zoneCounts.length > 0 && (
                <div className="mt-2 flex items-center justify-between text-[10px] px-1">
                  <span className="text-[#0C1B33]/40">Zone matches among signals shown</span>
                  <span className="font-mono-bureau font-medium text-[#059669]">{zoneCounts.length}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Zone Breakdown ── */}
          {zoneCounts.length > 0 && (
            <>
              <div className={`${activeEvidenceFamily === "context" ? "" : "hidden"} mx-5 md:mx-7 h-px bg-[#0C1B33]/8`} />
              <div className={`${activeEvidenceFamily === "context" ? "" : "hidden"} px-5 md:px-7 py-4 bg-white`}>
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#059669]/50 mb-1.5">
                  Incentive Zones in Area
                </div>
                <div className="text-[9px] text-[#0C1B33]/35 mb-2">
                  Displayed vacancy signals with a published zone match. This is not an independent measure of polygon-wide zone coverage.
                </div>
                <div className="space-y-1.5">
                  {zoneCounts.map(({ key, count }) => {
                    const pct = features.length > 0 ? Math.round((count / features.length) * 100) : 0;
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between text-[10px] mb-0.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                              style={{ backgroundColor: ZONE_COLORS[key] ?? "#9CA3AF" }}
                            />
                            <span className="text-[#0C1B33]/70 truncate">
                              {ZONE_LABELS[key] ?? key}
                            </span>
                          </div>
                          <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0 ml-2">
                            {count}
                          </span>
                        </div>
                        <div className="h-1 bg-[#0C1B33]/5 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: ZONE_COLORS[key] ?? "#9CA3AF",
                              opacity: 0.6,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ── Ownership Breakdown ── */}
          {ownerCounts.length > 0 && (
            <>
              <div className={`${activeEvidenceFamily === "context" ? "" : "hidden"} mx-5 md:mx-7 h-px bg-[#0C1B33]/8`} />
              <div className={`${activeEvidenceFamily === "context" ? "" : "hidden"} px-5 md:px-7 py-4 bg-white`}>
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#7C3AED]/50 mb-2">
                  Ownership Breakdown
                </div>
                <p className="mb-3 text-[9px] leading-relaxed text-[#0C1B33]/40">
                  Ownership classifications among the displayed vacancy signals, not a complete ownership inventory for every parcel inside the boundary.
                </p>
                <div className="space-y-1.5">
                  {ownerCounts.map(({ key, count }) => {
                    const color = OWNER_TYPE_COLORS[key] ?? "#9CA3AF";
                    const pct = features.length > 0 ? Math.round((count / features.length) * 100) : 0;
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between text-[10px]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block text-[9px] font-medium px-2 py-0.5 rounded shrink-0"
                            style={{
                              backgroundColor: color + "15",
                              color,
                              border: `1px solid ${color}30`,
                            }}
                          >
                            {OWNER_TYPE_LABELS[key] ?? key}
                          </span>
                          <span className="text-[9px] text-[#0C1B33]/30">{pct}%</span>
                        </div>
                        <span className="font-mono-bureau text-[#0C1B33]/80 ml-2">
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {activeEvidenceFamily === "context" &&
            zoneCounts.length === 0 &&
            ownerCounts.length === 0 && (
              <section
                data-testid="area-context-empty-state"
                className="border-y border-[#0C1B33]/8 bg-white px-5 py-10 text-center md:px-7"
              >
                <p className="font-mono-bureau text-[9px] uppercase tracking-[0.22em] text-[#2563EB]">
                  Area context
                </p>
                <h2 className="mt-2 font-editorial text-[22px] text-[#0C1B33]">
                  No mapped context is visible in this view
                </h2>
                <p className="mx-auto mt-2 max-w-xl text-[11px] leading-relaxed text-[#0C1B33]/50">
                  {vacancyLoadFailed
                    ? "The vacancy lookup is unavailable, so ownership and incentive-zone context cannot be derived from the returned records. This is a source failure, not evidence that the area has no owners or incentive zones."
                    : allFeatures.length > 0
                      ? "The current vacancy filters leave no records with ownership or incentive-zone context. Reset or adjust the vacancy filters to inspect the returned source records."
                      : "No returned vacancy record carries ownership or incentive-zone context for this boundary. This does not establish that the area has no owners or incentive zones; verify the official parcel and program sources before acting."}
                </p>
              </section>
            )}

          {/* Public permit-filing analysis for the exact drawn polygon. */}
          {(permitPending || permitAnalysis || permitLoadFailed) && (
            <>
              <div className={`${activeEvidenceFamily === "permits" ? "" : "hidden"} mx-5 md:mx-7 h-px bg-[#0C1B33]/8`} />
              <div className={`${activeEvidenceFamily === "permits" ? "" : "hidden"} px-5 md:px-7 py-5 bg-white`}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#7C3AED]/60">
                    {PERMIT_AREA_HEADING}
                  </div>
                  <span className="font-mono-bureau text-[7px] tracking-[0.18em] uppercase text-[#0C1B33]/30 shrink-0 ml-2">
                    Public record
                  </span>
                </div>

                {permitPending && !permitAnalysis && (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-3 h-3 animate-spin text-[#7C3AED]/50" />
                    <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/35">
                      Loading permit filings…
                    </span>
                  </div>
                )}

                {permitLoadFailed && !permitAnalysis && (
                  <div className="border-l-2 border-[#DC2626]/30 pl-3 py-1">
                    <p className="text-[10px] text-[#0C1B33]/55 leading-relaxed">
                      Permit filings could not be checked right now. This is a lookup failure,
                      not evidence that the area has no permits.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (!permitRequestKey) return;
                        setPermitLookup({
                          key: permitRequestKey,
                          status: "loading",
                          result: null,
                        });
                        setPermitRetryNonce((value) => value + 1);
                      }}
                      className="mt-2 font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#2563EB] hover:text-[#1D4ED8]"
                    >
                      Retry permit lookup
                    </button>
                  </div>
                )}

                {permitAnalysis && (
                  <>
                    <p className="text-[9px] text-[#0C1B33]/50 leading-snug">
                      {PERMIT_AREA_ACTIVITY_NOTE}
                    </p>
                    <p className="text-[8px] text-[#0C1B33]/35 leading-snug mt-1 mb-3">
                      {PERMIT_AREA_COVERAGE_NOTE}
                    </p>
                    <div className="font-mono-bureau text-[8px] tracking-[0.08em] uppercase text-[#0C1B33]/45 mb-3">
                      {formatPermitAreaCoverageLabel(permitAnalysis)}
                    </div>

                    {permitRecords.length > 0 && (
                      <div className="mb-4 border border-[#0C1B33]/10 bg-[#F8FAFC] p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-mono-bureau text-[8px] tracking-[0.18em] uppercase text-[#0C1B33]/45">
                              Filter recent record ledger
                            </div>
                            <p className="mt-1 text-[8px] leading-relaxed text-[#0C1B33]/40">
                              These controls apply only to the {permitRecords.length.toLocaleString("en-US")} recent detailed records returned for review. The {permitAnalysis.totalFilings.toLocaleString("en-US")} full-polygon filing total and aggregate charts do not change.
                            </p>
                          </div>
                          {hasActiveAreaPermitFilters(permitFilters) && (
                            <button
                              type="button"
                              onClick={() => updatePermitFilters({ ...DEFAULT_AREA_PERMIT_WORKSTATION_FILTERS })}
                              className="inline-flex min-h-9 items-center gap-1 border border-[#0C1B33]/12 bg-white px-2.5 font-mono-bureau text-[8px] tracking-[0.12em] uppercase text-[#0C1B33]/55"
                            >
                              <RotateCcw className="h-3 w-3" /> Reset
                            </button>
                          )}
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                          <label className="relative block md:col-span-2 xl:col-span-4">
                            <span className="sr-only">Search permit records</span>
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#0C1B33]/30" />
                            <input
                              type="search"
                              value={permitFilters.query}
                              onChange={(event) => updatePermitFilters({ ...permitFilters, query: event.target.value })}
                              placeholder="Search permit number, address, type, status, or work description"
                              className="w-full border border-[#0C1B33]/15 bg-white py-2.5 pl-9 pr-3 text-[16px] md:text-[11px] text-[#0C1B33] placeholder:text-[#0C1B33]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                            />
                          </label>
                          {[
                            ["Permit type filter", "type", permitFacetOptions.types],
                            ["Permit status filter", "status", permitFacetOptions.statuses],
                            ["Permit issue year filter", "issueYear", permitFacetOptions.issueYears],
                          ].map(([label, key, options]) => (
                            <label key={String(key)} className="block">
                              <span className="sr-only">{String(label)}</span>
                              <select
                                value={String(permitFilters[key as keyof AreaPermitWorkstationFilters])}
                                onChange={(event) =>
                                  updatePermitFilters({
                                    ...permitFilters,
                                    [String(key)]: event.target.value,
                                  })
                                }
                                className="w-full border border-[#0C1B33]/15 bg-white px-2.5 py-2.5 text-[16px] md:text-[11px] text-[#0C1B33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                              >
                                {(options as typeof permitFacetOptions.types).map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label} ({option.count})
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                        <p className="mt-2 font-mono-bureau text-[8px] tracking-[0.08em] uppercase text-[#0C1B33]/45">
                          {filteredPermitRecords.length.toLocaleString("en-US")} of {permitRecords.length.toLocaleString("en-US")} recent records in view
                        </p>
                      </div>
                    )}

                    {permitAnalysis.totalFilings === 0 ? (
                      <p className="text-[11px] text-[#0C1B33]/45 leading-relaxed">
                        No geocoded permit filings fall inside this shape in the published data
                        window. Unlocated records cannot be tested against a drawn area.
                      </p>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-px bg-[#0C1B33]/8 border border-[#0C1B33]/8">
                          {[
                            { label: "Filings", value: permitAnalysis.totalFilings },
                            { label: "Addresses", value: permitAnalysis.distinctAddresses },
                            { label: "Types", value: permitAnalysis.typeBreakdown.length },
                          ].map((stat) => (
                            <div key={stat.label} className="bg-[#FAF9F6] px-2 py-3 text-center">
                              <div className="font-editorial text-[20px] leading-none text-[#0C1B33]">
                                {stat.value.toLocaleString("en-US")}
                              </div>
                              <div className="font-mono-bureau text-[7px] tracking-[0.14em] uppercase text-[#0C1B33]/35 mt-2">
                                {stat.label}
                              </div>
                            </div>
                          ))}
                        </div>

                        {permitAnalysis.issueDateSpan && (
                          <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[9px]">
                            <span className="text-[#0C1B33]/40">Latest filing in area data</span>
                            <span className="font-mono-bureau text-[#0C1B33]/65 text-right">
                              {formatPermitAreaDate(permitAnalysis.issueDateSpan.latest)}
                            </span>
                          </div>
                        )}

                        {permitAnalysis.typeBreakdown.length > 0 && (
                          <div className="mt-4">
                            <div className="font-mono-bureau text-[8px] tracking-[0.22em] uppercase text-[#0C1B33]/30 mb-2">
                              Filing types
                            </div>
                            <div className="space-y-2">
                              {permitAnalysis.typeBreakdown.slice(0, 6).map((row) => (
                                <div key={row.sourceValue ?? row.label}>
                                  <div className="flex items-center justify-between gap-2 text-[9px] mb-1">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{ backgroundColor: row.color }}
                                      />
                                      <span className="text-[#0C1B33]/65 truncate">{row.label}</span>
                                    </div>
                                    <span className="font-mono-bureau text-[#0C1B33]/60 shrink-0">
                                      {row.count.toLocaleString("en-US")}
                                    </span>
                                  </div>
                                  <div className="h-1 bg-[#0C1B33]/5 overflow-hidden">
                                    <div
                                      className="h-full"
                                      style={{
                                        width: `${Math.max(2, (row.count / maxPermitTypeCount) * 100)}%`,
                                        backgroundColor: row.color,
                                        opacity: 0.65,
                                      }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                            {permitAnalysis.typeBreakdown.length > 6 && (
                              <div className="text-[8px] text-[#0C1B33]/30 mt-2">
                                {permitAnalysis.typeBreakdown.length - 6} additional source
                                categor{permitAnalysis.typeBreakdown.length - 6 === 1 ? "y" : "ies"}
                                in the CSV.
                              </div>
                            )}
                          </div>
                        )}

                        {recentPermitYears.length > 0 && (
                          <div className="mt-4">
                            <div className="font-mono-bureau text-[8px] tracking-[0.22em] uppercase text-[#0C1B33]/30 mb-2">
                              Recent filing years
                            </div>
                            <div className="space-y-1.5">
                              {recentPermitYears.map((row) => (
                                <div key={row.year} className="grid grid-cols-[34px_1fr_36px] items-center gap-2">
                                  <span className="font-mono-bureau text-[8px] text-[#0C1B33]/45">
                                    {row.year}
                                  </span>
                                  <div className="h-1.5 bg-[#0C1B33]/5 overflow-hidden">
                                    <div
                                      className="h-full bg-[#7C3AED]/55"
                                      style={{ width: `${(row.count / maxRecentPermitYearCount) * 100}%` }}
                                    />
                                  </div>
                                  <span className="font-mono-bureau text-[8px] text-[#0C1B33]/45 text-right">
                                    {row.count.toLocaleString("en-US")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {permitAnalysis.statusBreakdown.length > 0 && (
                          <details className="mt-4 border-t border-[#0C1B33]/8 pt-3">
                            <summary className="cursor-pointer font-mono-bureau text-[8px] tracking-[0.18em] uppercase text-[#0C1B33]/45">
                              Recorded statuses · {permitAnalysis.statusBreakdown.length}
                            </summary>
                            <div className="mt-2 space-y-1.5">
                              {permitAnalysis.statusBreakdown.map((row) => (
                                <div key={row.status} className="flex items-center justify-between gap-2 text-[9px]">
                                  <span className="text-[#0C1B33]/55 truncate">{row.status}</span>
                                  <span className="font-mono-bureau text-[#0C1B33]/45 shrink-0">
                                    {row.count.toLocaleString("en-US")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}

                        {permitRecords.length > 0 && (
                          <details className="mt-3 border-t border-[#0C1B33]/8 pt-3">
                            <summary className="cursor-pointer font-mono-bureau text-[8px] tracking-[0.18em] uppercase text-[#0C1B33]/45">
                              Recent filing records · {Math.min(25, filteredPermitRecords.length)} of {permitRecords.length} in view
                            </summary>
                            <div className="mt-3 space-y-3">
                              {filteredPermitRecords.slice(0, 25).map((record) => (
                                <div key={record.permitId} className="border-l-2 border-[#7C3AED]/25 pl-3">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-[10px] font-medium text-[#0C1B33]/70 truncate">
                                      {record.address ?? "Address not recorded"}
                                    </span>
                                    <span className="font-mono-bureau text-[8px] text-[#0C1B33]/35 shrink-0">
                                      {formatPermitAreaDate(record.issueDate)}
                                    </span>
                                  </div>
                                  <div className="text-[9px] text-[#0C1B33]/45 mt-0.5">
                                    {record.permitTypeLabel}
                                    {record.permitStatus ? ` · ${record.permitStatus}` : ""}
                                  </div>
                                  {record.workDescription && (
                                    <p className="text-[8px] text-[#0C1B33]/35 leading-snug mt-1 line-clamp-2">
                                      {record.workDescription}
                                    </p>
                                  )}
                                </div>
                              ))}
                              {filteredPermitRecords.length === 0 && (
                                <p className="text-[9px] leading-relaxed text-[#0C1B33]/45">
                                  No recent permit records match the current record-level filters. Full-polygon aggregates remain visible above.
                                </p>
                              )}
                            </div>
                            {permitAnalysis.recordsTruncated && (
                              <p className="text-[8px] text-[#0C1B33]/30 leading-snug mt-2">
                                The API returned the {permitAnalysis.recordsReturned} most recent
                                record{permitAnalysis.recordsReturned === 1 ? "" : "s"} of {permitAnalysis.totalFilings.toLocaleString("en-US")} total
                                filings. Aggregate counts use the full selected set.
                              </p>
                            )}
                          </details>
                        )}
                      </>
                    )}

                    <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[8px]">
                      <a
                        href={permitAnalysis.source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#2563EB] hover:underline"
                      >
                        Dataset source ↗
                      </a>
                      <a
                        href={permitAnalysis.source.portalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#2563EB] hover:underline"
                      >
                        Verify permit records ↗
                      </a>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* ── ADMIN — Community investment in this area ──
               Gated on the /api/owner-file/session probe. An authenticated admin
               sees a ready, loading, or failed state; a non-admin sees none of
               this heading, status, data, or CSV content. */}
          {adminSessionActive && !!polygon && (
            <>
              <div className={`${activeEvidenceFamily === "investment" ? "" : "hidden"} mx-5 md:mx-7 h-px bg-[#0C1B33]/8`} />
              <div className={`${activeEvidenceFamily === "investment" ? "" : "hidden"} px-5 md:px-7 py-5 bg-white`}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0E7490]/60">
                    {POLYGON_INVESTMENT_HEADING}
                  </div>
                  <span className="font-mono-bureau text-[7px] tracking-[0.18em] uppercase text-[#0E7490]/40 shrink-0 ml-2">
                    Admin
                  </span>
                </div>

                {investmentPending && !investmentSummary && (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-3 h-3 animate-spin text-[#0E7490]/50" />
                    <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/35">
                      Loading investment records…
                    </span>
                  </div>
                )}

                {investmentUnavailable && (
                  <div
                    data-testid="investment-unavailable-state"
                    className="border border-[#9A3412]/15 bg-[#FFF7ED] px-4 py-4"
                    role="status"
                  >
                    <div className="font-editorial text-[17px] text-[#0C1B33]/65">
                      {investmentUnauthorized
                        ? "Public investment access unavailable"
                        : "Public investment lookup unavailable"}
                    </div>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-[#0C1B33]/50">
                      {investmentUnauthorized
                        ? "The gated data request could not be authorized. This is an access failure, not a zero result. Refresh your signed-in session before relying on this evidence family."
                        : "The public investment lookup did not complete. This is a source failure, not evidence that the area has no sited investment records. Vacancy and permit evidence remain available in their own tabs."}
                    </p>
                  </div>
                )}

                {investmentSummary && (
                  <>
                    <p className="text-[9px] text-[#0C1B33]/40 leading-snug mb-3">
                      {POLYGON_INVESTMENT_NO_TOTAL_NOTE}
                    </p>

                    {investmentMoneyBuckets.length === 0 ? (
                      <div data-testid="investment-clean-zero-state">
                        <div className="font-editorial text-[17px] text-[#0C1B33]/60">
                          No sited investment records returned
                        </div>
                        <p className="mt-1.5 text-[11px] text-[#0C1B33]/45 leading-relaxed">
                          The lookup completed successfully. {POLYGON_INVESTMENT_EMPTY_NOTE} This does not establish that no public or private investment has occurred inside the boundary.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-px bg-[#0C1B33]/8 border border-[#0C1B33]/8">
                        {investmentMoneyBuckets.map((bucket) => (
                          <div key={bucket.key} className="bg-[#FAF9F6] px-3 py-2.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-mono-bureau text-[7px] tracking-[0.18em] uppercase text-[#0C1B33]/35">
                                  {bucket.label}
                                </div>
                                <div className="text-[10px] text-[#0C1B33]/70 mt-0.5">
                                  {bucket.noun}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-editorial text-[16px] leading-none text-[#0C1B33]">
                                  {bucket.key === "other"
                                    ? "—"
                                    : formatPolygonInvestmentAmount(bucket.total)}
                                </div>
                                <div className="font-mono-bureau text-[8px] text-[#0C1B33]/35 mt-1">
                                  {bucket.count} record{bucket.count === 1 ? "" : "s"}
                                </div>
                              </div>
                            </div>
                            {bucket.undisclosedCount > 0 && (
                              <div className="text-[8px] text-[#0C1B33]/30 mt-1">
                                {bucket.undisclosedCount} of these publish no figure.
                              </div>
                            )}
                            {/* Provenance caveat for buckets whose RECORD COUNT
                                can mislead even when the dollars are sound. */}
                            {polygonInvestmentBucket(bucket.key).caption && (
                              <div className="text-[8px] text-[#0C1B33]/30 mt-1 leading-snug">
                                {polygonInvestmentBucket(bucket.key).caption}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {investmentSummary.yearSpan && (
                      <div className="mt-2 flex items-center justify-between text-[9px] px-1">
                        <span className="text-[#0C1B33]/40">Record years</span>
                        <span className="font-mono-bureau text-[#0C1B33]/60">
                          {polygonInvestmentYearSpanLabel(investmentSummary.yearSpan)}
                        </span>
                      </div>
                    )}

                    {investmentSummary.topRecipients.length > 0 && (
                      <div className="mt-4">
                        <div className="font-mono-bureau text-[8px] tracking-[0.22em] uppercase text-[#0C1B33]/30 mb-0.5">
                          Top recipients by awarded grant dollars
                        </div>
                        <div className="text-[8px] text-[#0C1B33]/30 mb-2 leading-snug">
                          Grant-class records only — development, TIF, federal, tax-credit and
                          appropriation figures are not ranked here.
                        </div>
                        <div className="space-y-1.5">
                          {investmentSummary.topRecipients.map((r) => (
                            <div
                              key={r.recipient}
                              className="flex items-baseline justify-between gap-2 text-[10px]"
                            >
                              <span className="text-[#0C1B33]/70 truncate">{r.recipient}</span>
                              <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0">
                                {formatPolygonInvestmentAmount(r.awarded)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {investmentExclusionNotes.length > 0 && (
                      <div className="mt-4 border-l-2 border-[#0E7490]/25 pl-3">
                        <div className="font-mono-bureau text-[8px] tracking-[0.22em] uppercase text-[#0C1B33]/30 mb-1">
                          Not selectable by a drawn area
                        </div>
                        {investmentExclusionNotes.map((note) => (
                          <p key={note} className="text-[9px] text-[#0C1B33]/40 leading-snug">
                            {note}
                          </p>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {/* ── Property List ── */}
          {features.length > 0 && (
            <>
              <div className={`${activeEvidenceFamily === "vacancy" ? "" : "hidden"} mx-5 md:mx-7 h-px bg-[#0C1B33]/8`} />
              <div className={`${activeEvidenceFamily === "vacancy" ? "" : "hidden"} px-5 md:px-7 py-5 bg-white`}>
                <div className="flex items-baseline justify-between mb-0.5">
                  <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#D97706]/50">
                    Tracked vacancy signals
                  </div>
                  <span className="font-mono-bureau text-[9px] text-[#0C1B33]/30">
                    {features.length.toLocaleString("en-US")} {features.length === 1 ? "signal" : "signals"} total
                  </span>
                </div>
                <div className="text-[9px] text-[#0C1B33]/35 mb-2">
                  Click an address to generate its location snapshot
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                  {propertyListFeatures.map((f, i) => {
                    const p = f.properties ?? {};
                    const canonicalType =
                      p.canonicalType === "land" ||
                      p.canonicalType === "building" ||
                      p.canonicalType === "storefront"
                        ? p.canonicalType
                        : "other";
                    const isLand = canonicalType === "land";
                    const zones: unknown[] = p.zoneMatches ?? [];
                    const ownerColor =
                      OWNER_TYPE_COLORS[p.ownerType as OwnerType] ??
                      "#9CA3AF";
                    const programName =
                      typeof p.programName === "string" && p.programName.trim()
                        ? p.programName.trim()
                        : null;
                    const managingOrganization =
                      typeof p.managingOrganization === "string" &&
                      p.managingOrganization.trim()
                        ? p.managingOrganization.trim()
                        : null;
                    const sourceContext = programContextToText(p.programContext);
                    const applicationUrl = safeVacancyProgramUrl(p.applicationUrl);
                    return (
                      <div
                        key={p.id ?? `${p.address ?? "unknown"}-${i}`}
                        className="text-[10px] leading-snug border-l-2 pl-3 py-1 hover:bg-[#FAF9F6] transition-colors"
                        style={{ borderColor: isLand ? "#EF4444" : "#F97316" }}
                      >
                        <a
                          href={buildReportLink(f)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-[#0C1B33]/80 hover:text-[#2563EB] truncate block transition-colors"
                          title={`Generate location snapshot for ${p.address}`}
                        >
                          {p.address ?? "Unknown Address"}
                        </a>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span
                            className="inline-block text-[8px] font-medium px-1.5 py-px rounded"
                            style={{
                              backgroundColor: isLand ? "#EF444410" : "#F9731610",
                              color: isLand ? "#EF4444" : "#F97316",
                            }}
                          >
                            {canonicalType === "land"
                              ? "Land signal"
                              : canonicalType === "building"
                                ? "Building signal"
                                : canonicalType === "storefront"
                                  ? "Storefront signal"
                                  : "Other signal"}
                          </span>
                          {typeof p.sourceUrl === "string" && p.sourceUrl ? (
                            <a
                              href={p.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[8px] text-[#2563EB]/75 hover:underline"
                            >
                              {vacancySourceLabel(p.source, p)}
                            </a>
                          ) : (
                            <span className="text-[8px] text-[#0C1B33]/45">
                              {vacancySourceLabel(p.source, p)}
                            </span>
                          )}
                          {typeof p.status === "string" && p.status.trim() && (
                            <span className="text-[8px] text-[#0C1B33]/40">
                              Source status: {p.status}
                            </span>
                          )}
                          <span className="text-[8px] text-[#0C1B33]/40">
                            {typeof p.sourceRecordDate === "string"
                              ? `Reported ${p.sourceRecordDate.slice(0, 10)}`
                              : "Source date unknown"}
                          </span>
                          {p.licenseCheckState === "match" && (
                            <span className="inline-block text-[8px] font-medium px-1.5 py-px rounded bg-[#FEF3C7] text-[#92400E]">
                              Current-license conflict
                            </span>
                          )}
                          {zones.length > 0 && (
                            <span className="text-[8px] text-[#0C1B33]/40 font-mono-bureau">
                              {zones.length} zone{zones.length !== 1 ? "s" : ""}
                            </span>
                          )}
                          {p.ownerType && p.ownerType !== "unknown" && (
                            <span
                              className="inline-block text-[8px] px-1.5 py-px rounded"
                              style={{
                                backgroundColor: ownerColor + "12",
                                color: ownerColor,
                              }}
                            >
                              {OWNER_TYPE_LABELS[p.ownerType as OwnerType] ?? p.ownerType}
                            </span>
                          )}
                        </div>
                        {(programName || managingOrganization || sourceContext) && (
                          <div className="mt-1 text-[8px] leading-snug text-[#0C1B33]/50">
                            {programName && (
                              <span>Published program / disposition context: {programName}</span>
                            )}
                            {programName && managingOrganization && (
                              <span> · </span>
                            )}
                            {managingOrganization && (
                              <span>
                                Managing organization: {managingOrganization}
                              </span>
                            )}
                            {(programName || managingOrganization) && sourceContext && (
                              <span> · </span>
                            )}
                            {sourceContext && <span>{sourceContext}</span>}
                            <span> · Verify current availability and terms.</span>
                          </div>
                        )}
                        {applicationUrl && (
                          <a
                            href={applicationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-block text-[8px] text-[#2563EB]/75 hover:underline"
                          >
                            Review published program record ↗
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
                {features.length > propertyListFeatures.length && (
                  <p className="mt-2 text-[9px] leading-relaxed text-[#0C1B33]/45">
                    Showing the first {propertyListFeatures.length.toLocaleString("en-US")} of {features.length.toLocaleString("en-US")} signals in this on-screen list. Aggregates, map filters, saved analysis, and CSV use the full filtered set; the CSV contains every row.
                  </p>
                )}
              </div>
            </>
          )}

          <section className={`${activeEvidenceFamily === "sources" ? "" : "hidden"} border-y border-[#0C1B33]/8 bg-white px-5 py-6 md:px-7`}>
            <p className="font-mono-bureau text-[9px] uppercase tracking-[0.24em] text-[#2563EB]">
              Sources and methods
            </p>
            <h2 className="mt-2 font-editorial text-[26px] leading-tight text-[#0C1B33]">
              Keep every evidence family traceable.
            </h2>
            <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-[#0C1B33]/50">
              The workstation keeps vacancy, ownership context, incentive-zone matches, permit filings, and gated investment records separate because they answer different questions and have different coverage limits. Nothing here establishes availability, title, zoning approval, or completed construction.
            </p>
            <div className="mt-5 grid gap-px border border-[#0C1B33]/8 bg-[#0C1B33]/8 md:grid-cols-2">
              {[
                {
                  label: "Vacancy and boundary records",
                  detail: vacancyCoverageNote || "City of Chicago public records returned for the exact drawn polygon.",
                  url: "https://data.cityofchicago.org/",
                },
                ...(hasOfficialCclbaPublishedInventory
                  ? [{
                      label: "Cook County Land Bank published inventory",
                      detail: "Published inventory context only. Confirm current availability and disposition terms with CCLBA.",
                      url: CCLBA_PUBLIC_PORTAL_URL,
                    }]
                  : []),
                {
                  label: "Ownership context",
                  detail: "Cook County Assessor context attached to returned vacancy records. Verify title and deed history separately.",
                  url: "https://www.cookcountyassessor.com/",
                },
                ...(licenseScreening
                  ? [{
                      label: "Current-license conflict screen",
                      detail: `City business-license screening status: ${licenseScreening.status}. A match is a conflict signal; no match is not proof of vacancy.`,
                      url: "https://data.cityofchicago.org/Community-Economic-Development/Business-Licenses/r5kz-chrr",
                    }]
                  : []),
                ...(permitAnalysis
                  ? [{
                      label: "Building permit filings",
                      detail: `${formatPermitAreaCoverageLabel(permitAnalysis)} Located filings only; filings do not prove work started or finished.`,
                      url: permitAnalysis.source.url,
                    }]
                  : []),
              ].map((source) => (
                <a
                  key={source.label}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group min-w-0 bg-[#FAF9F6] px-4 py-4 hover:bg-white"
                >
                  <span className="font-mono-bureau text-[8px] uppercase tracking-[0.18em] text-[#2563EB] group-hover:underline">
                    {source.label} ↗
                  </span>
                  <span className="mt-2 block text-[10px] leading-relaxed text-[#0C1B33]/50">
                    {source.detail}
                  </span>
                </a>
              ))}
            </div>
            {drawnAreaScope && (
              <div className="mt-4 border-l-2 border-[#2563EB]/25 pl-3">
                <p className="font-mono-bureau text-[8px] uppercase tracking-[0.16em] text-[#0C1B33]/40">
                  Exact-boundary provenance
                </p>
                <p className="mt-1 break-all text-[9px] leading-relaxed text-[#0C1B33]/45">
                  Point in saved polygon · {drawnAreaScope.scope.fingerprint} · {drawnAreaScope.provenance.vacancy.selectedCount.toLocaleString("en-US")} generation-time vacancy record reference{drawnAreaScope.provenance.vacancy.selectedCount === 1 ? "" : "s"}
                </p>
              </div>
            )}
          </section>

          {/* ── Follow-Up Resources ── */}
          <div className={`${activeEvidenceFamily === "sources" ? "" : "hidden"} mx-5 md:mx-7 h-px bg-[#0C1B33]/8`} />
          <div className={`${activeEvidenceFamily === "sources" ? "" : "hidden"} px-5 md:px-7 py-5 bg-white`}>
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30 mb-2">
              Next Steps &amp; Resources
            </div>
            <div className="space-y-2.5">
              {RESOURCES.map((r) => (
                <a
                  key={r.name}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 group"
                >
                  <span className="text-[#2563EB]/40 group-hover:text-[#2563EB] mt-0.5 text-[8px] shrink-0">&#x2192;</span>
                  <div>
                    <div className="text-[10px] font-medium text-[#0C1B33]/70 group-hover:text-[#2563EB] transition-colors">
                      {r.name}
                    </div>
                    <div className="text-[9px] text-[#0C1B33]/35 leading-snug">
                      {r.desc}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* ── Footer ── */}
          <div className={`${activeEvidenceFamily === "sources" ? "" : "hidden"} mx-5 md:mx-7 h-px bg-[#0C1B33]/8`} />
          <div className={`${activeEvidenceFamily === "sources" ? "" : "hidden"} px-5 md:px-7 py-3 bg-white`}>
            <Link
              href="/programs"
              className="block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase border border-[#0C1B33]/15 text-[#0C1B33]/50 py-2 px-3 hover:text-[#0C1B33] hover:border-[#0C1B33]/30 transition-colors"
            >
              Browse All Programs
            </Link>
          </div>

          {/* ── Attribution ── */}
          <div className={`${activeEvidenceFamily === "sources" ? "" : "hidden"} px-5 md:px-7 py-4 bg-[#F5F5F0] border-t border-[#0C1B33]/6`}>
            <p className="text-[8px] text-[#0C1B33]/25 leading-snug">
              Data: source-attributed public records and Cook County Assessor context. Source coverage varies by query and deployment; review each row&apos;s source and the report provenance before treating an inventory as loaded or complete. Vacancy signals may lag current conditions. An issued, unexpired exact-address license is a conflict signal, not proof of occupancy; no match is not proof a site is unoccupied. Permit filings do not prove work started or finished. Always verify source records and site conditions.
            </p>
          </div>

          {/* A completed exact-boundary analysis remains exportable even when
              the current filters produce a valid zero. Keeping the actions
              after the evidence means the Sources tab is read before export.
              Gated investment data stays CSV-only; public report actions never
              expose it. */}
          <div className="sticky bottom-0 z-10 border-t border-[#0C1B33]/10 bg-white/95 px-5 py-3 shadow-[0_-8px_24px_rgba(12,27,51,0.08)] backdrop-blur md:px-7">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono-bureau text-[8px] uppercase tracking-[0.18em] text-[#0C1B33]/40">
                Export the current evidence view
              </p>
              <p className="text-[8px] text-[#0C1B33]/35">
                Label, active filters, and optional notes travel with the output.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <button
                onClick={handleSaveReport}
                disabled={loading || permitPending || !drawnAreaScope}
                aria-busy={loading || permitPending}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 bg-[#2563EB] px-3 py-2.5 text-center font-mono-bureau text-[9px] uppercase tracking-[0.13em] text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileText className="h-3.5 w-3.5" />
                Save Report
              </button>
              <button
                onClick={handleEmailReport}
                disabled={loading || permitPending || !drawnAreaScope}
                aria-busy={loading || permitPending}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 border border-[#2563EB]/30 px-3 py-2.5 text-center font-mono-bureau text-[9px] uppercase tracking-[0.13em] text-[#2563EB] transition-colors hover:bg-[#2563EB]/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Mail className="h-3.5 w-3.5" />
                Email This to Me
              </button>
              <button
                onClick={handleDownloadPdf}
                disabled={loading || permitPending || !drawnAreaScope}
                aria-busy={loading || permitPending}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 border border-[#0C1B33]/15 px-3 py-2.5 text-center font-mono-bureau text-[9px] uppercase tracking-[0.13em] text-[#0C1B33]/70 transition-colors hover:bg-[#0C1B33]/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileDown className="h-3.5 w-3.5" />
                {pdfDownloadFailed ? "Retry PDF" : "Download PDF"}
              </button>
              <button
                onClick={handleExportCsv}
                disabled={loading || permitPending || !drawnAreaScope}
                aria-busy={loading || permitPending}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 bg-[#0C1B33] px-3 py-2.5 text-center font-mono-bureau text-[9px] uppercase tracking-[0.13em] text-white transition-colors hover:bg-[#0C1B33]/80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Export Area Data (CSV)
              </button>
              {(loading || permitPending || !drawnAreaScope) && (
                <p role="status" className="col-span-full text-[9px] leading-snug text-[#0C1B33]/45">
                  {loading || permitPending
                    ? "Save, email, PDF, and CSV export will be available after the vacancy and permit lookups finish."
                    : "Save, email, PDF, and CSV export are unavailable because the exact boundary provenance could not be created."}
                </p>
              )}
              {pdfDownloadFailed && (
                <p
                  role="status"
                  data-testid="area-pdf-download-error"
                  className="col-span-full text-[9px] leading-snug text-red-600"
                >
                  We couldn&rsquo;t build that PDF just then. Nothing was saved or sent — use Retry
                  PDF to try again.
                </p>
              )}
            </div>
          </div>
        </>
      )}
      </div>
      {saveModalOpen && drawnAreaScope && !loading && !permitPending && (
        <SaveReportModal
          reportData={areaReport}
          wizardState={areaWizardState}
          onClose={() => setSaveModalOpen(false)}
        />
      )}
      {emailModalOpen && drawnAreaScope && !loading && !permitPending && (
        <AreaEmailReportModal
          report={areaReport}
          onClose={() => setEmailModalOpen(false)}
        />
      )}
    </div>
  );
}

function AreaEmailReportModal({
  report,
  onClose,
}: {
  report: GeneratedReport;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const handleSend = async () => {
    if (!email.includes("@")) return;
    setStatus("sending");
    setError("");

    try {
      const { generateReportPdfBase64 } = await import("@/lib/pdf-report");
      const { base64, filename } = generateReportPdfBase64(report);

      const res = await fetch("/api/email-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          pdfBase64: base64,
          filename,
          businessName: report.title,
          address: report.metadata.address,
          // F14 (build-spec.md 2.4): a program count, not a section count.
          incentiveCount: programCount(report),
        }),
      });

      if (!res.ok) throw new Error("Could not send email");
      setStatus("sent");
      setTimeout(onClose, 1200);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not send email");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white border border-[#0C1B33]/10 shadow-2xl">
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-[#0C1B33]/8">
          <div>
            <p className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/60 mb-2">
              Email Area Analysis
            </p>
            <h3 className="font-editorial text-2xl text-[#0C1B33] leading-tight">
              Send this area report to yourself.
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#0C1B33]/35 hover:text-[#0C1B33] p-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="w-full border border-[#0C1B33]/10 px-4 py-3 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]"
          />
          {error && (
            <p className="text-[12px] text-red-600 bg-red-50 border border-red-100 px-3 py-2">
              {error}
            </p>
          )}
          {status === "sent" && (
            <p className="text-[12px] text-green-700 bg-green-50 border border-green-100 px-3 py-2">
              Sent. Check your inbox.
            </p>
          )}
        </div>
        <div className="px-6 pb-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button
            onClick={onClose}
            className="px-5 py-3 border border-[#0C1B33]/10 text-[#0C1B33]/50 font-mono-bureau text-[10px] tracking-[0.15em] uppercase hover:border-[#0C1B33]/25"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={!email.includes("@") || status === "sending" || status === "sent"}
            className="px-5 py-3 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase hover:bg-[#1E3054] disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {status === "sending" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Email This to Me
          </button>
        </div>
      </div>
    </div>
  );
}
