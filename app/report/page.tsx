"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Search,
  MapPin,
  FileText,
  Loader2,
  RotateCcw,
  Printer,
  AlertCircle,
  Phone,
  ExternalLink,
  Calendar,
  Mail,
  Link2,
} from "lucide-react";
import {
  REPORT_TYPE_OPTIONS,
  WIZARD_STEPS,
  getStepsForReportType,
  getStepValue,
  setStepValue,
  INITIAL_WIZARD_STATE,
  PROJECT_TYPE_LABELS,
  PROPOSED_USE_LABELS,
  PROPOSED_USE_OPTIONS,
  VACANCY_PROJECT_TYPE_OPTIONS,
  FUNDING_COMMITTED_OPTIONS,
  REMAINING_GAP_OPTIONS,
  TIMELINE_OPTIONS,
  SITE_CONTROL_OPTIONS,
  JOBS_IMPACT_OPTIONS,
  SUPPORT_NEEDED_OPTIONS,
  BUDGET_RANGE_OPTIONS,
  optionLabel,
} from "@/lib/report-wizard-config";
import type {
  ReportType,
  WizardState,
  WizardStepConfig,
} from "@/lib/report-wizard-config";
import { generateReportData } from "@/lib/report-engine";
import type { GeneratedReport, ReportCensusData, ReportZoningData, ActionRoadmapItem } from "@/lib/report-engine";
import { encodeWizardState, decodeWizardState } from "@/lib/url-state";
import { generateReportPdf } from "@/lib/pdf-report";
import { normalizeZoneCheckResponse } from "@/lib/zone-response";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import type { Program, ExecutiveSummary, ParcelData, DistrictData, StackingRule, CommunityAsset, Stats } from "@/lib/types";
import ReportZoningMap from "@/components/report/ReportZoningMap";
import { cachedFetch } from "@/lib/fetch-cache";
import { SaveReportModal } from "@/components/workspace/SaveReportModal";
import { storePendingReport } from "@/components/workspace/PendingReportSaver";

// ─── Animation Variants ──────────────────────────────────────────────

const stepVariants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? 60 : -60,
  }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? -60 : 60,
  }),
};

const stepTransition = { duration: 0.35, ease: "easeOut" as const };

const fadeIn = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: "easeOut" as const },
};

type VacancySpreadsheetFeature = {
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown>;
};

function toCsvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function slugifyFilePart(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "locale";
}

function zoneMatchesToText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((zone) => {
      if (typeof zone === "string") return zone;
      if (zone && typeof zone === "object" && "zoneKey" in zone) {
        return String((zone as { zoneKey?: unknown }).zoneKey ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("; ");
}

function buildVacancySpreadsheetCsv(features: VacancySpreadsheetFeature[]): string {
  const header = [
    "Address",
    "Property Type",
    "Ward",
    "Community Area",
    "Zoning Class",
    "Sq Ft",
    "Owner Name",
    "Owner Type",
    "Incentive Count",
    "Zone Matches",
  ];
  const rows = features.map((feature) => {
    const p = feature.properties ?? {};
    return [
      p.address,
      p.propertyType,
      p.ward,
      p.communityArea,
      p.zoningClass,
      p.squareFeet,
      p.ownerName,
      p.ownerType,
      p.incentiveCount,
      zoneMatchesToText(p.zoneMatches),
    ].map(toCsvCell).join(",");
  });

  return [header.join(","), ...rows].join("\n");
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildIncentiveAnalysisUrl(feature: VacancySpreadsheetFeature): string {
  const properties = feature.properties ?? {};
  const coords = Array.isArray(feature.geometry?.coordinates)
    ? feature.geometry.coordinates
    : [];
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  const address = String(properties.address ?? "");

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `/report?instant=true&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&addr=${encodeURIComponent(address)}`;
  }

  return `/report?addr=${encodeURIComponent(address)}`;
}

function getDisplayValueForStep(
  wizardState: WizardState,
  step: WizardStepConfig
): string {
  if (step.inputType === "project-intake") {
    const isVacancy = wizardState.reportType === "dev-feasibility";
    return (isVacancy
      ? [
        wizardState.projectType && (PROJECT_TYPE_LABELS[wizardState.projectType] || wizardState.projectType),
        wizardState.proposedUse && (PROPOSED_USE_LABELS[wizardState.proposedUse] || wizardState.proposedUse),
      ]
      : [
        wizardState.projectType && (PROJECT_TYPE_LABELS[wizardState.projectType] || wizardState.projectType),
        wizardState.budgetRange && optionLabel([...BUDGET_RANGE_OPTIONS, { id: "skip", label: "Still estimating" }], wizardState.budgetRange),
        wizardState.timeline && optionLabel(TIMELINE_OPTIONS, wizardState.timeline),
      ])
      .filter(Boolean)
      .join(" · ");
  }

  const val = step.inputType === "address"
    ? wizardState.address
    : getStepValue(wizardState, step.id);

  if (typeof val === "string") {
    if (
      (step.inputType === "single" || step.inputType === "combobox") &&
      step.options
    ) {
      const opt = step.options.find((o) => o.id === val);
      return opt?.label || val;
    }
    return val;
  }

  if (Array.isArray(val)) {
    if (step.options) {
      return val
        .map((v) => {
          const opt = step.options!.find((o) => o.id === v);
          return opt?.label || v;
        })
        .join(", ");
    }
    return val.join(", ");
  }

  return "";
}

function getWizardSelectionItems(
  wizardState: WizardState,
  steps: WizardStepConfig[]
): { label: string; value: string }[] {
  const items: { label: string; value: string }[] = [];
  const reportTypeOption = REPORT_TYPE_OPTIONS.find(
    (option) => option.id === wizardState.reportType
  );

  if (reportTypeOption) {
    items.push({ label: "Report", value: reportTypeOption.title });
  }

  for (const step of steps) {
    if (step.inputType === "report-type" || step.inputType === "review") {
      continue;
    }
    const value = getDisplayValueForStep(wizardState, step);
    if (value) items.push({ label: step.title, value });
  }

  return items;
}

// ─── Confidence badge color mapping ──────────────────────────────────

const CONFIDENCE_BADGE: Record<string, { bg: string; text: string; border: string }> = {
  appears_eligible: { bg: "bg-[#0C1B33]/[0.04]", text: "text-[#0C1B33]/70", border: "border-[#0C1B33]/12" },
  location_eligible: { bg: "bg-[#0C1B33]/[0.04]", text: "text-[#0C1B33]/60", border: "border-[#0C1B33]/10" },
  may_qualify: { bg: "bg-[#0C1B33]/[0.03]", text: "text-[#0C1B33]/50", border: "border-[#0C1B33]/8" },
  worth_exploring: { bg: "bg-[#0C1B33]/[0.02]", text: "text-[#0C1B33]/35", border: "border-[#0C1B33]/6" },
  not_applicable: { bg: "bg-[#0C1B33]/[0.02]", text: "text-[#0C1B33]/30", border: "border-[#0C1B33]/5" },
};

// ─── Wrapper with Suspense ───────────────────────────────────────────

export default function ReportPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
          <div className="text-center">
            <div className="flex gap-1.5 justify-center mb-3">
              <div className="w-2 h-2 bg-[#2563EB]/30 rounded-full animate-pulse" />
              <div className="w-2 h-2 bg-[#2563EB]/30 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
              <div className="w-2 h-2 bg-[#2563EB]/30 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
            </div>
            <p className="font-mono-bureau text-[11px] tracking-wide text-[#0C1B33]/30">Loading...</p>
          </div>
        </div>
      }
    >
      <ReportWizardPage />
    </Suspense>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────

function ReportWizardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Instant mode detection
  const isInstantMode = searchParams.get("instant") === "true";
  const instantLat = searchParams.get("lat") ? parseFloat(searchParams.get("lat")!) : null;
  const instantLon = searchParams.get("lon") ? parseFloat(searchParams.get("lon")!) : null;
  const urlAddress = searchParams.get("addr") || "";
  const instantAddr = urlAddress;

  // Try to hydrate wizard state from URL params
  const urlWizardState = useMemo(() => decodeWizardState(searchParams), [searchParams]);
  const isShareMode = !!urlWizardState?.reportType && !isInstantMode;

  // Wizard state
  const [wizardState, setWizardState] = useState<WizardState>(() => {
    if (urlWizardState && !isInstantMode) {
      return urlWizardState;
    }
    if (isInstantMode && instantLat && instantLon) {
      return {
        ...INITIAL_WIZARD_STATE,
        reportType: "site-incentives",
        address: instantAddr,
        lat: instantLat,
        lon: instantLon,
      };
    }
    if (urlAddress) {
      return {
        ...INITIAL_WIZARD_STATE,
        address: urlAddress,
        lat: instantLat,
        lon: instantLon,
      };
    }
    return INITIAL_WIZARD_STATE;
  });
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  // Report state
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasRefinedInstantReport, setHasRefinedInstantReport] = useState(false);

  // Comparison state
  const [compareMode, setCompareMode] = useState(false);
  const [compareReport, setCompareReport] = useState<GeneratedReport | null>(null);
  const [compareAddressInput, setCompareAddressInput] = useState("");
  const [compareGeocoding, setCompareGeocoding] = useState(false);
  const [compareGeoResult, setCompareGeoResult] = useState<{ lat: number; lon: number; display_name: string } | null>(null);
  const [compareZones, setCompareZones] = useState<Record<string, boolean> | null>(null);
  const [compareZoneNames, setCompareZoneNames] = useState<Record<string, string> | null>(null);
  const [compareCensus, setCompareCensus] = useState<ReportCensusData | null>(null);
  const [compareZoning, setCompareZoning] = useState<ReportZoningData | null>(null);
  const [compareParcel, setCompareParcel] = useState<ParcelData | null>(null);

  // Data state
  const [programs, setPrograms] = useState<Program[]>([]);
  const [zones, setZones] = useState<Record<string, boolean> | null>(null);
  const [zoneNames, setZoneNames] = useState<Record<string, string> | null>(null);
  const [censusData, setCensusData] = useState<ReportCensusData | null>(null);
  const [cityZoning, setCityZoning] = useState<ReportZoningData | null>(null);
  const [parcelData, setParcelData] = useState<ParcelData | null>(null);
  const [districtsData, setDistrictsData] = useState<DistrictData | null>(null);
  const [stackingRules, setStackingRules] = useState<StackingRule[] | null>(null);
  const [communityAssets, setCommunityAssets] = useState<CommunityAsset[] | null>(null);
  const [areaStats, setAreaStats] = useState<Stats | null>(null);

  // Address / geocode state
  const [addressInput, setAddressInput] = useState(
    urlWizardState?.address || urlAddress
  );
  const [geocodeResult, setGeocodeResult] = useState<{
    lat: number;
    lon: number;
    display_name: string;
  } | null>(instantLat && instantLon && (urlWizardState?.address || urlAddress)
    ? { lat: instantLat, lon: instantLon, display_name: urlWizardState?.address || urlAddress }
    : null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  // Instant mode state
  const [instantLoading, setInstantLoading] = useState(isInstantMode);

  // Load programs on mount
  useEffect(() => {
    cachedFetch<Program[]>("/api/programs")
      .catch(() => cachedFetch<Program[]>("/data/programs.json"))
      .then(setPrograms)
      .catch(() => {});
  }, []);

  // Load zone data when address has lat/lon
  // Uses the API first, then falls back to client-side Turf.js if the API fails.
  useEffect(() => {
    if (!wizardState.lat || !wizardState.lon) return;
    const lat = wizardState.lat;
    const lon = wizardState.lon;

    (async () => {
      try {
        const data = await cachedFetch(`/api/zones/check?lat=${lat}&lon=${lon}`);
        const normalized = normalizeZoneCheckResponse(data);
        if (!normalized) throw new Error("API unavailable");
        setZones(normalized.zones);
        setZoneNames(normalized.zoneNames);
      } catch {
        // Fallback: use client-side Turf.js zone check
        const { checkZones } = await import("@/lib/zone-check");
        const result = await checkZones(lat, lon);
        setZones(result.zones);
        setZoneNames(result.zoneNames);
      }
    })();
  }, [wizardState.lat, wizardState.lon]);

  // Load census + zoning + parcel data when address has lat/lon
  useEffect(() => {
    if (!wizardState.lat || !wizardState.lon) return;
    cachedFetch(`/api/census?lat=${wizardState.lat}&lon=${wizardState.lon}`)
      .then((data) => { if (data) setCensusData(data as ReportCensusData); })
      .catch(() => {});
    cachedFetch(`/api/zoning?lat=${wizardState.lat}&lon=${wizardState.lon}`)
      .then((data) => { if (data) setCityZoning(data as ReportZoningData); })
      .catch(() => {});
    cachedFetch<ParcelData>(`/api/parcel?lat=${wizardState.lat}&lon=${wizardState.lon}`)
      .then((data) => { if (data) setParcelData(data); })
      .catch(() => {});
    cachedFetch<DistrictData>(`/api/districts?lat=${wizardState.lat}&lon=${wizardState.lon}`)
      .then((data) => { if (data) setDistrictsData(data); })
      .catch(() => {});
  }, [wizardState.lat, wizardState.lon]);

  // Load stacking rules + community assets when address has lat/lon
  useEffect(() => {
    if (!wizardState.lat || !wizardState.lon) return;
    cachedFetch<StackingRule[]>("/api/stacking").then((d) => { if (d) setStackingRules(d); }).catch(() => {});
    cachedFetch<CommunityAsset[]>(`/api/assets?type=edo,bso`).then((d) => { if (d) setCommunityAssets(d); }).catch(() => {});
  }, [wizardState.lat, wizardState.lon]);

  // Load area stats on mount (no lat/lon dependency)
  useEffect(() => {
    cachedFetch<Stats>("/api/stats").then((d) => { if (d) setAreaStats(d); }).catch(() => {
      cachedFetch<Stats>("/data/stats.json").then((d) => { if (d) setAreaStats(d); }).catch(() => {});
    });
  }, []);

  // ── Comparison data fetching ──
  useEffect(() => {
    if (!compareGeoResult) return;
    const { lat, lon } = compareGeoResult;
    (async () => {
      try {
        const data = await cachedFetch(`/api/zones/check?lat=${lat}&lon=${lon}`);
        const normalized = normalizeZoneCheckResponse(data);
        if (!normalized) throw new Error("API unavailable");
        setCompareZones(normalized.zones);
        setCompareZoneNames(normalized.zoneNames);
      } catch {
        const { checkZones } = await import("@/lib/zone-check");
        const result = await checkZones(lat, lon);
        setCompareZones(result.zones);
        setCompareZoneNames(result.zoneNames);
      }
    })();
    cachedFetch(`/api/census?lat=${lat}&lon=${lon}`).then((d) => { if (d) setCompareCensus(d as ReportCensusData); }).catch(() => {});
    cachedFetch(`/api/zoning?lat=${lat}&lon=${lon}`).then((d) => { if (d) setCompareZoning(d as ReportZoningData); }).catch(() => {});
    cachedFetch<ParcelData>(`/api/parcel?lat=${lat}&lon=${lon}`).then((d) => { if (d) setCompareParcel(d); }).catch(() => {});
  }, [compareGeoResult]);

  // Generate comparison report once compare data is ready
  useEffect(() => {
    if (!compareGeoResult || !compareZones || programs.length === 0) return;
    const timer = setTimeout(() => {
      const compareState: WizardState = {
        ...wizardState,
        address: compareGeoResult.display_name,
        lat: compareGeoResult.lat,
        lon: compareGeoResult.lon,
      };
      const generated = generateReportData(compareState, programs, {
        zones: compareZones ?? undefined,
        zoneNames: compareZoneNames ?? undefined,
        census: compareCensus ?? undefined,
        cityZoning: compareZoning ?? undefined,
        parcel: compareParcel ?? undefined,
      });
      setCompareReport(generated);
    }, 400);
    return () => clearTimeout(timer);
  }, [compareGeoResult, compareZones, compareZoneNames, compareCensus, compareZoning, compareParcel, programs, wizardState]);

  // Instant mode: auto-generate report once programs + zones are loaded
  // Small delay gives census/zoning APIs time to resolve alongside zones
  useEffect(() => {
    if (!isInstantMode || !instantLoading) return;
    if (programs.length === 0 || !zones) return;

    const timer = setTimeout(() => {
      setIsGenerating(true);
      try {
        const generated = generateReportData(wizardState, programs, {
          zones: zones ?? undefined,
          zoneNames: zoneNames ?? undefined,
          census: censusData ?? undefined,
          cityZoning: cityZoning ?? undefined,
          parcel: parcelData ?? undefined,
          districts: districtsData ?? undefined,
          stackingRules: stackingRules ?? undefined,
          communityAssets: communityAssets ?? undefined,
          stats: areaStats ?? undefined,
        });
        setReport(generated);
      } catch {
        // Stay on loading
      } finally {
        setIsGenerating(false);
        setInstantLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [isInstantMode, instantLoading, programs, zones, zoneNames, censusData, cityZoning, parcelData, districtsData, stackingRules, communityAssets, areaStats, wizardState]);

  // Share mode: auto-generate report once programs + zones are loaded
  const [shareAutoGenerated, setShareAutoGenerated] = useState(false);
  useEffect(() => {
    if (!isShareMode || shareAutoGenerated) return;
    if (programs.length === 0) return;
    // For address-based reports, wait for zones
    if (!zones && wizardState.lat) return;

    const timer = setTimeout(() => {
      setIsGenerating(true);
      try {
        const generated = generateReportData(wizardState, programs, {
          zones: zones ?? undefined,
          zoneNames: zoneNames ?? undefined,
          census: censusData ?? undefined,
          cityZoning: cityZoning ?? undefined,
          parcel: parcelData ?? undefined,
          districts: districtsData ?? undefined,
          stackingRules: stackingRules ?? undefined,
          communityAssets: communityAssets ?? undefined,
          stats: areaStats ?? undefined,
        });
        setReport(generated);
        setShareAutoGenerated(true);
      } catch {
        // Stay on wizard
      } finally {
        setIsGenerating(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [isShareMode, shareAutoGenerated, programs, zones, zoneNames, censusData, cityZoning, parcelData, districtsData, stackingRules, communityAssets, areaStats, wizardState]);

  // Derive steps based on report type
  const steps = useMemo<WizardStepConfig[]>(() => {
    if (!wizardState.reportType) return [WIZARD_STEPS[0]]; // just the report-type step
    const baseSteps = getStepsForReportType(wizardState.reportType);
    if (wizardState.reportType !== "site-incentives" || hasRefinedInstantReport) {
      return baseSteps;
    }
    return baseSteps.filter(
      (step) => step.id !== "si-project-intake" && step.id !== "si-documents"
    );
  }, [hasRefinedInstantReport, wizardState.reportType]);

  const currentStep = steps[currentStepIndex];
  const totalSteps = steps.length;
  const isLastStep = currentStepIndex === totalSteps - 1;

  // ── Can Proceed Logic ────────────────────────────────────────────

  const canProceed = useMemo(() => {
    if (!currentStep) return false;
    switch (currentStep.inputType) {
      case "report-type":
        return wizardState.reportType !== null;
      case "address":
        return (
          wizardState.address.trim() !== "" &&
          wizardState.lat !== null &&
          wizardState.lon !== null
        );
      case "neighborhood":
        return (
          wizardState.neighborhood.trim() !== "" ||
          (wizardState.address.trim() !== "" && wizardState.lat !== null && wizardState.lon !== null)
        );
      case "project-intake":
        return true;
      case "single":
      case "combobox": {
        if (currentStep.id === "si-industry") return true;
        const val = getStepValue(wizardState, currentStep.id);
        return typeof val === "string" && val !== "";
      }
      case "multi": {
        if (currentStep.id === "si-documents" || currentStep.id === "df-documents") {
          return true;
        }
        const val = getStepValue(wizardState, currentStep.id);
        return Array.isArray(val) && val.length > 0;
      }
      case "review":
        return true;
      default:
        return false;
    }
  }, [currentStep, wizardState]);

  // ── Geocode Handler ──────────────────────────────────────────────

  const handleGeocode = useCallback(async (addrOverride?: string) => {
    const addr = addrOverride || addressInput;
    if (!addr.trim()) return;
    setIsGeocoding(true);
    setGeocodeError(null);
    try {
      const data = await cachedFetch<{ lat: number; lon: number; displayName?: string; display_name?: string }>(
        `/api/geocode?address=${encodeURIComponent(addr.trim())}`
      );
      if (!data.lat || !data.lon) throw new Error("Address not found");
      setGeocodeResult({
        lat: data.lat,
        lon: data.lon,
        display_name: data.displayName || data.display_name || addr.trim(),
      });
      setWizardState((prev) => ({
        ...prev,
        address: data.displayName || data.display_name || addr.trim(),
        lat: data.lat,
        lon: data.lon,
      }));
    } catch {
      setGeocodeError("Could not find that address. Please try a more specific Chicago address.");
      setGeocodeResult(null);
    } finally {
      setIsGeocoding(false);
    }
  }, [addressInput]);

  // ── Navigation ───────────────────────────────────────────────────

  const handleNext = useCallback(() => {
    if (!canProceed) return;

    // If this is the report-type step, reset to the proper step list
    if (currentStep.inputType === "report-type") {
      setDirection(1);
      setCurrentStepIndex(1);
      return;
    }

    if (!isLastStep) {
      setDirection(1);
      setCurrentStepIndex((i) => i + 1);
    }
  }, [canProceed, currentStep, isLastStep]);

  const handleBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setDirection(-1);
      setCurrentStepIndex((i) => i - 1);
    }
  }, [currentStepIndex]);

  const handleStartOver = useCallback(() => {
    setWizardState(INITIAL_WIZARD_STATE);
    setCurrentStepIndex(0);
    setDirection(1);
    setReport(null);
    setGeocodeResult(null);
    setAddressInput("");
    setGeocodeError(null);
    setZones(null);
    setZoneNames(null);
    setCensusData(null);
    setCityZoning(null);
    setInstantLoading(false);
    setHasRefinedInstantReport(false);
    // Clear instant mode URL params
    router.replace("/report");
  }, [router]);

  const handleRefine = useCallback(() => {
    // Drop user into wizard at the first scoping step after the preserved address.
    setReport(null);
    setInstantLoading(false);
    setHasRefinedInstantReport(true);
    setCurrentStepIndex(2); // industry step
    setDirection(1);
  }, []);

  const handleCompareGeocode = useCallback(async () => {
    if (!compareAddressInput.trim()) return;
    setCompareGeocoding(true);
    try {
      const data = await cachedFetch<{ lat: number; lon: number; displayName?: string; display_name?: string }>(
        `/api/geocode?address=${encodeURIComponent(compareAddressInput.trim())}`
      );
      if (!data.lat || !data.lon) throw new Error("Address not found");
      setCompareGeoResult({ lat: data.lat, lon: data.lon, display_name: data.displayName || data.display_name || compareAddressInput.trim() });
      setWizardState((prev) => ({
        ...prev,
        compareAddress: data.displayName || data.display_name || compareAddressInput.trim(),
        compareLat: data.lat,
        compareLon: data.lon,
      }));
    } catch {
      setCompareGeoResult(null);
    } finally {
      setCompareGeocoding(false);
    }
  }, [compareAddressInput]);

  // ── Report Generation ────────────────────────────────────────────

  const handleGenerateReport = useCallback(async () => {
    setIsGenerating(true);
    try {
      const generated = generateReportData(wizardState, programs, {
        zones: zones ?? undefined,
        zoneNames: zoneNames ?? undefined,
        census: censusData ?? undefined,
        cityZoning: cityZoning ?? undefined,
        parcel: parcelData ?? undefined,
        districts: districtsData ?? undefined,
        stackingRules: stackingRules ?? undefined,
        communityAssets: communityAssets ?? undefined,
        stats: areaStats ?? undefined,
      });
      setReport(generated);
    } catch {
      // If generation fails, stay on review step
    } finally {
      setIsGenerating(false);
    }
  }, [wizardState, programs, zones, zoneNames, censusData, cityZoning, parcelData, districtsData, stackingRules, communityAssets, areaStats]);

  // ── Value Change Handlers ────────────────────────────────────────

  const handleReportTypeSelect = useCallback((type: ReportType) => {
    setWizardState((prev) => ({ ...prev, reportType: type }));
  }, []);

  const handleSingleSelect = useCallback(
    (stepId: string, value: string) => {
      setWizardState((prev) => setStepValue(prev, stepId, value));
    },
    []
  );

  const handleMultiToggle = useCallback(
    (stepId: string, value: string) => {
      setWizardState((prev) => {
        const current = getStepValue(prev, stepId);
        const arr = Array.isArray(current) ? current : [];
        const next = arr.includes(value)
          ? arr.filter((v) => v !== value)
          : value === "none-yet"
            ? ["none-yet"]
            : [...arr.filter((v) => v !== "none-yet"), value];
        return setStepValue(prev, stepId, next);
      });
    },
    []
  );

  const handleMultiSetAll = useCallback(
    (stepId: string, values: string[]) => {
      setWizardState((prev) => setStepValue(prev, stepId, values));
    },
    []
  );

  const handleProjectIntakeChange = useCallback(
    (key: keyof WizardState, value: string | string[]) => {
      setWizardState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  // ── Instant mode loading state ─────────────────────────────────

  if (instantLoading || (isInstantMode && !report && isGenerating)) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
        <div className="text-center">
          <div className="flex gap-1.5 justify-center mb-4">
            <div className="w-2 h-2 bg-[#2563EB]/40 rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-[#2563EB]/40 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
            <div className="w-2 h-2 bg-[#2563EB]/40 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
          </div>
          <p className="font-mono-bureau text-[11px] tracking-[0.15em] uppercase text-[#0C1B33]/30 mb-2">
            Generating Location Snapshot
          </p>
          {instantAddr && (
            <p className="text-[13px] text-[#0C1B33]/40">{instantAddr}</p>
          )}
        </div>
      </div>
    );
  }

  // ── If report is generated, show report display ──────────────────

  if (report && compareReport) {
    return (
      <div className="min-h-screen">
        <ComparisonDisplay
          reportA={report}
          reportB={compareReport}
          onStartOver={handleStartOver}
          wizardState={wizardState}
        />
      </div>
    );
  }

  if (report) {
    return (
      <div className="min-h-screen">
        <ReportDisplay
          report={report}
          onStartOver={handleStartOver}
          onRefine={handleRefine}
          isInstantMode={isInstantMode && !hasRefinedInstantReport}
          wizardState={wizardState}
          onCompare={() => setCompareMode(true)}
          compareMode={compareMode}
          compareAddressInput={compareAddressInput}
          setCompareAddressInput={setCompareAddressInput}
          compareGeocoding={compareGeocoding}
          onCompareGeocode={handleCompareGeocode}
          compareGeoResult={compareGeoResult}
        />
      </div>
    );
  }

  // ── Wizard UI ────────────────────────────────────────────────────

  return (
    <div className="bg-[#FAF9F6] min-h-screen">
      <section className="py-20 px-6">
        <div className="container mx-auto max-w-2xl">
          {/* Page header */}
          <div className="text-center mb-14">
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="accent-bar" />
              <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/30">
                Report Builder
              </span>
              <div className="accent-bar" />
            </div>
            <h1 className="font-editorial text-3xl sm:text-4xl md:text-5xl text-[#0C1B33] mb-4">
              Build Your Report
            </h1>
            <p className="font-mono-bureau text-[11px] text-[#0C1B33]/40 uppercase tracking-[0.1em] max-w-md mx-auto">
              Customize a comprehensive incentive report for your business
            </p>
          </div>

          {/* Wizard content */}
          <div className="flex flex-col min-h-[60vh]">
            {/* Progress bar */}
            <div className="mb-10">
              <WizardProgressBar
                steps={steps}
                currentStepIndex={currentStepIndex}
              />
            </div>

            {/* Step content */}
            <div className="flex-1">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={currentStep.id}
                  custom={direction}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={stepTransition}
                >
                  {/* Step label + title */}
                  <div className="mb-8">
                    <span className="font-mono-bureau text-[10px] text-[#0C1B33]/25 uppercase tracking-[0.2em] block mb-3">
                      Step {currentStepIndex + 1} of {totalSteps}
                    </span>
                    <h2 className="font-editorial text-2xl sm:text-3xl text-[#0C1B33] mb-2">
                      {currentStep.title}
                    </h2>
                    {currentStep.subtitle && (
                      <p className="font-mono-bureau text-[11px] text-[#0C1B33]/40 uppercase tracking-[0.1em]">
                        {currentStep.subtitle}
                      </p>
                    )}
                  </div>

                  {/* Step body by type */}
                  {currentStep.inputType === "report-type" && (
                    <ReportTypeStep
                      selected={wizardState.reportType}
                      onSelect={handleReportTypeSelect}
                    />
                  )}

                  {currentStep.inputType === "address" && (
                    <AddressStep
                      addressInput={addressInput}
                      setAddressInput={setAddressInput}
                      geocodeResult={geocodeResult}
                      isGeocoding={isGeocoding}
                      geocodeError={geocodeError}
                      onGeocode={handleGeocode}
                    />
                  )}

                  {currentStep.inputType === "neighborhood" && (
                    <NeighborhoodStep
                      neighborhood={wizardState.neighborhood}
                      onSelectNeighborhood={(name, lat, lon) => {
                        setWizardState((prev) => ({
                          ...prev,
                          neighborhood: name,
                          lat,
                          lon,
                          address: "",
                        }));
                        // Clear any previous address-based data
                        setGeocodeResult(null);
                      }}
                      addressInput={addressInput}
                      setAddressInput={setAddressInput}
                      geocodeResult={geocodeResult}
                      isGeocoding={isGeocoding}
                      geocodeError={geocodeError}
                      onGeocode={(addr) => {
                        // When using specific address, clear neighborhood
                        handleGeocode(addr);
                        setWizardState((prev) => ({
                          ...prev,
                          neighborhood: "",
                        }));
                      }}
                    />
                  )}

                  {currentStep.inputType === "project-intake" && (
                    <ProjectIntakeStep
                      wizardState={wizardState}
                      onChange={handleProjectIntakeChange}
                      isOptional
                    />
                  )}

                  {currentStep.inputType === "combobox" && currentStep.options && (
                    <ComboboxStep
                      stepId={currentStep.id}
                      options={currentStep.options}
                      value={
                        (getStepValue(wizardState, currentStep.id) as string) ||
                        ""
                      }
                      onSelect={handleSingleSelect}
                    />
                  )}

                  {currentStep.inputType === "single" && currentStep.options && (
                    <SingleSelectStep
                      stepId={currentStep.id}
                      options={currentStep.options}
                      value={
                        (getStepValue(wizardState, currentStep.id) as string) ||
                        ""
                      }
                      onSelect={handleSingleSelect}
                    />
                  )}

                  {currentStep.inputType === "multi" && currentStep.options && (
                    <MultiSelectStep
                      stepId={currentStep.id}
                      options={currentStep.options}
                      value={
                        (getStepValue(wizardState, currentStep.id) as string[]) ||
                        []
                      }
                      onToggle={handleMultiToggle}
                      onSetAll={handleMultiSetAll}
                    />
                  )}

                  {currentStep.inputType === "review" && (
                    <ReviewStep
                      wizardState={wizardState}
                      steps={steps}
                      isGenerating={isGenerating}
                      onGenerate={handleGenerateReport}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <WizardSelectionSummary
              wizardState={wizardState}
              steps={steps}
            />

            {/* Navigation */}
            {currentStep.inputType !== "review" && (
              <div className="flex items-center justify-between mt-10 pt-6 border-t border-[#0C1B33]/6">
                <button
                  onClick={handleBack}
                  disabled={currentStepIndex === 0}
                  className={`inline-flex items-center gap-2 font-mono-bureau text-[11px] uppercase tracking-[0.1em] cursor-pointer ${
                    currentStepIndex === 0
                      ? "text-[#0C1B33]/10 cursor-default"
                      : "text-[#0C1B33]/35 hover:text-[#0C1B33]"
                  }`}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>

                <button
                  onClick={handleNext}
                  disabled={!canProceed}
                  className={`inline-flex items-center gap-2 font-mono-bureau text-[11px] uppercase tracking-[0.1em] px-6 py-3 border cursor-pointer transition-colors ${
                    canProceed
                      ? "bg-[#0C1B33] text-white border-[#0C1B33] hover:bg-[#2563EB] hover:border-[#2563EB]"
                      : "bg-transparent text-[#0C1B33]/15 border-[#0C1B33]/8 cursor-default"
                  }`}
                >
                  Next
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Live Selection Summary ──────────────────────────────────────────

function WizardSelectionSummary({
  wizardState,
  steps,
}: {
  wizardState: WizardState;
  steps: WizardStepConfig[];
}) {
  const items = getWizardSelectionItems(wizardState, steps);
  if (items.length === 0) return null;

  return (
    <div className="sticky bottom-4 z-20 mt-10">
      <div className="bg-white/95 backdrop-blur border border-[#0C1B33]/10 shadow-sm px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {items.slice(0, 4).map((item) => (
            <div
              key={`${item.label}-${item.value}`}
              className="min-w-0 max-w-full border border-[#0C1B33]/8 bg-[#FAF9F6] px-3 py-2"
            >
              <span className="block font-mono-bureau text-[7px] tracking-[0.22em] uppercase text-[#0C1B33]/25">
                {item.label}
              </span>
              <span className="block text-[12px] text-[#0C1B33]/70 truncate max-w-[220px]">
                {item.value}
              </span>
            </div>
          ))}
          {items.length > 4 && (
            <span className="font-mono-bureau text-[9px] tracking-[0.14em] uppercase text-[#0C1B33]/30 px-2">
              +{items.length - 4} more
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Progress Bar ────────────────────────────────────────────────────

function WizardProgressBar({
  steps,
  currentStepIndex,
}: {
  steps: WizardStepConfig[];
  currentStepIndex: number;
}) {
  return (
    <div>
      {/* Dots row */}
      <div className="flex items-center gap-0 w-full max-w-lg mx-auto">
        {steps.map((step, i) => {
          const isCompleted = i < currentStepIndex;
          const isActive = i === currentStepIndex;

          return (
            <div
              key={step.id}
              className="flex items-center flex-1 last:flex-none"
            >
              <div
                className={`w-8 h-8 flex items-center justify-center border flex-shrink-0 transition-colors ${
                  isCompleted
                    ? "bg-[#2563EB] border-[#2563EB]"
                    : isActive
                      ? "bg-transparent border-[#2563EB]"
                      : "bg-transparent border-[#0C1B33]/10"
                }`}
              >
                {isCompleted ? (
                  <Check
                    className="w-3.5 h-3.5 text-white"
                    strokeWidth={2.5}
                  />
                ) : (
                  <span
                    className={`font-mono-bureau text-[11px] font-medium ${
                      isActive ? "text-[#2563EB]" : "text-[#0C1B33]/20"
                    }`}
                  >
                    {i + 1}
                  </span>
                )}
              </div>

              {i < steps.length - 1 && (
                <div className="flex-1 h-[1px] mx-2">
                  <div
                    className={`h-full ${
                      isCompleted ? "bg-[#2563EB]" : "bg-[#0C1B33]/8"
                    }`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Step title below */}
      <div className="text-center mt-4">
        <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30">
          {steps[currentStepIndex]?.title || ""}
        </span>
      </div>
    </div>
  );
}

// ─── Report Type Step ────────────────────────────────────────────────

function ReportTypeStep({
  selected,
  onSelect,
}: {
  selected: ReportType | null;
  onSelect: (type: ReportType) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {REPORT_TYPE_OPTIONS.map((option, i) => {
        const isSelected = selected === option.id;
        return (
          <motion.button
            key={option.id}
            onClick={() => onSelect(option.id as ReportType)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.3,
              delay: i * 0.06,
              ease: "easeOut",
            }}
            className={`group relative text-left cursor-pointer p-5 transition-all duration-150 ${
              isSelected
                ? "bg-white border-2 border-[#2563EB] shadow-sm"
                : "bg-white border border-[#0C1B33]/10 hover:border-[#0C1B33]/20"
            }`}
          >
            <div className="text-3xl mb-3">{option.icon}</div>
            <h3
              className={`font-mono-bureau text-[12px] tracking-[0.08em] uppercase mb-1 ${
                isSelected ? "text-[#0C1B33]" : "text-[#0C1B33]/70"
              }`}
            >
              {option.title}
            </h3>
            <p className="text-[#0C1B33]/40 text-[13px] leading-relaxed">
              {option.subtitle}
            </p>
            <p className="mt-3 border-t border-[#0C1B33]/6 pt-3 font-mono-bureau text-[9px] tracking-[0.08em] uppercase leading-relaxed text-[#0C1B33]/35">
              {option.bestFor}
            </p>

            {/* Selection indicator */}
            {isSelected && (
              <div className="absolute top-3 right-3 w-5 h-5 bg-[#2563EB] flex items-center justify-center">
                <Check className="w-3 h-3 text-white" strokeWidth={2.5} />
              </div>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Address Step ────────────────────────────────────────────────────

// ─── Neighborhood Step (dropdown + optional address) ─────────────────

function NeighborhoodStep({
  neighborhood,
  onSelectNeighborhood,
  addressInput,
  setAddressInput,
  geocodeResult,
  isGeocoding,
  geocodeError,
  onGeocode,
}: {
  neighborhood: string;
  onSelectNeighborhood: (name: string, lat: number, lon: number) => void;
  addressInput: string;
  setAddressInput: (v: string) => void;
  geocodeResult: { lat: number; lon: number; display_name: string } | null;
  isGeocoding: boolean;
  geocodeError: string | null;
  onGeocode: (addr: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [useAddress, setUseAddress] = useState(false);

  // Import community areas
  const [areas, setAreas] = useState<{ id: number; name: string; lat: number; lon: number }[]>([]);
  useEffect(() => {
    import("@/lib/community-areas").then((mod) => {
      setAreas(mod.CHICAGO_COMMUNITY_AREAS);
    });
  }, []);

  const filtered = query
    ? areas.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
    : areas;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && useAddress) {
      e.preventDefault();
      onGeocode(addressInput);
    }
  };

  return (
    <div className="space-y-6">
      {/* Neighborhood picker */}
      {!useAddress && (
        <div className="relative">
          <div className="relative">
            <input
              type="text"
              value={open ? query : neighborhood}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!open) setOpen(true);
              }}
              onFocus={() => {
                setOpen(true);
                setQuery("");
              }}
              placeholder="Search neighborhoods..."
              className="w-full h-14 bg-white border border-[#0C1B33]/12 px-5 pr-12 text-[#0C1B33] text-sm placeholder:text-[#0C1B33]/30 focus:outline-none focus:border-[#2563EB]/50 focus:ring-2 focus:ring-[#2563EB]/10 font-mono-bureau tracking-wide transition-all"
            />
            <button
              onClick={() => setOpen(!open)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#0C1B33]/30"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={open ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
              </svg>
            </button>
          </div>

          {open && (
            <>
              <div className="absolute z-30 w-full mt-1 bg-white border border-[#0C1B33]/10 shadow-xl max-h-64 overflow-y-auto">
                {filtered.map((area) => {
                  const isSelected = neighborhood === area.name;
                  return (
                    <button
                      key={area.id}
                      onClick={() => {
                        onSelectNeighborhood(area.name, area.lat, area.lon);
                        setQuery("");
                        setOpen(false);
                      }}
                      className={`w-full text-left px-5 py-3 border-b border-[#0C1B33]/5 last:border-b-0 transition-colors ${
                        isSelected ? "bg-[#EFF3FB]" : "hover:bg-[#0C1B33]/[0.02]"
                      }`}
                    >
                      <span className={`font-mono-bureau text-[11px] tracking-[0.08em] uppercase ${
                        isSelected ? "text-[#2563EB]" : "text-[#0C1B33]/60"
                      }`}>
                        {area.name}
                      </span>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="px-5 py-3 text-[#0C1B33]/30 text-[12px]">
                    No matching neighborhood
                  </div>
                )}
              </div>
              <div className="fixed inset-0 z-20" onClick={() => { setOpen(false); setQuery(""); }} />
            </>
          )}

          {neighborhood && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 bg-white border border-[#2563EB]/20 p-4 flex items-start gap-3"
            >
              <MapPin className="w-4 h-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[13px] text-[#0C1B33]/70 font-medium">{neighborhood}</p>
                <p className="font-mono-bureau text-[10px] text-[#0C1B33]/30 mt-0.5">
                  Community Area &middot; Neighborhood-level analysis
                </p>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* Toggle */}
      <button
        onClick={() => setUseAddress(!useAddress)}
        className="font-mono-bureau text-[11px] tracking-[0.1em] text-[#2563EB]/60 hover:text-[#2563EB] transition-colors"
      >
        {useAddress ? "\u2190 Pick a neighborhood instead" : "Or enter a specific address for parcel-level detail \u2192"}
      </button>

      {/* Address input (when toggled) */}
      {useAddress && (
        <div>
          <div className="relative">
            <input
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter a Chicago address..."
              className="w-full bg-white border border-[#0C1B33]/10 px-5 py-4 pr-14 text-[#0C1B33] text-[15px] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB] transition-colors"
            />
            <button
              onClick={() => onGeocode(addressInput)}
              aria-label="Verify address"
              title="Verify address"
              disabled={isGeocoding || !addressInput.trim()}
              className={`absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center transition-colors cursor-pointer ${
                isGeocoding || !addressInput.trim() ? "text-[#0C1B33]/15" : "text-[#2563EB] hover:text-[#1d4ed8]"
              }`}
            >
              {isGeocoding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              onClick={() => onGeocode(addressInput)}
              disabled={isGeocoding || !addressInput.trim()}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 border font-mono-bureau text-[10px] tracking-[0.14em] uppercase transition-colors ${
                isGeocoding || !addressInput.trim()
                  ? "border-[#0C1B33]/8 text-[#0C1B33]/20 cursor-default"
                  : "border-[#2563EB] bg-[#2563EB] text-white hover:bg-[#1d4ed8] hover:border-[#1d4ed8] cursor-pointer"
              }`}
            >
              {isGeocoding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              Verify Address
            </button>
            <p className="font-mono-bureau text-[9px] text-[#0C1B33]/25 uppercase tracking-[0.15em] leading-relaxed">
              Verify a specific address to unlock parcel-level detail.
            </p>
          </div>

          {geocodeResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 bg-white border border-[#2563EB]/20 p-4 flex items-start gap-3"
            >
              <MapPin className="w-4 h-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[13px] text-[#0C1B33]/70 font-medium">{geocodeResult.display_name}</p>
                <p className="font-mono-bureau text-[10px] text-[#0C1B33]/30 mt-0.5">
                  Specific address &middot; Parcel-level detail
                </p>
              </div>
            </motion.div>
          )}

          {geocodeError && (
            <div className="mt-3 flex items-start gap-2 text-red-600 bg-red-50 border border-red-200 px-4 py-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="text-[13px]">{geocodeError}</span>
            </div>
          )}

          <p className="font-mono-bureau text-[10px] text-[#0C1B33]/25 mt-2">
            Tip: A specific address unlocks property PIN, assessed value, and zoning data.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Address Step ───────────────────────────────────────────────────

function AddressStep({
  addressInput,
  setAddressInput,
  geocodeResult,
  isGeocoding,
  geocodeError,
  onGeocode,
}: {
  addressInput: string;
  setAddressInput: (v: string) => void;
  geocodeResult: { lat: number; lon: number; display_name: string } | null;
  isGeocoding: boolean;
  geocodeError: string | null;
  onGeocode: () => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onGeocode();
    }
  };

  return (
    <div>
      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter a Chicago address..."
          className="w-full bg-white border border-[#0C1B33]/10 px-5 py-4 pr-14 text-[#0C1B33] text-[15px] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB] transition-colors"
        />
        <button
          onClick={() => onGeocode()}
          aria-label="Verify address"
          title="Verify address"
          disabled={isGeocoding || !addressInput.trim()}
          className={`absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center transition-colors cursor-pointer ${
            isGeocoding || !addressInput.trim()
              ? "text-[#0C1B33]/15"
              : "text-[#2563EB] hover:text-[#1d4ed8]"
          }`}
        >
          {isGeocoding ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
        </button>
      </div>

      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <button
          onClick={() => onGeocode()}
          disabled={isGeocoding || !addressInput.trim()}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 border font-mono-bureau text-[10px] tracking-[0.14em] uppercase transition-colors ${
            isGeocoding || !addressInput.trim()
              ? "border-[#0C1B33]/8 text-[#0C1B33]/20 cursor-default"
              : "border-[#2563EB] bg-[#2563EB] text-white hover:bg-[#1d4ed8] hover:border-[#1d4ed8] cursor-pointer"
          }`}
        >
          {isGeocoding ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Search className="w-3.5 h-3.5" />
          )}
          Verify Address
        </button>
        <p className="font-mono-bureau text-[9px] text-[#0C1B33]/25 uppercase tracking-[0.15em] leading-relaxed">
          Verify the address to unlock Next.
        </p>
      </div>

      {/* Geocode result */}
      {geocodeResult && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-4 bg-white border border-[#2563EB]/20 p-4 flex items-start gap-3"
        >
          <MapPin className="w-4 h-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-mono-bureau text-[10px] text-[#2563EB] uppercase tracking-[0.15em] block mb-1">
              Resolved Address
            </span>
            <p className="text-[#0C1B33] text-sm leading-relaxed">
              {geocodeResult.display_name}
            </p>
            <p className="font-mono-bureau text-[9px] text-[#0C1B33]/25 mt-1 tracking-wider">
              {geocodeResult.lat.toFixed(6)}, {geocodeResult.lon.toFixed(6)}
            </p>
          </div>
        </motion.div>
      )}

      {/* Geocode error */}
      {geocodeError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-4 bg-red-50 border border-red-200 p-4 flex items-start gap-3"
        >
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm">{geocodeError}</p>
        </motion.div>
      )}

      {/* Helper text */}
      <p className="mt-4 font-mono-bureau text-[9px] text-[#0C1B33]/25 uppercase tracking-[0.15em] leading-relaxed">
        Tip: Include street number for best results. Press Enter or verify address to continue.
      </p>
    </div>
  );
}

// ─── Project Intake Step ─────────────────────────────────────────────

function ProjectIntakeStep({
  wizardState,
  onChange,
  isOptional = false,
}: {
  wizardState: WizardState;
  onChange: (key: keyof WizardState, value: string | string[]) => void;
  isOptional?: boolean;
}) {
  const toggleNeed = (id: string) => {
    const current = wizardState.supportNeeded || [];
    const next = current.includes(id)
      ? current.filter((value) => value !== id)
      : id === "not-sure"
        ? ["not-sure"]
        : [...current.filter((value) => value !== "not-sure"), id];
    onChange("supportNeeded", next);
  };

  if (wizardState.reportType === "dev-feasibility") {
    return (
      <div className="space-y-8">
        <div className="border border-[#0C1B33]/8 bg-white px-4 py-3">
          <p className="text-[12px] text-[#0C1B33]/45 leading-relaxed">
            These questions are optional. Answer what you know, or skip ahead if you are still comparing sites.
          </p>
        </div>

        <IntakeField
          label="Project focus"
          helper="Choose the closest pathway for the vacant property or site."
          options={VACANCY_PROJECT_TYPE_OPTIONS}
          value={wizardState.projectType}
          onSelect={(value) => onChange("projectType", value)}
        />

        <IntakeField
          label="What would you like to create?"
          helper="This helps separate the site activity from the intended end use."
          options={PROPOSED_USE_OPTIONS}
          value={wizardState.proposedUse}
          onSelect={(value) => onChange("proposedUse", value)}
        />

        <div>
          <div className="flex items-center justify-between gap-4 mb-3">
            <label className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/45">
              What support would be most helpful?
            </label>
            <span className="font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#0C1B33]/25">
              Optional
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {SUPPORT_NEEDED_OPTIONS.map((option) => {
              const selected = wizardState.supportNeeded.includes(option.id);
              return (
                <button
                  key={option.id}
                  onClick={() => toggleNeed(option.id)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2.5 border font-mono-bureau text-[10px] tracking-[0.1em] uppercase transition-colors ${
                    selected
                      ? "bg-[#0C1B33] border-[#0C1B33] text-white"
                      : "bg-white border-[#0C1B33]/10 text-[#0C1B33]/45 hover:border-[#0C1B33]/20"
                  }`}
                >
                  {selected && <Check className="w-3 h-3" />}
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <IntakeField
        label="Project type"
        helper="Choose the closest project type. You can refine it later."
        options={Object.entries(PROJECT_TYPE_LABELS).map(([id, label]) => ({ id, label }))}
        value={wizardState.projectType}
        onSelect={(value) => onChange("projectType", value)}
        required={!isOptional}
      />

      <IntakeField
        label="Total project budget"
        helper="Use a range if the budget is still being scoped."
        options={[...BUDGET_RANGE_OPTIONS, { id: "skip", label: "Still estimating" }]}
        value={wizardState.budgetRange}
        onSelect={(value) => onChange("budgetRange", value)}
        required={!isOptional}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <IntakeField
          label="Funding already committed"
          options={FUNDING_COMMITTED_OPTIONS}
          value={wizardState.fundingCommitted}
          onSelect={(value) => onChange("fundingCommitted", value)}
        />
        <IntakeField
          label="Remaining funding gap"
          options={REMAINING_GAP_OPTIONS}
          value={wizardState.remainingGap}
          onSelect={(value) => onChange("remainingGap", value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <IntakeField
          label="Timeline"
          options={TIMELINE_OPTIONS}
          value={wizardState.timeline}
          onSelect={(value) => onChange("timeline", value)}
          required={!isOptional}
        />
        <IntakeField
          label="Own vs. lease"
          options={SITE_CONTROL_OPTIONS}
          value={wizardState.siteControl}
          onSelect={(value) => onChange("siteControl", value)}
          required={!isOptional}
        />
      </div>

      <IntakeField
        label="Jobs created or retained"
        options={JOBS_IMPACT_OPTIONS}
        value={wizardState.jobsImpact}
        onSelect={(value) => onChange("jobsImpact", value)}
      />

      <div>
        <div className="flex items-center justify-between gap-4 mb-3">
          <label className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/45">
            What support would be most helpful?
          </label>
          <span className="font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#0C1B33]/25">
            Select all that apply
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {SUPPORT_NEEDED_OPTIONS.map((option) => {
            const selected = wizardState.supportNeeded.includes(option.id);
            return (
              <button
                key={option.id}
                onClick={() => toggleNeed(option.id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2.5 border font-mono-bureau text-[10px] tracking-[0.1em] uppercase transition-colors ${
                  selected
                    ? "bg-[#0C1B33] border-[#0C1B33] text-white"
                    : "bg-white border-[#0C1B33]/10 text-[#0C1B33]/45 hover:border-[#0C1B33]/20"
                }`}
              >
                {selected && <Check className="w-3 h-3" />}
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border border-[#0C1B33]/8 bg-white px-4 py-3">
        <p className="text-[12px] text-[#0C1B33]/45 leading-relaxed">
          These answers help tailor the readiness checklist and next-step language.
          The report will not estimate award amounts or guarantee funding.
        </p>
      </div>
    </div>
  );
}

function IntakeField({
  label,
  helper,
  options,
  value,
  onSelect,
  required,
}: {
  label: string;
  helper?: string;
  options: { id: string; label: string }[];
  value: string;
  onSelect: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <label className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/45">
          {label}
        </label>
        {required && (
          <span className="font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#2563EB]/50">
            Required
          </span>
        )}
      </div>
      {helper && (
        <p className="text-[12px] text-[#0C1B33]/35 leading-relaxed mb-3">
          {helper}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map((option) => {
          const selected = value === option.id;
          return (
            <button
              key={option.id}
              onClick={() => onSelect(option.id)}
              className={`text-left border px-4 py-3 transition-colors ${
                selected
                  ? "bg-[#EFF3FB] border-[#2563EB]/45"
                  : "bg-white border-[#0C1B33]/8 hover:border-[#0C1B33]/18"
              }`}
            >
              <span className={`font-mono-bureau text-[10px] tracking-[0.08em] uppercase ${
                selected ? "text-[#0C1B33]" : "text-[#0C1B33]/50"
              }`}>
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Single Select Step ──────────────────────────────────────────────

function SingleSelectStep({
  stepId,
  options,
  value,
  onSelect,
}: {
  stepId: string;
  options: { id: string; label: string; description?: string }[];
  value: string;
  onSelect: (stepId: string, value: string) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((option, i) => {
        const isSelected = value === option.id;
        return (
          <motion.button
            key={option.id}
            onClick={() => onSelect(stepId, option.id)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.3,
              delay: i * 0.04,
              ease: "easeOut",
            }}
            className={`group relative w-full text-left cursor-pointer border transition-colors duration-150 ${
              isSelected
                ? "bg-[#EFF3FB] border-[#2563EB]/40"
                : "bg-white border-[#0C1B33]/8 hover:border-[#0C1B33]/15"
            }`}
          >
            {/* Left accent bar */}
            <div
              className={`absolute left-0 top-0 bottom-0 w-[3px] transition-colors duration-150 ${
                isSelected ? "bg-[#2563EB]" : "bg-transparent"
              }`}
            />

            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex-1 min-w-0">
                <span
                  className={`font-mono-bureau text-[11px] tracking-[0.08em] uppercase block ${
                    isSelected ? "text-[#0C1B33]" : "text-[#0C1B33]/50"
                  }`}
                >
                  {option.label}
                </span>
                {option.description && (
                  <span className="text-[#0C1B33]/35 text-[12px] mt-0.5 block">
                    {option.description}
                  </span>
                )}
              </div>

              <div
                className={`w-5 h-5 border flex items-center justify-center flex-shrink-0 ${
                  isSelected
                    ? "border-[#2563EB] bg-[#2563EB]"
                    : "border-[#0C1B33]/15 bg-transparent"
                }`}
              >
                {isSelected && (
                  <Check className="w-3 h-3 text-white" strokeWidth={2.5} />
                )}
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Combobox Step (searchable dropdown + custom input) ─────────────

function ComboboxStep({
  stepId,
  options,
  value,
  onSelect,
}: {
  stepId: string;
  options: { id: string; label: string; description?: string }[];
  value: string;
  onSelect: (stepId: string, value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = query
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          o.id.toLowerCase().includes(query.toLowerCase())
      )
    : options;

  const selectedLabel =
    options.find((o) => o.id === value)?.label || (value && value !== "skip" ? value : "");

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <input
          type="text"
          value={open ? query : selectedLabel}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          placeholder="Search or type your industry..."
          className="w-full h-14 bg-white border border-[#0C1B33]/12 px-5 pr-12 text-[#0C1B33] text-sm placeholder:text-[#0C1B33]/30 focus:outline-none focus:border-[#2563EB]/50 focus:ring-2 focus:ring-[#2563EB]/10 font-mono-bureau tracking-wide transition-all"
        />
        <button
          onClick={() => setOpen(!open)}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[#0C1B33]/30"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={open ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute z-30 w-full mt-1 bg-white border border-[#0C1B33]/10 shadow-xl max-h-64 overflow-y-auto">
          {filtered.map((option) => {
            const isSelected = value === option.id;
            return (
              <button
                key={option.id}
                onClick={() => {
                  onSelect(stepId, option.id);
                  setQuery("");
                  setOpen(false);
                }}
                className={`w-full text-left px-5 py-3 border-b border-[#0C1B33]/5 last:border-b-0 transition-colors ${
                  isSelected
                    ? "bg-[#EFF3FB]"
                    : "hover:bg-[#0C1B33]/[0.02]"
                }`}
              >
                <span
                  className={`font-mono-bureau text-[11px] tracking-[0.08em] uppercase ${
                    isSelected ? "text-[#2563EB]" : "text-[#0C1B33]/60"
                  }`}
                >
                  {option.label}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && query && (
            <button
              onClick={() => {
                onSelect(stepId, query);
                setOpen(false);
                setQuery("");
              }}
              className="w-full text-left px-5 py-3 hover:bg-[#EFF3FB] transition-colors"
            >
              <span className="font-mono-bureau text-[11px] tracking-[0.08em] text-[#2563EB]">
                Use &ldquo;{query}&rdquo;
              </span>
              <span className="text-[#0C1B33]/30 text-[11px] block mt-0.5">
                Custom industry
              </span>
            </button>
          )}
        </div>
      )}

      {/* Click outside to close */}
      {open && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => {
            setOpen(false);
            setQuery("");
          }}
        />
      )}
    </div>
  );
}

// ─── Multi Select Step ───────────────────────────────────────────────

function MultiSelectStep({
  stepId,
  options,
  value,
  onToggle,
  onSetAll,
}: {
  stepId: string;
  options: { id: string; label: string }[];
  value: string[];
  onToggle: (stepId: string, value: string) => void;
  onSetAll: (stepId: string, values: string[]) => void;
}) {
  const selectableOptions = options.filter((option) => option.id !== "none-yet");
  const allSelected =
    selectableOptions.length > 0 &&
    selectableOptions.every((option) => value.includes(option.id));

  return (
    <div className="space-y-4">
      {selectableOptions.length > 1 && (
        <button
          onClick={() =>
            onSetAll(
              stepId,
              allSelected ? [] : selectableOptions.map((option) => option.id)
            )
          }
          className="inline-flex items-center gap-2 border border-[#0C1B33]/12 bg-white px-3 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45 transition-colors hover:border-[#2563EB]/30 hover:text-[#2563EB]"
        >
          <Check className="w-3 h-3" />
          {allSelected ? "Clear all" : "Select all"}
        </button>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((option, i) => {
          const isSelected = value.includes(option.id);
          return (
            <motion.button
              key={option.id}
              onClick={() => onToggle(stepId, option.id)}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                duration: 0.25,
                delay: i * 0.03,
                ease: "easeOut",
              }}
              className={`inline-flex items-center gap-2 px-4 py-2.5 border cursor-pointer transition-all duration-150 font-mono-bureau text-[11px] tracking-[0.08em] uppercase ${
                isSelected
                  ? "bg-[#2563EB] border-[#2563EB] text-white"
                  : "bg-white border-[#0C1B33]/12 text-[#0C1B33]/50 hover:border-[#0C1B33]/25 hover:text-[#0C1B33]/70"
              }`}
            >
              {isSelected && (
                <Check className="w-3 h-3" strokeWidth={2.5} />
              )}
              {option.label}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Review Step ─────────────────────────────────────────────────────

function ReviewStep({
  wizardState,
  steps,
  isGenerating,
  onGenerate,
}: {
  wizardState: WizardState;
  steps: WizardStepConfig[];
  isGenerating: boolean;
  onGenerate: () => void;
}) {
  // Find the report type label
  const reportTypeOption = REPORT_TYPE_OPTIONS.find(
    (o) => o.id === wizardState.reportType
  );
  const generateLabel =
    wizardState.reportType === "dev-feasibility"
      ? "Generate Vacancy Report"
      : "Generate Incentive Report";

  return (
    <div>
      {/* Report type header */}
      <div className="bg-white border border-[#0C1B33]/10 p-5 mb-4">
        <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-2">
          Report Type
        </span>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{reportTypeOption?.icon}</span>
          <span className="font-mono-bureau text-[12px] tracking-[0.08em] uppercase text-[#0C1B33]">
            {reportTypeOption?.title}
          </span>
        </div>
      </div>

      <p className="mb-5 text-sm text-[#0C1B33]/45 leading-relaxed">
        We&apos;ll use these answers to check incentive zones, zoning, property
        context, likely programs, and next steps.
      </p>

      {/* Answer summary */}
      <div className="space-y-3 mb-8">
        {steps
          .filter((s) => s.inputType !== "report-type" && s.inputType !== "review")
          .map((step) => {
            const displayValue = getDisplayValueForStep(wizardState, step);
            if (!displayValue) return null;

            return (
              <div
                key={step.id}
                className="bg-white border border-[#0C1B33]/10 p-5"
              >
                <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-2">
                  {step.title}
                </span>
                <p className="text-[#0C1B33] text-sm">{displayValue}</p>
              </div>
            );
          })}
      </div>

      {/* Generate button */}
      <button
        onClick={onGenerate}
        disabled={isGenerating}
        className="w-full inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-6 py-4 hover:bg-[#1d4ed8] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating Report...
          </>
        ) : (
          <>
            <FileText className="w-4 h-4" />
            {generateLabel}
          </>
        )}
      </button>
    </div>
  );
}

// ─── Verdict Card Component ─────────────────────────────────────────

function VerdictCard({ verdict }: { verdict: NonNullable<GeneratedReport["verdict"]> }) {
  const signalLabel = verdict.signal === "strong" ? "Strong Coverage" : verdict.signal === "moderate" ? "Moderate Coverage" : "Limited Coverage";

  return (
    <div className="mb-12">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-2 h-2 rounded-full bg-[#0C1B33]" />
        <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/40">
          {signalLabel}
        </span>
      </div>
      <h3 className="font-editorial text-[22px] sm:text-[26px] text-[#0C1B33] leading-snug mb-2">
        {verdict.headline}
      </h3>
      <p className="text-[#0C1B33]/45 text-[14px] leading-relaxed mb-5 max-w-prose">
        {verdict.subheadline}
      </p>
      {verdict.topReasons.length > 0 && (
        <div className="border-l border-[#0C1B33]/10 pl-5 space-y-2">
          {verdict.topReasons.map((reason, i) => (
            <p key={i} className="text-[13px] text-[#0C1B33]/50 leading-relaxed">
              {reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Executive Summary Component ─────────────────────────────────────

function ExecutiveSummarySection({
  summary,
  isEditing,
  editedText,
  onToggleEdit,
  onTextChange,
}: {
  summary: ExecutiveSummary;
  isEditing: boolean;
  editedText: string;
  onToggleEdit: () => void;
  onTextChange: (text: string) => void;
}) {
  const actionIcons: Record<string, typeof Phone> = {
    call: Phone,
    email: Mail,
    book: Calendar,
  };

  return (
    <div className="border border-[#0C1B33]/8 p-6 sm:p-8 mb-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <span className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/50">
          Executive Summary
        </span>
        <button
          onClick={onToggleEdit}
          className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30 hover:text-[#0C1B33]/60 transition-colors cursor-pointer print:hidden"
        >
          {isEditing ? "Done" : "Edit"}
        </button>
      </div>

      {/* Top Programs — bullet points */}
      {summary.topPrograms.length > 0 && (
        <div className="mb-6">
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-3">
            Top Programs for Your Location
          </span>
          <ul className="space-y-2">
            {summary.topPrograms.map((prog) => {
              const badge = CONFIDENCE_BADGE[prog.confidence] || CONFIDENCE_BADGE.worth_exploring;
              return (
                <li
                  key={prog.programId}
                  className="flex items-baseline gap-3"
                >
                  <span className="text-[#0C1B33]/20 flex-shrink-0 text-[10px]">&bull;</span>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 min-w-0">
                    <span className="text-[14px] font-semibold text-[#0C1B33]">
                      {prog.name}
                    </span>
                    <span className="relative group/badge">
                      <span className={`font-mono-bureau text-[8px] tracking-[0.1em] uppercase px-2 py-0.5 border cursor-help ${badge.bg} ${badge.text} ${badge.border}`}>
                        {prog.confidenceLabel}
                      </span>
                      {prog.whyOneLine && (
                        <span className="invisible group-hover/badge:visible absolute left-0 top-full mt-1 z-10 bg-white border border-[#0C1B33]/10 shadow-md px-3 py-2 text-[11px] text-[#0C1B33]/60 leading-relaxed w-64 font-sans normal-case tracking-normal">
                          {prog.whyOneLine}
                        </span>
                      )}
                    </span>
                    {prog.benefitRange && (
                      <span className="font-mono-bureau text-[11px] text-[#0C1B33]/40">
                        {prog.benefitRange}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Top Actions — only show action-type icons */}
      {summary.topActions.length > 0 && (
        <div className="mb-6">
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-3">
            Best Next Steps
          </span>
          <ul className="space-y-1.5">
            {summary.topActions.map((action, i) => {
              const Icon = actionIcons[action.type];
              return (
                <li
                  key={i}
                  className="flex items-center gap-2.5 text-[13px] text-[#0C1B33]/60"
                >
                  {Icon ? (
                    <Icon className="w-3 h-3 text-[#0C1B33]/30 flex-shrink-0" />
                  ) : (
                    <span className="text-[#0C1B33]/15 flex-shrink-0 text-[10px]">&bull;</span>
                  )}
                  {action.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Why These Matter — editable */}
      {isEditing ? (
        <textarea
          value={editedText}
          onChange={(e) => onTextChange(e.target.value)}
          className="w-full text-[#0C1B33]/60 text-[14px] leading-[1.7] bg-[#0C1B33]/[0.02] border border-[#0C1B33]/10 p-3 resize-y min-h-[80px] focus:outline-none focus:border-[#0C1B33]/20"
          rows={4}
        />
      ) : (
        <p className="text-[#0C1B33]/60 text-[14px] leading-[1.7]">
          {editedText || summary.whyTheseMatter}
        </p>
      )}
    </div>
  );
}

// ─── Action Roadmap Section ──────────────────────────────────────────

function ActionRoadmapSection({
  items,
}: {
  items: ActionRoadmapItem[];
}) {
  const doThisWeek = items.filter((i) => i.tier === "do-this-week");
  const worthExploring = items.filter((i) => i.tier === "worth-exploring");

  return (
    <div className="mb-10">
      <div className="mb-6">
        <span className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/50 block mb-1">
          Your Next Steps
        </span>
        <p className="text-[#0C1B33]/35 text-[13px] leading-relaxed max-w-prose">
          Prioritized actions to move forward with your eligible programs.
        </p>
      </div>

      {/* Tier 1: Do This Week */}
      {doThisWeek.length > 0 && (
        <div className="mb-8">
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/40 block mb-3">
            Do This Week
          </span>
          <div className="space-y-4">
            {doThisWeek.map((item, i) => (
              <div
                key={i}
                className="border border-[#0C1B33]/8 p-5"
              >
                <div className="flex items-start gap-3 mb-2">
                  <span className="font-mono-bureau text-[11px] text-[#0C1B33]/30 flex-shrink-0 w-5 text-right pt-0.5">
                    {i + 1}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[14px] font-semibold text-[#0C1B33] block">
                      {item.label}
                    </span>
                    <span className="text-[12px] text-[#0C1B33]/40 block mt-0.5">
                      {item.description}
                    </span>
                  </div>
                </div>

                {/* Contact card */}
                {item.contact && (
                  <div className="ml-8 mt-3 border-l border-[#0C1B33]/8 pl-4 space-y-1.5">
                    <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/25 block">
                      {item.contact.role || "Contact"}
                    </span>
                    <span className="text-[13px] text-[#0C1B33]/60 font-medium block">
                      {item.contact.agency}
                    </span>
                    <div className="flex flex-wrap gap-3">
                      {item.contact.phone && (
                        <a
                          href={`tel:${item.contact.phone}`}
                          className="inline-flex items-center gap-1.5 text-[12px] text-[#0C1B33]/50 hover:text-[#0C1B33] transition-colors"
                        >
                          <Phone className="w-3 h-3" />
                          {item.contact.phone}
                        </a>
                      )}
                      {item.contact.email && (
                        <a
                          href={`mailto:${item.contact.email}`}
                          className="inline-flex items-center gap-1.5 text-[12px] text-[#0C1B33]/50 hover:text-[#0C1B33] transition-colors"
                        >
                          <Mail className="w-3 h-3" />
                          {item.contact.email}
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Call script */}
                {item.callScript && (
                  <div className="ml-8 mt-3 border-l border-[#0C1B33]/8 pl-4">
                    <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 block mb-1">
                      What to say
                    </span>
                    <p className="text-[12px] text-[#0C1B33]/50 italic leading-relaxed">
                      {item.callScript}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tier 2: Worth Exploring */}
      {worthExploring.length > 0 && (
        <div>
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-3">
            Worth Exploring
          </span>
          <div className="space-y-0 divide-y divide-[#0C1B33]/6">
            {worthExploring.map((item, i) => (
              <div
                key={i}
                className="py-4 first:pt-0 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <span className="text-[13px] text-[#0C1B33]/60 font-medium block">
                    {item.programName || item.label}
                  </span>
                  <span className="text-[11px] text-[#0C1B33]/35 block mt-0.5">
                    {item.description}
                  </span>
                </div>
                {item.contact?.phone && (
                  <a
                    href={`tel:${item.contact.phone}`}
                    className="flex items-center gap-1 text-[10px] font-mono-bureau text-[#0C1B33]/40 hover:text-[#0C1B33] transition-colors flex-shrink-0"
                  >
                    <Phone className="w-3 h-3" />
                    {item.contact.phone}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Market Comparison Bar ───────────────────────────────────────────

function ComparisonBar({ label, locationFormatted, cityFormatted, pct }: {
  label: string;
  locationFormatted: string;
  cityFormatted: string;
  pct: number;
}) {
  const barWidth = Math.min(pct, 200); // cap visual at 200%
  const cityBarWidth = 100; // city is always the baseline
  return (
    <div className="py-4 first:pt-0">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[#0C1B33] text-[13px] font-semibold">{label}</span>
        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/40">{pct}% of city median</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <span className="font-mono-bureau text-[9px] tracking-[0.1em] text-[#0C1B33]/35 w-14 text-right flex-shrink-0">Location</span>
          <div className="flex-1 bg-[#0C1B33]/[0.04] h-5 relative">
            <div className="h-full bg-[#0C1B33]/15 transition-all" style={{ width: `${Math.min(barWidth, 100)}%` }} />
          </div>
          <span className="font-mono-bureau text-[11px] text-[#0C1B33]/70 w-20 flex-shrink-0">{locationFormatted}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono-bureau text-[9px] tracking-[0.1em] text-[#0C1B33]/25 w-14 text-right flex-shrink-0">City</span>
          <div className="flex-1 bg-[#0C1B33]/[0.04] h-5 relative">
            <div className="h-full bg-[#0C1B33]/[0.06] transition-all" style={{ width: `${cityBarWidth}%` }} />
          </div>
          <span className="font-mono-bureau text-[11px] text-[#0C1B33]/40 w-20 flex-shrink-0">{cityFormatted}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Freshness Badge ─────────────────────────────────────────────────

function FreshnessBadge({ lastVerifiedAt, isStale }: { lastVerifiedAt: string | null; isStale?: boolean }) {
  if (!lastVerifiedAt) return null;
  const d = new Date(lastVerifiedAt);
  const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return (
    <span className={`font-mono-bureau text-[8px] tracking-[0.1em] uppercase ${isStale ? "text-[#0C1B33]/25" : "text-[#0C1B33]/35"}`}>
      {isStale ? `Unverified since ${label}` : `Verified ${label}`}
    </span>
  );
}

// ─── Comparison Summary ─────────────────────────────────────────────

function ComparisonSummary({
  reportA,
  reportB,
}: {
  reportA: GeneratedReport;
  reportB: GeneratedReport;
}) {
  const countZones = (r: GeneratedReport) =>
    r.sections?.reduce((n, s) => n + (s.items?.length || 0), 0) || 0;
  const countPrograms = (r: GeneratedReport) =>
    r.sections?.reduce(
      (n, s) => n + (s.items?.filter((i) => i.programId).length || 0),
      0
    ) || 0;

  const metrics = [
    {
      label: "Verdict",
      a: reportA.verdict?.signal || "—",
      b: reportB.verdict?.signal || "—",
    },
    {
      label: "Zones",
      a: String(countZones(reportA)),
      b: String(countZones(reportB)),
    },
    {
      label: "Programs",
      a: String(countPrograms(reportA)),
      b: String(countPrograms(reportB)),
    },
  ];

  const betterSide = (m: { a: string; b: string; label: string }) => {
    if (m.label === "Verdict") {
      const order = ["strong", "moderate", "limited", "none"];
      const ia = order.indexOf(m.a);
      const ib = order.indexOf(m.b);
      if (ia >= 0 && ib >= 0 && ia !== ib) return ia < ib ? "a" : "b";
      return null;
    }
    const na = parseInt(m.a.replace(/[^0-9]/g, ""), 10);
    const nb = parseInt(m.b.replace(/[^0-9]/g, ""), 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na > nb ? "a" : "b";
    return null;
  };

  return (
    <div className="bg-white border border-[#0C1B33]/8 mb-6">
      <div className="px-6 py-4 border-b border-[#0C1B33]/8">
        <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30">
          Side-by-Side Comparison
        </span>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr] text-center">
        {/* Header row */}
        <div className="px-4 py-3 border-b border-[#0C1B33]/6 font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30">
          Metric
        </div>
        <div className="px-4 py-3 border-b border-l border-[#0C1B33]/6 font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/50">
          {reportA.title?.replace("Incentive Report: ", "").slice(0, 30) || "Address A"}
        </div>
        <div className="px-4 py-3 border-b border-l border-[#0C1B33]/6 font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/50">
          {reportB.title?.replace("Incentive Report: ", "").slice(0, 30) || "Address B"}
        </div>
        {/* Metric rows */}
        {metrics.map((m) => {
          const better = betterSide(m);
          return (
            <div key={m.label} className="contents">
              <div className="px-4 py-3 border-b border-[#0C1B33]/4 font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/40 text-left">
                {m.label}
              </div>
              <div
                className={`px-4 py-3 border-b border-l border-[#0C1B33]/4 font-editorial text-[18px] text-[#0C1B33]/70 ${
                  better === "a" ? "border-l-2 border-l-[#0C1B33]/20" : ""
                }`}
              >
                {m.a}
              </div>
              <div
                className={`px-4 py-3 border-b border-l border-[#0C1B33]/4 font-editorial text-[18px] text-[#0C1B33]/70 ${
                  better === "b" ? "border-l-2 border-l-[#0C1B33]/20" : ""
                }`}
              >
                {m.b}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Comparison Display ─────────────────────────────────────────────

function ComparisonDisplay({
  reportA,
  reportB,
  onStartOver,
  wizardState: _reportWizardState,
}: {
  reportA: GeneratedReport;
  reportB: GeneratedReport;
  onStartOver: () => void;
  wizardState?: WizardState;
}) {
  return (
    <div className="bg-[#FAF9F6] min-h-screen py-10 px-4">
      <div className="mx-auto max-w-[1600px]">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-3">
            <div className="accent-bar" />
            <span className="font-mono-bureau text-[9px] tracking-[0.3em] uppercase text-[#0C1B33]/25">
              Location Comparison
            </span>
            <div className="accent-bar" />
          </div>
          <h1 className="font-editorial text-2xl sm:text-3xl text-[#0C1B33] mb-4">
            Side-by-Side Analysis
          </h1>
          <button
            onClick={onStartOver}
            className="inline-flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/40 hover:text-[#0C1B33] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            Start Over
          </button>
        </div>

        {/* Summary card */}
        <div className="mx-auto max-w-[850px] mb-8">
          <ComparisonSummary reportA={reportA} reportB={reportB} />
        </div>

        {/* Two reports side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ReportDisplay
            report={reportA}
            onStartOver={onStartOver}
            compact
          />
          <ReportDisplay
            report={reportB}
            onStartOver={onStartOver}
            compact
          />
        </div>
      </div>
    </div>
  );
}

// ─── Report Display ──────────────────────────────────────────────────

export function ReportDisplay({
  report,
  onStartOver,
  onRefine,
  isInstantMode,
  wizardState: reportWizardState,
  compact,
  onCompare,
  compareMode,
  compareAddressInput,
  setCompareAddressInput,
  compareGeocoding,
  onCompareGeocode,
  compareGeoResult,
}: {
  report: GeneratedReport;
  onStartOver: () => void;
  onRefine?: () => void;
  isInstantMode?: boolean;
  wizardState?: WizardState;
  compact?: boolean;
  onCompare?: () => void;
  compareMode?: boolean;
  compareAddressInput?: string;
  setCompareAddressInput?: (v: string) => void;
  compareGeocoding?: boolean;
  onCompareGeocode?: () => void;
  compareGeoResult?: { lat: number; lon: number; display_name: string } | null;
}) {
  const { status } = useSession();
  const [linkCopied, setLinkCopied] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [isExportingVacancySpreadsheet, setIsExportingVacancySpreadsheet] =
    useState(false);
  const [isLoadingVacancySpreadsheet, setIsLoadingVacancySpreadsheet] =
    useState(false);
  const [vacancySpreadsheetFeatures, setVacancySpreadsheetFeatures] =
    useState<VacancySpreadsheetFeature[] | null>(null);
  const [vacancySpreadsheetError, setVacancySpreadsheetError] =
    useState<string | null>(null);
  const [editedSummaryText, setEditedSummaryText] = useState(
    report.executiveSummary?.whyTheseMatter || ""
  );

  // ── TOC ──
  const sectionToAnchor = (title: string) =>
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const tocEntries = useMemo(() => {
    const entries: { label: string; anchor: string }[] = [];
    if (report.verdict) entries.push({ label: "Verdict", anchor: "verdict" });
    if (report.executiveSummary) entries.push({ label: "Executive Summary", anchor: "executive-summary" });
    if (report.sections) {
      for (const s of report.sections) {
        entries.push({ label: s.title, anchor: sectionToAnchor(s.title) });
      }
    }
    if (report.actionRoadmap && report.actionRoadmap.length > 0) entries.push({ label: "Your Next Steps", anchor: "action-roadmap" });
    if (report.recommendedActions && report.recommendedActions.length > 0) entries.push({ label: "Recommended Actions", anchor: "recommended-actions" });
    if (report.dataSources && report.dataSources.length > 0) entries.push({ label: "Data Sources", anchor: "data-sources" });
    return entries;
  }, [report]);

  const [downloadGateOpen, setDownloadGateOpen] = useState(false);

  const handlePrint = () => {
    setDownloadGateOpen(true);
  };

  const handleDownloadAfterCapture = () => {
    generateReportPdf(report);
    setDownloadGateOpen(false);
  };

  const handleShareReport = useCallback(() => {
    if (!reportWizardState) return;
    const encoded = encodeWizardState(reportWizardState);
    const url = `${window.location.origin}/report?${encoded}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    });
  }, [reportWizardState]);

  const handleSaveReport = useCallback(() => {
    if (status === "authenticated") {
      setSaveModalOpen(true);
      return;
    }

    storePendingReport({ reportData: report, wizardState: reportWizardState });
    window.location.assign(
      `/login?callbackUrl=${encodeURIComponent("/workspace?savePending=1")}`
    );
  }, [report, reportWizardState, status]);

  const priorityBadge: Record<string, { label: string; classes: string }> = {
    high: {
      label: "High Priority",
      classes: "bg-[#0C1B33]/[0.06] text-[#0C1B33]/60 border border-[#0C1B33]/10",
    },
    medium: {
      label: "Medium",
      classes: "bg-[#0C1B33]/[0.03] text-[#0C1B33]/40 border border-[#0C1B33]/8",
    },
    low: {
      label: "Low",
      classes: "bg-[#0C1B33]/[0.02] text-[#0C1B33]/30 border border-[#0C1B33]/5",
    },
  };

  const formattedDate = new Date(report.generatedAt).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric" }
  );

  const reportTypeLabels: Record<string, string> = {
    "site-incentives": "Site Incentive Analysis",
    "dev-feasibility": "Vacancy Analysis",
    // Legacy
    "location-incentives": "Site Incentive Analysis",
    "best-location": "Vacancy Analysis",
    "program-explorer": "Program Explorer Report",
    "developer-analysis": "Developer Analysis Report",
  };
  const isVacancyReport =
    report.reportType === "dev-feasibility" ||
    report.reportType === "best-location" ||
    report.title.toLowerCase().includes("vacancy");
  const vacancySpreadsheetLocale =
    isVacancyReport && reportWizardState?.neighborhood
      ? reportWizardState.neighborhood.trim()
      : "";

  useEffect(() => {
    if (!vacancySpreadsheetLocale) {
      setVacancySpreadsheetFeatures(null);
      setVacancySpreadsheetError(null);
      setIsLoadingVacancySpreadsheet(false);
      return;
    }

    const controller = new AbortController();

    async function loadVacancySpreadsheet() {
      setIsLoadingVacancySpreadsheet(true);
      setVacancySpreadsheetError(null);
      try {
        const res = await fetch(
          `/api/vacant?communityArea=${encodeURIComponent(vacancySpreadsheetLocale)}&limit=10000`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error("Vacancy spreadsheet unavailable");

        const data = (await res.json()) as {
          features?: VacancySpreadsheetFeature[];
        };
        setVacancySpreadsheetFeatures(data.features ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[report] vacancy spreadsheet load failed:", err);
        setVacancySpreadsheetFeatures(null);
        setVacancySpreadsheetError("Vacancy spreadsheet could not be loaded.");
      } finally {
        setIsLoadingVacancySpreadsheet(false);
      }
    }

    loadVacancySpreadsheet();

    return () => controller.abort();
  }, [vacancySpreadsheetLocale]);

  const handleVacancySpreadsheetExport = useCallback(async () => {
    if (!vacancySpreadsheetLocale) return;

    setIsExportingVacancySpreadsheet(true);
    try {
      let features = vacancySpreadsheetFeatures;
      if (!features) {
        const res = await fetch(
          `/api/vacant?communityArea=${encodeURIComponent(vacancySpreadsheetLocale)}&limit=10000`
        );
        if (!res.ok) throw new Error("Vacancy export failed");

        const data = (await res.json()) as {
          features?: VacancySpreadsheetFeature[];
        };
        features = data.features ?? [];
        setVacancySpreadsheetFeatures(features);
      }

      downloadCsv(
        buildVacancySpreadsheetCsv(features),
        `vacant-properties-${slugifyFilePart(vacancySpreadsheetLocale)}-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch (err) {
      console.error("[report] vacancy spreadsheet export failed:", err);
    } finally {
      setIsExportingVacancySpreadsheet(false);
    }
  }, [vacancySpreadsheetFeatures, vacancySpreadsheetLocale]);

  const vacancySpreadsheetStats = useMemo(() => {
    const features = vacancySpreadsheetFeatures ?? [];
    return {
      total: features.length,
      land: features.filter((feature) => feature.properties?.propertyType === "vacant_land").length,
      buildings: features.filter((feature) => feature.properties?.propertyType === "vacant_building").length,
      cityOwned: features.filter((feature) => feature.properties?.ownerType === "city_public").length,
    };
  }, [vacancySpreadsheetFeatures]);

  if (vacancySpreadsheetLocale && !compact) {
    const features = vacancySpreadsheetFeatures ?? [];

    return (
      <motion.div {...fadeIn}>
        <div className="min-h-screen bg-[#F5F5F0] py-4 sm:py-8 px-2 sm:px-6 print:bg-white">
          <div className="mx-auto max-w-[1180px] bg-white shadow-xl print:shadow-none">
            <div className="bg-[#0C1B33] px-5 sm:px-12 md:px-16 pt-12 pb-10">
              <p className="font-mono-bureau text-[9px] tracking-[0.35em] uppercase text-white/40 mb-5">
                Chicago Site Incentive Map
              </p>
              <h1 className="font-editorial text-3xl sm:text-4xl lg:text-[42px] text-white leading-tight mb-3">
                Vacancy Spreadsheet — {vacancySpreadsheetLocale}
              </h1>
              <p className="text-white/50 text-[15px] leading-relaxed max-w-xl mb-6">
                Vacant-property addresses and site context for the selected Chicago community area.
              </p>
              <div className="w-10 h-[3px] bg-white/30" />
            </div>

            <div className="px-5 sm:px-12 md:px-16 py-5 border-b border-[#0C1B33]/8 flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Date
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {formattedDate}
                </span>
              </div>
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Output
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  Vacant Property Spreadsheet
                </span>
              </div>
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Locale
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {vacancySpreadsheetLocale}
                </span>
              </div>
            </div>

            <div className="px-5 sm:px-12 md:px-16 py-10">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#0C1B33]/8 mb-8">
                {[
                  ["Properties", isLoadingVacancySpreadsheet ? "Loading" : vacancySpreadsheetStats.total.toLocaleString()],
                  ["Vacant land", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.land.toLocaleString()],
                  ["Buildings", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.buildings.toLocaleString()],
                  ["City / public", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.cityOwned.toLocaleString()],
                ].map(([label, value]) => (
                  <div key={label} className="bg-[#FAF9F6] px-4 py-4">
                    <span className="font-mono-bureau text-[8px] tracking-[0.18em] uppercase text-[#0C1B33]/25 block mb-1">
                      {label}
                    </span>
                    <span className="font-mono-bureau text-[17px] text-[#0C1B33]/75">
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
                <div>
                  <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33] mb-2">
                    Vacant Property Addresses
                  </h2>
                  <p className="text-[#0C1B33]/40 text-[13px] leading-relaxed max-w-2xl">
                    Download the CSV to share, filter, or continue analysis in a spreadsheet tool.
                  </p>
                </div>
                <button
                  onClick={handleVacancySpreadsheetExport}
                  disabled={isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet}
                  className="inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-6 py-3 hover:bg-[#0C1B33]/80 disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer"
                >
                  {isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileText className="w-3.5 h-3.5" />
                  )}
                  Download CSV
                </button>
              </div>

              {vacancySpreadsheetError && (
                <div className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 mb-5">
                  {vacancySpreadsheetError}
                </div>
              )}

              <div className="border border-[#0C1B33]/8 overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-[12px]">
                  <thead className="bg-[#0C1B33]/[0.03]">
                    <tr>
                      {[
                        "Address",
                        "Type",
                        "Ward",
                        "Community Area",
                        "Zoning",
                        "Sq Ft",
                        "Owner",
                        "Owner Type",
                        "Zones",
                        "Action",
                      ].map((heading) => (
                        <th
                          key={heading}
                          className="px-3 py-3 font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#0C1B33]/35"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#0C1B33]/5">
                    {isLoadingVacancySpreadsheet ? (
                      <tr>
                        <td colSpan={10} className="px-3 py-8 text-center text-[#0C1B33]/35">
                          Loading vacant properties...
                        </td>
                      </tr>
                    ) : features.length > 0 ? (
                      features.map((feature, rowIndex) => {
                        const property = feature.properties ?? {};
                        return (
                          <tr key={`${property.address ?? "property"}-${rowIndex}`} className="hover:bg-[#FAF9F6]">
                            <td className="px-3 py-3 text-[#0C1B33]/75 font-medium">
                              {String(property.address ?? "Unknown address")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/50">
                              {property.propertyType === "vacant_land" ? "Land" : property.propertyType === "vacant_building" ? "Building" : String(property.propertyType ?? "")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45">
                              {String(property.ward ?? "")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45">
                              {String(property.communityArea ?? "")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45">
                              {String(property.zoningClass ?? "")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45">
                              {Number(property.squareFeet ?? 0).toLocaleString()}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45 max-w-[220px] truncate">
                              {String(property.ownerName ?? "")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45">
                              {String(property.ownerType ?? "")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45 max-w-[260px] truncate">
                              {zoneMatchesToText(property.zoneMatches)}
                            </td>
                            <td className="px-3 py-3">
                              <a
                                href={buildIncentiveAnalysisUrl(feature)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 whitespace-nowrap border border-[#2563EB]/25 px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB] transition-colors hover:bg-[#2563EB]/5 hover:border-[#2563EB]/45"
                              >
                                <ArrowRight className="w-3 h-3" />
                                Run Analysis
                              </a>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={10} className="px-3 py-8 text-center text-[#0C1B33]/35">
                          No vacant properties found for this locale.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-[1180px] print:hidden mt-8">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={handleVacancySpreadsheetExport}
                disabled={isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#0C1B33]/80 disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer shadow-md"
              >
                {isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileText className="w-3.5 h-3.5" />
                )}
                Download CSV
              </button>
              <button
                onClick={handleSaveReport}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#1d4ed8] transition-colors cursor-pointer shadow-md"
              >
                <FileText className="w-3.5 h-3.5" />
                Save Report
              </button>
              <button
                onClick={() => setEmailDialogOpen(true)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#2563EB]/30 text-[#2563EB] font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#2563EB]/5 hover:border-[#2563EB]/50 transition-colors cursor-pointer shadow-md"
              >
                <Mail className="w-3.5 h-3.5" />
                Email This to Me
              </button>
              {reportWizardState && (
                <button
                  onClick={handleShareReport}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
                >
                  {linkCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Link Copied!
                    </>
                  ) : (
                    <>
                      <Link2 className="w-3.5 h-3.5" />
                      Share Spreadsheet
                    </>
                  )}
                </button>
              )}
              {!compact && onCompare && !compareMode && (
                <button
                  onClick={onCompare}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Compare Neighborhoods
                </button>
              )}
              <button
                onClick={onStartOver}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                New Search
              </button>
            </div>

            {compareMode && !compareGeoResult && (
              <div className="mt-5 mx-auto max-w-md">
                <label className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-2">
                  Enter a neighborhood or address to compare
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={compareAddressInput || ""}
                    onChange={(e) => setCompareAddressInput?.(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") onCompareGeocode?.(); }}
                    placeholder="e.g. 200 N LaSalle St, Chicago"
                    className="flex-1 px-4 py-3 bg-white border border-[#0C1B33]/15 text-[13px] text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#0C1B33]/30 font-mono-bureau"
                  />
                  <button
                    onClick={onCompareGeocode}
                    disabled={compareGeocoding || !compareAddressInput?.trim()}
                    className="px-5 py-3 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase hover:bg-[#0C1B33]/80 transition-colors disabled:opacity-30 cursor-pointer"
                  >
                    {compareGeocoding ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {emailDialogOpen && (
          <EmailReportModal
            report={report}
            onClose={() => setEmailDialogOpen(false)}
          />
        )}
        {saveModalOpen && (
          <SaveReportModal
            reportData={report}
            wizardState={reportWizardState}
            onClose={() => setSaveModalOpen(false)}
          />
        )}
      </motion.div>
    );
  }

  // Section numbering offset: if exec summary exists, content sections start at 02
  const hasExecSummary = !!report.executiveSummary;
  const sectionOffset = (report.summary ? 1 : 0) + (hasExecSummary ? 1 : 0);

  return (
    <motion.div {...fadeIn}>
      {/* ── Outer wrapper: off-white background ── */}
      <div className={`report-document ${compact ? "bg-transparent py-0 px-0" : "bg-[#F5F5F0] py-4 sm:py-8 px-2 sm:px-6"} print:bg-white print:p-0`}>
        {/* ── Document ── */}
        <div className={`mx-auto ${compact ? "max-w-none" : "max-w-[850px]"} bg-white shadow-xl print:shadow-none`}>
          {/* ── Cover / Header Bar ── */}
          <div className={`report-cover bg-[#0C1B33] ${compact ? "px-4 pt-6 pb-5" : "px-5 sm:px-12 md:px-16 pt-12 pb-10"}`}>
            {isInstantMode && (
              <p className="font-mono-bureau text-[9px] tracking-[0.35em] uppercase text-white/50 mb-2">
                Location Snapshot
              </p>
            )}
            <p className="font-mono-bureau text-[9px] tracking-[0.35em] uppercase text-white/40 mb-5">
              Chicago Site Incentive Map
            </p>
            <h1 className={`font-editorial ${compact ? "text-xl sm:text-2xl" : "text-3xl sm:text-4xl lg:text-[42px]"} text-white leading-tight mb-3`}>
              {isInstantMode && report.metadata?.address
                ? `Location Snapshot — ${report.metadata.address}`
                : report.title}
            </h1>
            {report.subtitle && (
              <p className="text-white/50 text-[15px] leading-relaxed max-w-xl mb-6">
                {report.subtitle}
              </p>
            )}
            <div className="w-10 h-[3px] bg-white/30" />
          </div>

          {isInstantMode && !compact && (
            <div className="px-5 sm:px-12 md:px-16 py-5 border-b border-[#2563EB]/15 bg-[#2563EB]/[0.035]">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <div className="font-mono-bureau text-[9px] tracking-[0.28em] uppercase text-[#2563EB]/70 mb-1.5">
                    Location-Only Snapshot
                  </div>
                  <p className="text-[13px] leading-relaxed text-[#0C1B33]/60 max-w-2xl">
                    This shows the zones, parcel context, and programs that touch this address. It does not yet account for your project goals, timeline, budget, site control, or document readiness.
                  </p>
                </div>
                {onRefine && (
                  <button
                    onClick={onRefine}
                    className="inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-5 py-3 hover:bg-[#1d4ed8] transition-colors cursor-pointer shadow-sm"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    Refine with Project Details
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Metadata Row ── */}
          <div className={`report-meta ${compact ? "px-4 py-3" : "px-5 sm:px-12 md:px-16 py-5"} border-b border-[#0C1B33]/8 flex flex-wrap gap-x-5 sm:gap-x-8 gap-y-3`}>
            <div>
              <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                Date
              </span>
              <span className="text-[#0C1B33] text-[13px]">
                {formattedDate}
              </span>
            </div>
            <div>
              <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                Report Type
              </span>
              <span className="text-[#0C1B33] text-[13px]">
                {reportTypeLabels[report.reportType] || report.reportType}
              </span>
            </div>
            {report.metadata?.address && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Address
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {report.metadata.address}
                </span>
              </div>
            )}
            {report.metadata?.industry && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Industry
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {report.metadata.industry}
                </span>
              </div>
            )}
            {report.metadata?.zoneClass && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Zoning
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {report.metadata.zoneClass}
                  {report.metadata.zoneType && (
                    <span className="text-[#0C1B33]/40"> ({report.metadata.zoneType})</span>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* ── Table of Contents ── */}
          {tocEntries.length > 0 && (
            <nav className="px-5 sm:px-12 md:px-16 pt-8 pb-2">
              <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/25 block mb-3">
                Contents
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
                {tocEntries.map((entry, i) => (
                  <a
                    key={entry.anchor}
                    href={`#${entry.anchor}`}
                    className="flex items-baseline gap-2 group py-0.5"
                  >
                    <span className="font-mono-bureau text-[9px] text-[#0C1B33]/15 w-5 text-right flex-shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-mono-bureau text-[10px] tracking-[0.05em] text-[#0C1B33]/45 group-hover:text-[#0C1B33] transition-colors">
                      {entry.label}
                    </span>
                  </a>
                ))}
              </div>
            </nav>
          )}

          {/* ── Zoning Map ── */}
          <div className="px-5 sm:px-12 md:px-16 pt-8">
            <ReportZoningMap
              lat={report.metadata?.lat}
              lon={report.metadata?.lon}
              address={report.metadata?.address}
            />
          </div>

          {/* ── Report Body ── */}
          <div className={`report-body ${compact ? "px-4 py-8" : "px-5 sm:px-12 md:px-16 py-14"}`}>
            {/* ── Overview text ── */}
            {report.summary && (
              <div className="mb-12">
                <p className="text-[#0C1B33]/60 text-[15px] leading-[1.8] max-w-prose">
                  {report.summary}
                </p>
              </div>
            )}

            {vacancySpreadsheetLocale && (
              <div className="mb-12 border border-[#0C1B33]/8 bg-[#FAF9F6] p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5">
                  <div className="min-w-0">
                    <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30 mb-2">
                      Vacancy Spreadsheet
                    </div>
                    <h2 className="font-editorial text-[24px] text-[#0C1B33] mb-2">
                      Vacant properties in {vacancySpreadsheetLocale}
                    </h2>
                    <p className="text-[#0C1B33]/45 text-[13px] leading-relaxed max-w-prose">
                      This vacancy report pulls the locale-level property spreadsheet so the analysis can move from summary findings to specific sites that may need review, outreach, or follow-up.
                    </p>
                  </div>
                  <button
                    onClick={handleVacancySpreadsheetExport}
                    disabled={isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet}
                    className="inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-5 py-3 hover:bg-[#0C1B33]/80 disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer"
                  >
                    {isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                    Download CSV
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#0C1B33]/8 mt-6">
                  {[
                    ["Properties", isLoadingVacancySpreadsheet ? "Loading" : vacancySpreadsheetStats.total.toLocaleString()],
                    ["Vacant land", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.land.toLocaleString()],
                    ["Buildings", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.buildings.toLocaleString()],
                    ["City / public", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.cityOwned.toLocaleString()],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-white px-4 py-3">
                      <span className="font-mono-bureau text-[8px] tracking-[0.18em] uppercase text-[#0C1B33]/25 block mb-1">
                        {label}
                      </span>
                      <span className="font-mono-bureau text-[16px] text-[#0C1B33]/70">
                        {value}
                      </span>
                    </div>
                  ))}
                </div>

                {vacancySpreadsheetError && (
                  <p className="mt-4 text-[12px] text-red-600/70">
                    {vacancySpreadsheetError}
                  </p>
                )}
              </div>
            )}

            {/* ── Verdict Card ── */}
            {report.verdict && (
              <div id="verdict">
                <VerdictCard verdict={report.verdict} />
              </div>
            )}

            {/* ── Executive Summary from Confidence Engine ── */}
            {report.executiveSummary && (
              <div id="executive-summary">
                <ExecutiveSummarySection
                  summary={report.executiveSummary}
                  isEditing={isEditingSummary}
                  editedText={editedSummaryText}
                  onToggleEdit={() => setIsEditingSummary(!isEditingSummary)}
                  onTextChange={setEditedSummaryText}
                />
              </div>
            )}

            {/* ── Content Sections ── */}
            {report.sections &&
              report.sections.map((section, sectionIdx) => {
                const sectionNumber = String(sectionIdx + sectionOffset + 1).padStart(2, "0");

                return (
                  <div key={sectionIdx} id={sectionToAnchor(section.title)} className="report-section mb-14">
                    <div className="flex items-baseline gap-4 mb-4">
                      <span className="font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8">
                        {sectionNumber}
                      </span>
                      <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]">
                        {section.title}
                      </h2>
                    </div>
                    <hr className="border-[#0C1B33]/8 mb-5" />
                    {section.description && (
                      <p className="text-[#0C1B33]/35 text-[13px] leading-relaxed mb-6 max-w-prose">
                        {section.description}
                      </p>
                    )}

                    {/* Market Analysis comparison bars */}
                    {section.title === "Market Analysis" && report.marketContext?.comparisons && (
                      <div className="space-y-0 divide-y divide-[#0C1B33]/5 mb-6">
                        {report.marketContext.comparisons.income && (
                          <ComparisonBar
                            label="Median Household Income"
                            locationFormatted={`$${report.marketContext.comparisons.income.location.toLocaleString()}`}
                            cityFormatted={`$${report.marketContext.comparisons.income.city.toLocaleString()}`}
                            pct={report.marketContext.comparisons.income.pct}
                          />
                        )}
                        {report.marketContext.comparisons.homeValue && (
                          <ComparisonBar
                            label="Median Home Value"
                            locationFormatted={`$${report.marketContext.comparisons.homeValue.location.toLocaleString()}`}
                            cityFormatted={`$${report.marketContext.comparisons.homeValue.city.toLocaleString()}`}
                            pct={report.marketContext.comparisons.homeValue.pct}
                          />
                        )}
                        {report.marketContext.comparisons.population && (
                          <ComparisonBar
                            label="Tract Population"
                            locationFormatted={report.marketContext.comparisons.population.location.toLocaleString()}
                            cityFormatted={`${report.marketContext.comparisons.population.city.toLocaleString()} avg`}
                            pct={report.marketContext.comparisons.population.pct}
                          />
                        )}
                        {report.marketContext.comparisons.walkScore && (
                          <ComparisonBar
                            label="EPA Walkability Index"
                            locationFormatted={`${report.marketContext.comparisons.walkScore.location}/20`}
                            cityFormatted={`${report.marketContext.comparisons.walkScore.city}/20`}
                            pct={report.marketContext.comparisons.walkScore.pct}
                          />
                        )}
                      </div>
                    )}

                    {/* Stacking section: visual table + density bar */}
                    {section.title === "Incentive Density & Stacking" && report.stackingAnalysis && (
                      <div className="mb-8">
                        {/* Density visual */}
                        <div className="mb-6">
                          <div className="flex items-baseline justify-between mb-2">
                            <span className="text-[#0C1B33] text-[13px] font-semibold">Zone Overlap</span>
                            <span className="font-mono-bureau text-[10px] text-[#0C1B33]/40">
                              {report.stackingAnalysis.zoneCount} zones &middot; {report.stackingAnalysis.percentileLabel}
                            </span>
                          </div>
                          <div className="h-6 bg-[#0C1B33]/[0.04] relative w-full">
                            <div
                              className="h-full bg-[#0C1B33]/12 transition-all"
                              style={{ width: `${Math.min(report.stackingAnalysis.zoneCount * 10, 100)}%` }}
                            />
                            {/* Tick marks at 25%, 50%, 75% */}
                            {[25, 50, 75].map((tick) => (
                              <div key={tick} className="absolute top-0 bottom-0 w-px bg-[#0C1B33]/8" style={{ left: `${tick}%` }} />
                            ))}
                          </div>
                          <div className="flex justify-between mt-1">
                            <span className="font-mono-bureau text-[8px] text-[#0C1B33]/20">0</span>
                            <span className="font-mono-bureau text-[8px] text-[#0C1B33]/20">10+ zones</span>
                          </div>
                        </div>

                        {/* Stacking rules table */}
                        {(report.stackingAnalysis.combinations.length > 0 || report.stackingAnalysis.rules.length > 0) && (
                          <div className="border border-[#0C1B33]/8 overflow-hidden">
                            <table className="w-full text-[12px]">
                              <thead>
                                <tr className="bg-[#0C1B33]/[0.03]">
                                  <th className="text-left font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/40 px-4 py-2.5">Combination</th>
                                  <th className="text-left font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/40 px-4 py-2.5 w-24">Status</th>
                                  <th className="text-left font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/40 px-4 py-2.5 hidden sm:table-cell">Benefit / Note</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#0C1B33]/5">
                                {report.stackingAnalysis.combinations.map((combo, ci) => (
                                  <tr key={`combo-${ci}`}>
                                    <td className="px-4 py-3 text-[#0C1B33]/70 font-medium">{combo.zones.join(" + ")}</td>
                                    <td className="px-4 py-3">
                                      <span className="font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-[#0C1B33]/50 bg-[#0C1B33]/[0.04] px-2 py-0.5">
                                        Can stack
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-[#0C1B33]/40 hidden sm:table-cell">{combo.benefit}</td>
                                  </tr>
                                ))}
                                {report.stackingAnalysis.rules.map((rule, ri) => (
                                  <tr key={`rule-${ri}`}>
                                    <td className="px-4 py-3 text-[#0C1B33]/70 font-medium">{rule.programA} + {rule.programB}</td>
                                    <td className="px-4 py-3">
                                      <span className={`font-mono-bureau text-[9px] tracking-[0.1em] uppercase px-2 py-0.5 ${
                                        rule.relationship === "can" ? "text-[#0C1B33]/50 bg-[#0C1B33]/[0.04]" :
                                        rule.relationship === "cannot" ? "text-[#0C1B33]/30 bg-[#0C1B33]/[0.02] line-through" :
                                        "text-[#0C1B33]/40 bg-[#0C1B33]/[0.03]"
                                      }`}>
                                        {rule.relationship === "can" ? "Can stack" : rule.relationship === "cannot" ? "Cannot stack" : "Conditional"}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-[#0C1B33]/40 hidden sm:table-cell">{rule.reason}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {section.items && section.items.length > 0 && (
                      <div className="space-y-0 divide-y divide-[#0C1B33]/5">
                        {section.items.map((item, itemIdx) => (
                          <div
                            key={itemIdx}
                            className="report-item py-4 first:pt-0"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4">
                              {/* Left: label */}
                              <div className="flex-1 min-w-0">
                                <span className="text-[#0C1B33] text-[13px] sm:text-[14px] font-semibold block">
                                  {item.label}
                                  {item.level && (
                                    <span className="font-mono-bureau text-[8px] sm:text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/25 ml-2 font-normal">
                                      {item.level}
                                    </span>
                                  )}
                                </span>
                                {item.detail && section.title === "Required Documents" ? (
                                  <ul className="mt-2 space-y-1.5">
                                    {item.detail.split("\n").map((line, li) => {
                                      const [docName, programs] = line.split(" — ");
                                      return (
                                        <li key={li} className="flex items-start gap-2 text-[11px] sm:text-[12px] leading-relaxed">
                                          <span className="text-[#0C1B33]/15 mt-0.5 flex-shrink-0">&bull;</span>
                                          <span className="text-[#0C1B33]/55">
                                            {docName}
                                            {programs && (
                                              <span className="text-[#0C1B33]/25 ml-1.5">— {programs}</span>
                                            )}
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                ) : item.detail ? (
                                  <span className="text-[#0C1B33]/40 text-[11px] sm:text-[12px] leading-relaxed block mt-0.5">
                                    {item.detail}
                                  </span>
                                ) : null}
                              </div>

                              {/* Right: value */}
                              {item.value && (
                                <span className="font-mono-bureau text-[10px] sm:text-[11px] tracking-[0.05em] text-[#0C1B33]/50 flex-shrink-0 sm:text-right pt-0.5">
                                  {item.value}
                                </span>
                              )}
                            </div>

                            {/* Eligibility & URL — collapsible accordion for program items */}
                            {(item.whoQualifies || item.eligibilityRules || item.url || item.whyOneLine) && (
                              <Accordion type="single" collapsible className="mt-1.5">
                                <AccordionItem value="eligibility" className="border-none">
                                  <AccordionTrigger className="py-2 hover:no-underline font-mono-bureau text-[9px] tracking-[0.1em] text-[#0C1B33]/40 uppercase">
                                    {item.confidenceLabel || "Eligibility Details"}
                                  </AccordionTrigger>
                                  <AccordionContent className="report-eligibility pl-4 border-l border-[#0C1B33]/8 space-y-2">
                                    {item.whyOneLine && (
                                      <p className="text-[#0C1B33]/50 text-[12px] leading-relaxed italic">
                                        {item.whyOneLine}
                                      </p>
                                    )}
                                    {item.matchedRules && item.matchedRules.length > 0 && (
                                      <div>
                                        <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 block mb-1">
                                          Confirmed
                                        </span>
                                        <ul className="space-y-0.5">
                                          {item.matchedRules.map((rule, rIdx) => (
                                            <li key={rIdx} className="text-[11px] text-[#0C1B33]/50 leading-relaxed flex items-start gap-1.5">
                                              <span className="text-[#0C1B33]/25 flex-shrink-0">+</span>
                                              <span>{rule}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {item.notVerified && item.notVerified.length > 0 && (
                                      <div>
                                        <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/20 block mb-1">
                                          Not Yet Verified
                                        </span>
                                        <ul className="space-y-0.5">
                                          {item.notVerified.map((nv, nvIdx) => (
                                            <li key={nvIdx} className="text-[11px] text-[#0C1B33]/30 leading-relaxed flex items-start gap-1.5">
                                              <span className="text-[#0C1B33]/15 flex-shrink-0">?</span>
                                              <span>{nv}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {item.whoQualifies && (
                                      <div>
                                        <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 block mb-0.5">
                                          Who Qualifies
                                        </span>
                                        <span className="text-[#0C1B33]/45 text-[11px] leading-relaxed block">
                                          {item.whoQualifies}
                                        </span>
                                      </div>
                                    )}
                                    {item.eligibilityRules && item.eligibilityRules.length > 0 && (
                                      <div>
                                        <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 block mb-1">
                                          Requirements
                                        </span>
                                        <ul className="space-y-0.5">
                                          {item.eligibilityRules.map((rule, rIdx) => (
                                            <li key={rIdx} className="flex items-start gap-2 text-[11px] text-[#0C1B33]/40 leading-relaxed">
                                              <span className="text-[#0C1B33]/20 mt-0.5 flex-shrink-0">{rule.required ? "Required:" : "Optional:"}</span>
                                              <span>{rule.description}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {item.url && (
                                      <a
                                        href={item.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-[11px] text-[#0C1B33]/50 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide print-url"
                                      >
                                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                        More information
                                      </a>
                                    )}
                                    {item.lastVerifiedAt && (
                                      <FreshnessBadge lastVerifiedAt={item.lastVerifiedAt} isStale={item.isStale} />
                                    )}
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

            {/* ── Your Next Steps (action roadmap) ── */}
            {report.actionRoadmap && report.actionRoadmap.length > 0 && (
              <div id="action-roadmap">
                <ActionRoadmapSection items={report.actionRoadmap} />
              </div>
            )}

            {/* ── Recommended Actions ── */}
            {report.recommendedActions &&
              report.recommendedActions.length > 0 && (
                <div id="recommended-actions" className="mb-12">
                  <div className="flex items-baseline gap-4 mb-4">
                    <span className="font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8">
                      {String(
                        (report.sections?.length || 0) + sectionOffset + 1
                      ).padStart(2, "0")}
                    </span>
                    <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]">
                      Recommended Actions
                    </h2>
                  </div>
                  <hr className="border-[#0C1B33]/8 mb-5" />

                  <div className="space-y-5">
                    {report.recommendedActions.map((action, actionIdx) => {
                      const priority = action.priority || "medium";
                      const badge =
                        priorityBadge[priority] || priorityBadge.medium;

                      return (
                        <div key={actionIdx} className="flex items-start gap-4">
                          {/* Number */}
                          <span className="font-editorial text-[18px] sm:text-[22px] leading-none text-[#0C1B33]/15 flex-shrink-0 w-6 sm:w-7 text-right pt-0.5">
                            {actionIdx + 1}.
                          </span>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start sm:items-center gap-2 sm:gap-3 mb-1 flex-wrap">
                              <span className="text-[#0C1B33] text-[13px] sm:text-[14px] font-semibold">
                                {action.label}
                              </span>
                              <span
                                className={`font-mono-bureau text-[8px] tracking-[0.15em] uppercase px-2 py-0.5 rounded-sm ${badge.classes}`}
                              >
                                {badge.label}
                              </span>
                            </div>
                            {action.description && (
                              <p className="text-[#0C1B33]/45 text-[13px] leading-relaxed">
                                {action.description}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* ── Data Sources ── */}
            {report.dataSources && report.dataSources.length > 0 && (
              <div id="data-sources" className="mb-12">
                <div className="flex items-baseline gap-4 mb-4">
                  <span className="font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8">
                    {String(
                      (report.sections?.length || 0) + sectionOffset + (report.recommendedActions && report.recommendedActions.length > 0 ? 2 : 1)
                    ).padStart(2, "0")}
                  </span>
                  <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]">
                    Data Sources
                  </h2>
                </div>
                <hr className="border-[#0C1B33]/8 mb-5" />
                <p className="text-[#0C1B33]/35 text-[13px] leading-relaxed mb-5 max-w-prose">
                  This report draws on the following data sources to verify eligibility and provide location context.
                </p>
                <ul className="space-y-3">
                  {report.dataSources.map((src) => (
                    <li key={src.id} className="text-[13px] leading-relaxed">
                      <span className="text-[#0C1B33]/70 font-semibold">{src.label}</span>
                      <span className="text-[#0C1B33]/40"> — {src.description}</span>
                      {src.url && (
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 ml-2 text-[11px] text-[#0C1B33]/40 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide print-url"
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                          Link
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Government Resources ── */}
            <div className="mt-16 pt-8 border-t border-[#0C1B33]/8">
              <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-5">
                Government Resources
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <p className="text-[#0C1B33]/70 text-[13px] font-semibold mb-1">City of Chicago</p>
                  <p className="text-[#0C1B33]/40 text-[12px] leading-relaxed mb-1.5">
                    Dept. of Planning &amp; Development
                  </p>
                  <p className="text-[#0C1B33]/40 text-[11px] leading-relaxed">
                    <a href="tel:+13127444190" className="hover:text-[#0C1B33] transition-colors print-url">(312) 744-4190</a>
                  </p>
                  <a
                    href="https://www.chicago.gov/city/en/depts/dcd.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#0C1B33]/35 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide mt-1 print-url"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    chicago.gov/dcd
                  </a>
                </div>
                <div>
                  <p className="text-[#0C1B33]/70 text-[13px] font-semibold mb-1">Cook County</p>
                  <p className="text-[#0C1B33]/40 text-[12px] leading-relaxed mb-1.5">
                    Bureau of Economic Development
                  </p>
                  <p className="text-[#0C1B33]/40 text-[11px] leading-relaxed">
                    <a href="tel:+13126033070" className="hover:text-[#0C1B33] transition-colors print-url">(312) 603-3070</a>
                  </p>
                  <a
                    href="https://www.cookcountyil.gov/service/economic-development"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#0C1B33]/35 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide mt-1 print-url"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    cookcountyil.gov
                  </a>
                </div>
                <div>
                  <p className="text-[#0C1B33]/70 text-[13px] font-semibold mb-1">State of Illinois</p>
                  <p className="text-[#0C1B33]/40 text-[12px] leading-relaxed mb-1.5">
                    Dept. of Commerce &amp; Economic Opportunity
                  </p>
                  <p className="text-[#0C1B33]/40 text-[11px] leading-relaxed">
                    <a href="tel:+12178146732" className="hover:text-[#0C1B33] transition-colors print-url">(217) 814-6732</a>
                  </p>
                  <a
                    href="https://dceo.illinois.gov"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#0C1B33]/35 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide mt-1 print-url"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    dceo.illinois.gov
                  </a>
                </div>
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="report-footer mt-8 pt-6 border-t border-dashed border-[#0C1B33]/15">
              <p className="text-[#0C1B33]/35 text-[12px] leading-relaxed mb-2">
                This report was generated on {formattedDate} by Chicago
                Incentive Explorer.
              </p>
              <p className="text-[#0C1B33]/25 text-[11px] leading-relaxed">
                Program details, funding rounds, and eligibility rules change over
                time. This is an informational tool &mdash; confirm eligibility
                with program administrators.
              </p>
            </div>
          </div>
        </div>

        {/* ── Action Buttons (outside the document) ── */}
        <div className={`report-actions mx-auto max-w-[850px] print:hidden mt-8 ${compact ? "hidden" : ""}`}>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={handlePrint}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#0C1B33]/80 transition-colors cursor-pointer shadow-md"
            >
              <Printer className="w-3.5 h-3.5" />
              Download PDF
            </button>
            <button
              onClick={handleSaveReport}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#1d4ed8] transition-colors cursor-pointer shadow-md"
            >
              <FileText className="w-3.5 h-3.5" />
              {isVacancyReport ? "Save Report" : "Save to Workspace"}
            </button>
            <button
              onClick={() => setEmailDialogOpen(true)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#2563EB]/30 text-[#2563EB] font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#2563EB]/5 hover:border-[#2563EB]/50 transition-colors cursor-pointer shadow-md"
            >
              <Mail className="w-3.5 h-3.5" />
              {isVacancyReport ? "Email This to Me" : "Email Report"}
            </button>
            {vacancySpreadsheetLocale && (
              <button
                onClick={handleVacancySpreadsheetExport}
                disabled={isExportingVacancySpreadsheet}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer shadow-md"
              >
                {isExportingVacancySpreadsheet ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileText className="w-3.5 h-3.5" />
                )}
                Vacancy Spreadsheet
              </button>
            )}
            {reportWizardState && (
              <button
                onClick={handleShareReport}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
              >
                {linkCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Link Copied!
                  </>
                ) : (
                  <>
                    <Link2 className="w-3.5 h-3.5" />
                    Share Report
                  </>
                )}
              </button>
            )}
            {!compact && onCompare && !compareMode && (
              <button
                onClick={onCompare}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
              >
                <MapPin className="w-3.5 h-3.5" />
                Compare Another Address
              </button>
            )}
            {isInstantMode && onRefine && (
              <button
                onClick={onRefine}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#1d4ed8] transition-colors cursor-pointer shadow-md"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                Refine with Project Details
              </button>
            )}
            <button
              onClick={onStartOver}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {isInstantMode ? "New Search" : "Start Over"}
            </button>
          </div>

          {/* Compare address input */}
          {compareMode && !compareGeoResult && (
            <div className="mt-5 mx-auto max-w-md">
              <label className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-2">
                Enter a second address to compare
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={compareAddressInput || ""}
                  onChange={(e) => setCompareAddressInput?.(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") onCompareGeocode?.(); }}
                  placeholder="e.g. 200 N LaSalle St, Chicago"
                  className="flex-1 px-4 py-3 bg-white border border-[#0C1B33]/15 text-[13px] text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#0C1B33]/30 font-mono-bureau"
                />
                <button
                  onClick={onCompareGeocode}
                  disabled={compareGeocoding || !compareAddressInput?.trim()}
                  className="px-5 py-3 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase hover:bg-[#0C1B33]/80 transition-colors disabled:opacity-30 cursor-pointer"
                >
                  {compareGeocoding ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Compare loading state */}
          {compareMode && compareGeoResult && !compareGeoResult && (
            <div className="mt-5 text-center">
              <div className="flex gap-1.5 justify-center mb-2">
                <div className="w-1.5 h-1.5 bg-[#0C1B33]/20 rounded-full animate-pulse" />
                <div className="w-1.5 h-1.5 bg-[#0C1B33]/20 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
                <div className="w-1.5 h-1.5 bg-[#0C1B33]/20 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
              </div>
              <p className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/30">
                Generating comparison report...
              </p>
            </div>
          )}
        </div>
      </div>
      {/* Download Lead Capture */}
      {downloadGateOpen && (
        <DownloadGateModal
          reportAddress={report.metadata?.address}
          reportTitle={report.title}
          onDownload={handleDownloadAfterCapture}
          onClose={() => setDownloadGateOpen(false)}
        />
      )}
      {/* Email Report Dialog */}
      {emailDialogOpen && (
        <EmailReportModal
          report={report}
          onClose={() => setEmailDialogOpen(false)}
        />
      )}
      {saveModalOpen && (
        <SaveReportModal
          reportData={report}
          wizardState={reportWizardState}
          onClose={() => setSaveModalOpen(false)}
        />
      )}
    </motion.div>
  );
}

// ─── Email Report Modal ─────────────────────────────────────────────

function EmailReportModal({
  report,
  onClose,
}: {
  report: GeneratedReport;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSend = async () => {
    if (!email || !email.includes("@")) return;
    setStatus("sending");
    setErrorMsg("");

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
          address: report.metadata?.address,
          incentiveCount: report.sections?.length,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send");
      }

      setStatus("sent");
      setTimeout(() => { onClose(); }, 2000);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white border border-[#0C1B33]/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div>
            <h3 className="text-sm font-medium text-[#0C1B33]">Email Report</h3>
            <p className="font-mono-bureau text-[10px] text-[#0C1B33]/40 tracking-wide uppercase">PDF attached</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center hover:bg-[#0C1B33]/5 transition-colors">
            <span className="text-[#0C1B33]/40 text-lg">&times;</span>
          </button>
        </div>
        <div className="px-6 pb-6 space-y-4">
          <div>
            <label className="block font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 mb-2">
              Recipient Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && status === "idle" && handleSend()}
              placeholder="name@example.com"
              disabled={status === "sending" || status === "sent"}
              className="w-full bg-[#FAF9F6] border border-[#0C1B33]/10 px-4 py-3 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]/50 disabled:opacity-50 font-mono-bureau"
              autoFocus
            />
          </div>
          {status === "error" && (
            <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          <button
            onClick={handleSend}
            disabled={!email || !email.includes("@") || status === "sending" || status === "sent"}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[#2563EB] hover:bg-[#1d4ed8] disabled:opacity-40 text-white transition-all font-mono-bureau text-[11px] tracking-wide uppercase"
          >
            {status === "sending" ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
            ) : status === "sent" ? (
              <><Check className="w-4 h-4" /> Sent!</>
            ) : (
              <><Mail className="w-4 h-4" /> Send Report</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Download Gate Modal ──────────────────────────────────────────────

function DownloadGateModal({
  reportAddress,
  reportTitle,
  onDownload,
  onClose,
}: {
  reportAddress?: string;
  reportTitle?: string;
  onDownload: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");

  const isValid = name.trim().length > 0 && email.includes("@") && zipCode.trim().length >= 5;

  const handleSubmit = async () => {
    if (!isValid) return;
    setStatus("saving");

    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          zipCode: zipCode.trim(),
          reportAddress,
          reportTitle,
        }),
      });
    } catch {
      // Still allow download even if lead save fails
    }

    setStatus("done");
    onDownload();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white border border-[#0C1B33]/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <div>
            <h3 className="text-sm font-medium text-[#0C1B33]">Download Report</h3>
            <p className="font-mono-bureau text-[10px] text-[#0C1B33]/40 tracking-wide uppercase mt-0.5">
              Enter your details to download
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center hover:bg-[#0C1B33]/5 transition-colors">
            <span className="text-[#0C1B33]/40 text-lg">&times;</span>
          </button>
        </div>
        <div className="px-6 pb-6 pt-3 space-y-3">
          <div>
            <label className="block font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              disabled={status !== "idle"}
              className="w-full bg-[#FAF9F6] border border-[#0C1B33]/10 px-4 py-2.5 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]/50 disabled:opacity-50 font-mono-bureau"
              autoFocus
            />
          </div>
          <div>
            <label className="block font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              disabled={status !== "idle"}
              className="w-full bg-[#FAF9F6] border border-[#0C1B33]/10 px-4 py-2.5 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]/50 disabled:opacity-50 font-mono-bureau"
            />
          </div>
          <div>
            <label className="block font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 mb-1.5">
              Zip Code
            </label>
            <input
              type="text"
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && isValid && status === "idle" && handleSubmit()}
              placeholder="60617"
              maxLength={10}
              disabled={status !== "idle"}
              className="w-full bg-[#FAF9F6] border border-[#0C1B33]/10 px-4 py-2.5 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]/50 disabled:opacity-50 font-mono-bureau"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={!isValid || status !== "idle"}
            className="w-full flex items-center justify-center gap-2 py-3 mt-1 bg-[#0C1B33] hover:bg-[#0C1B33]/80 disabled:opacity-40 text-white transition-all font-mono-bureau text-[11px] tracking-wide uppercase"
          >
            {status === "saving" ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Preparing...</>
            ) : (
              <><Printer className="w-4 h-4" /> Download PDF</>
            )}
          </button>
          <p className="text-[9px] text-[#0C1B33]/30 text-center leading-snug">
            Your info helps us understand who we&apos;re serving. We won&apos;t spam you.
          </p>
        </div>
      </div>
    </div>
  );
}
