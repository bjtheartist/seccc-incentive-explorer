"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
  Sparkles,
  Phone,
  ExternalLink,
  Calendar,
  DollarSign,
  Mail,
  ClipboardList,
  Link2,
} from "lucide-react";
import {
  REPORT_TYPE_OPTIONS,
  WIZARD_STEPS,
  getStepsForReportType,
  getStepValue,
  setStepValue,
  INITIAL_WIZARD_STATE,
} from "@/lib/report-wizard-config";
import type {
  ReportType,
  WizardState,
  WizardStepConfig,
} from "@/lib/report-wizard-config";
import { generateReportData } from "@/lib/report-engine";
import type { GeneratedReport, ReportCensusData, ReportZoningData, ActionRoadmapItem } from "@/lib/report-engine";
import { formatDollars } from "@/lib/report-engine";
import { encodeWizardState, decodeWizardState } from "@/lib/url-state";
import type { Program, ExecutiveSummary, ParcelData, DistrictData } from "@/lib/types";
import ReportZoningMap from "@/components/report/ReportZoningMap";
import { cachedFetch } from "@/lib/fetch-cache";

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

// ─── Confidence badge color mapping ──────────────────────────────────

const CONFIDENCE_BADGE: Record<string, { bg: string; text: string; border: string }> = {
  appears_eligible: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  location_eligible: { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-200" },
  may_qualify: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  worth_exploring: { bg: "bg-[#0C1B33]/5", text: "text-[#0C1B33]/50", border: "border-[#0C1B33]/10" },
  not_applicable: { bg: "bg-red-50", text: "text-red-500", border: "border-red-200" },
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
  const instantAddr = searchParams.get("addr") || "";

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
        reportType: "location-incentives",
        address: instantAddr,
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

  // Data state
  const [programs, setPrograms] = useState<Program[]>([]);
  const [zones, setZones] = useState<Record<string, boolean> | null>(null);
  const [zoneNames, setZoneNames] = useState<Record<string, string> | null>(null);
  const [censusData, setCensusData] = useState<ReportCensusData | null>(null);
  const [cityZoning, setCityZoning] = useState<ReportZoningData | null>(null);
  const [parcelData, setParcelData] = useState<ParcelData | null>(null);
  const [districtsData, setDistrictsData] = useState<DistrictData | null>(null);

  // Address / geocode state
  const [addressInput, setAddressInput] = useState(instantAddr);
  const [geocodeResult, setGeocodeResult] = useState<{
    lat: number;
    lon: number;
    display_name: string;
  } | null>(isInstantMode && instantLat && instantLon ? { lat: instantLat, lon: instantLon, display_name: instantAddr } : null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  // Instant mode state
  const [instantLoading, setInstantLoading] = useState(isInstantMode);

  // Load programs on mount
  useEffect(() => {
    cachedFetch<Program[]>("/data/programs.json")
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
        const data = await cachedFetch<
          { key: string; name: string }[] | { zones: Record<string, boolean>; zoneNames?: Record<string, string> }
        >(`/api/zones/check?lat=${lat}&lon=${lon}`);
        // The API returns an array of { key, name } objects.
        if (Array.isArray(data)) {
            const zoneMap: Record<string, boolean> = {};
            const nameMap: Record<string, string> = {};
            for (const item of data) {
              if (item.key) {
                zoneMap[item.key] = true;
                if (item.name) nameMap[item.key] = item.name;
              }
            }
            setZones(zoneMap);
            setZoneNames(nameMap);
            return;
        } else if ('zones' in data && data.zones) {
          setZones(data.zones);
          if (data.zoneNames) setZoneNames(data.zoneNames);
          return;
        }
        // Unexpected format — fall through to Turf.js
        throw new Error("API unavailable");
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

  // Instant mode: auto-generate report once programs + zones are loaded
  // Small delay gives census/zoning APIs time to resolve alongside zones
  useEffect(() => {
    if (!isInstantMode || !instantLoading) return;
    if (programs.length === 0 || !zones) return;

    const timer = setTimeout(() => {
      setIsGenerating(true);
      try {
        const generated = generateReportData(
          wizardState,
          programs,
          zones ?? undefined,
          zoneNames ?? undefined,
          censusData ?? undefined,
          cityZoning ?? undefined,
          parcelData ?? undefined,
          districtsData ?? undefined,
        );
        setReport(generated);
      } catch {
        // Stay on loading
      } finally {
        setIsGenerating(false);
        setInstantLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [isInstantMode, instantLoading, programs, zones, zoneNames, censusData, cityZoning, parcelData, districtsData, wizardState]);

  // Share mode: auto-generate report once programs + zones are loaded
  const [shareAutoGenerated, setShareAutoGenerated] = useState(false);
  useEffect(() => {
    if (!isShareMode || shareAutoGenerated) return;
    if (programs.length === 0) return;
    // For address-based reports, wait for zones
    if ((wizardState.reportType === "location-incentives" || wizardState.reportType === "developer-analysis" || wizardState.reportType === "best-location") && !zones && wizardState.lat) return;

    const timer = setTimeout(() => {
      setIsGenerating(true);
      try {
        const generated = generateReportData(
          wizardState,
          programs,
          zones ?? undefined,
          zoneNames ?? undefined,
          censusData ?? undefined,
          cityZoning ?? undefined,
          parcelData ?? undefined,
          districtsData ?? undefined,
        );
        setReport(generated);
        setShareAutoGenerated(true);
      } catch {
        // Stay on wizard
      } finally {
        setIsGenerating(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [isShareMode, shareAutoGenerated, programs, zones, zoneNames, censusData, cityZoning, parcelData, districtsData, wizardState]);

  // Derive steps based on report type
  const steps = useMemo<WizardStepConfig[]>(() => {
    if (!wizardState.reportType) return [WIZARD_STEPS[0]]; // just the report-type step
    return getStepsForReportType(wizardState.reportType);
  }, [wizardState.reportType]);

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
      case "single": {
        const val = getStepValue(wizardState, currentStep.id);
        return typeof val === "string" && val !== "";
      }
      case "multi": {
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

  const handleGeocode = useCallback(async () => {
    if (!addressInput.trim()) return;
    setIsGeocoding(true);
    setGeocodeError(null);
    try {
      const data = await cachedFetch<{ lat: number; lon: number; displayName?: string; display_name?: string }>(
        `/api/geocode?address=${encodeURIComponent(addressInput.trim())}`
      );
      if (!data.lat || !data.lon) throw new Error("Address not found");
      setGeocodeResult({
        lat: data.lat,
        lon: data.lon,
        display_name: data.displayName || data.display_name || addressInput.trim(),
      });
      setWizardState((prev) => ({
        ...prev,
        address: data.display_name || addressInput.trim(),
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
    // Clear instant mode URL params
    router.replace("/report");
  }, [router]);

  const handleRefine = useCallback(() => {
    // Drop user into wizard at industry step (step index 2 in location-incentives flow)
    setReport(null);
    setInstantLoading(false);
    setCurrentStepIndex(2); // industry step
    setDirection(1);
  }, []);

  // ── Report Generation ────────────────────────────────────────────

  const handleGenerateReport = useCallback(async () => {
    setIsGenerating(true);
    try {
      const generated = generateReportData(
        wizardState,
        programs,
        zones ?? undefined,
        zoneNames ?? undefined,
        censusData ?? undefined,
        cityZoning ?? undefined,
        parcelData ?? undefined,
      );
      setReport(generated);
    } catch {
      // If generation fails, stay on review step
    } finally {
      setIsGenerating(false);
    }
  }, [wizardState, programs, zones, zoneNames, censusData, cityZoning, parcelData, districtsData]);

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
          : [...arr, value];
        return setStepValue(prev, stepId, next);
      });
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
            Generating Instant Report
          </p>
          {instantAddr && (
            <p className="text-[13px] text-[#0C1B33]/40">{instantAddr}</p>
          )}
        </div>
      </div>
    );
  }

  // ── If report is generated, show report display ──────────────────

  if (report) {
    return (
      <div className="min-h-screen">
        <ReportDisplay
          report={report}
          onStartOver={handleStartOver}
          onRefine={handleRefine}
          isInstantMode={isInstantMode}
          wizardState={wizardState}
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
          onClick={onGeocode}
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
      <p className="mt-4 font-mono-bureau text-[9px] text-[#0C1B33]/25 uppercase tracking-[0.15em]">
        Tip: Include street number for best results (e.g. &quot;123 S State St, Chicago&quot;)
      </p>
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

// ─── Multi Select Step ───────────────────────────────────────────────

function MultiSelectStep({
  stepId,
  options,
  value,
  onToggle,
}: {
  stepId: string;
  options: { id: string; label: string }[];
  value: string[];
  onToggle: (stepId: string, value: string) => void;
}) {
  return (
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

      {/* Answer summary */}
      <div className="space-y-3 mb-8">
        {steps
          .filter((s) => s.inputType !== "report-type" && s.inputType !== "review")
          .map((step) => {
            const val = step.inputType === "address"
              ? wizardState.address
              : getStepValue(wizardState, step.id);

            let displayValue = "";
            if (typeof val === "string") {
              // For single selects, find the option label
              if (step.inputType === "single" && step.options) {
                const opt = step.options.find((o) => o.id === val);
                displayValue = opt?.label || val;
              } else {
                displayValue = val;
              }
            } else if (Array.isArray(val)) {
              // For multi selects, find option labels
              if (step.options) {
                displayValue = val
                  .map((v) => {
                    const opt = step.options!.find((o) => o.id === v);
                    return opt?.label || v;
                  })
                  .join(", ");
              } else {
                displayValue = val.join(", ");
              }
            }

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
            Generate Report
          </>
        )}
      </button>
    </div>
  );
}

// ─── Executive Summary Component ─────────────────────────────────────

function ExecutiveSummarySection({
  summary,
}: {
  summary: ExecutiveSummary;
}) {
  const actionIcons: Record<string, typeof Phone> = {
    call: Phone,
    check: ExternalLink,
    book: Calendar,
  };

  return (
    <div className="bg-[#EFF3FB]/50 border border-[#2563EB]/10 p-6 sm:p-8 mb-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Sparkles className="w-4 h-4 text-[#2563EB]" />
        <span className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#2563EB]">
          Executive Summary
        </span>
      </div>

      {/* Top 3 Programs */}
      {summary.topPrograms.length > 0 && (
        <div className="mb-6">
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-3">
            Top Programs for Your Location
          </span>
          <div className="space-y-2">
            {summary.topPrograms.map((prog) => {
              const badge = CONFIDENCE_BADGE[prog.confidence] || CONFIDENCE_BADGE.worth_exploring;
              return (
                <div
                  key={prog.programId}
                  className="flex items-center justify-between bg-white border border-[#0C1B33]/8 px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[14px] font-semibold text-[#0C1B33] truncate">
                      {prog.name}
                    </span>
                    <span className={`flex-shrink-0 font-mono-bureau text-[8px] tracking-[0.1em] uppercase px-2 py-0.5 border ${badge.bg} ${badge.text} ${badge.border}`}>
                      {prog.confidenceLabel}
                    </span>
                  </div>
                  <span className="font-mono-bureau text-[11px] text-[#0C1B33]/50 flex-shrink-0 ml-3">
                    {prog.benefitRange}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Actions Strip */}
      {summary.topActions.length > 0 && (
        <div className="mb-6">
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-3">
            Best Next Steps
          </span>
          <div className="flex flex-wrap gap-2">
            {summary.topActions.map((action, i) => {
              const Icon = actionIcons[action.type] || ExternalLink;
              return (
                <div
                  key={i}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-[#0C1B33]/10 text-[12px] text-[#0C1B33]/70"
                >
                  <Icon className="w-3 h-3 text-[#2563EB]" />
                  {action.label}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Why These Matter paragraph */}
      <p className="text-[#0C1B33]/60 text-[14px] leading-[1.7]">
        {summary.whyTheseMatter}
      </p>
    </div>
  );
}

// ─── Benefit Estimator Section ────────────────────────────────────────

function BenefitEstimatorSection({
  estimates,
}: {
  estimates: NonNullable<GeneratedReport["benefitEstimates"]>;
}) {
  return (
    <div className="bg-gradient-to-br from-emerald-50 to-[#EFF3FB] border border-emerald-200/60 p-6 sm:p-8 mb-10">
      <div className="flex items-center gap-3 mb-5">
        <DollarSign className="w-5 h-5 text-emerald-600" />
        <span className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-emerald-700">
          Your Estimated Incentive Value
        </span>
      </div>

      {/* Big total */}
      <div className="mb-6">
        <span className="font-editorial text-4xl sm:text-5xl text-emerald-700 leading-tight block">
          ~{estimates.totalFormatted}
        </span>
        <span className="font-mono-bureau text-[10px] tracking-[0.1em] text-emerald-600/60 mt-1 block">
          Total estimated incentives based on {estimates.budgetRange} budget
        </span>
      </div>

      {/* Per-program breakdown */}
      <div className="space-y-2">
        {estimates.items.map((item) => (
          <div
            key={item.programId}
            className="flex items-center justify-between bg-white/70 border border-emerald-100 px-4 py-2.5"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: item.color || "#059669" }}
              />
              <span className="text-[13px] text-[#0C1B33]/80 truncate">
                {item.programName}
              </span>
            </div>
            <span className="font-mono-bureau text-[12px] font-semibold text-emerald-700 flex-shrink-0 ml-3">
              ~{formatDollars(item.estimatedValue)}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-emerald-600/50 mt-4 leading-relaxed">
        Estimates are based on program percentages applied to your budget midpoint.
        Actual values depend on eligibility verification and program-specific caps.
      </p>
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
  const startGathering = items.filter((i) => i.tier === "start-gathering");
  const worthExploring = items.filter((i) => i.tier === "worth-exploring");

  return (
    <div className="mb-10">
      <div className="flex items-center gap-3 mb-5">
        <ClipboardList className="w-4 h-4 text-[#2563EB]" />
        <span className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#2563EB]">
          What to Do Monday Morning
        </span>
      </div>

      {/* Tier 1: Do This Week */}
      {doThisWeek.length > 0 && (
        <div className="mb-6">
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-emerald-600 block mb-3">
            Do This Week
          </span>
          <div className="space-y-3">
            {doThisWeek.map((item, i) => (
              <div
                key={i}
                className="bg-white border border-emerald-200/50 p-4 sm:p-5"
              >
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-6 h-6 bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0 text-[11px] font-semibold">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[14px] font-semibold text-[#0C1B33] block">
                      {item.label}
                    </span>
                    <span className="text-[12px] text-[#0C1B33]/45 block mt-0.5">
                      {item.description}
                    </span>
                  </div>
                </div>

                {/* Contact card */}
                {item.contact && (
                  <div className="ml-9 mt-3 bg-[#0C1B33]/[0.02] border border-[#0C1B33]/6 p-3 space-y-1.5">
                    <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30 block">
                      {item.contact.role || "Contact"}
                    </span>
                    <span className="text-[13px] text-[#0C1B33]/70 font-medium block">
                      {item.contact.agency}
                    </span>
                    <div className="flex flex-wrap gap-3">
                      {item.contact.phone && (
                        <a
                          href={`tel:${item.contact.phone}`}
                          className="inline-flex items-center gap-1.5 text-[12px] text-[#2563EB] hover:text-[#1d4ed8]"
                        >
                          <Phone className="w-3 h-3" />
                          {item.contact.phone}
                        </a>
                      )}
                      {item.contact.email && (
                        <a
                          href={`mailto:${item.contact.email}`}
                          className="inline-flex items-center gap-1.5 text-[12px] text-[#2563EB] hover:text-[#1d4ed8]"
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
                  <div className="ml-9 mt-2 bg-blue-50/50 border border-blue-100 p-3">
                    <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-blue-500/60 block mb-1">
                      What to say
                    </span>
                    <p className="text-[12px] text-blue-900/70 italic leading-relaxed">
                      {item.callScript}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tier 2: Start Gathering */}
      {startGathering.length > 0 && (
        <div className="mb-6">
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-amber-600 block mb-3">
            Start Gathering
          </span>
          {startGathering.map((item, i) => (
            <div
              key={i}
              className="bg-white border border-amber-200/40 p-4 sm:p-5"
            >
              <span className="text-[13px] text-[#0C1B33]/70 block mb-2">
                {item.description}
              </span>
              {item.documents && item.documents.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.documents.map((doc, di) => (
                    <span
                      key={di}
                      className="inline-flex items-center px-2.5 py-1 text-[10px] font-mono-bureau tracking-[0.05em] bg-amber-50 border border-amber-200/40 text-amber-800/70"
                    >
                      {doc}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tier 3: Worth Exploring */}
      {worthExploring.length > 0 && (
        <div>
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-3">
            Worth Exploring
          </span>
          <div className="space-y-2">
            {worthExploring.map((item, i) => (
              <div
                key={i}
                className="bg-white border border-[#0C1B33]/6 p-4 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <span className="text-[13px] text-[#0C1B33]/70 font-medium block">
                    {item.programName || item.label}
                  </span>
                  <span className="text-[11px] text-[#0C1B33]/40 block mt-0.5">
                    {item.description}
                  </span>
                </div>
                {item.contact?.phone && (
                  <a
                    href={`tel:${item.contact.phone}`}
                    className="flex items-center gap-1 text-[10px] font-mono-bureau text-[#2563EB] flex-shrink-0"
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

// ─── Report Display ──────────────────────────────────────────────────

function ReportDisplay({
  report,
  onStartOver,
  onRefine,
  isInstantMode,
  wizardState: reportWizardState,
}: {
  report: GeneratedReport;
  onStartOver: () => void;
  onRefine?: () => void;
  isInstantMode?: boolean;
  wizardState?: WizardState;
}) {
  const [linkCopied, setLinkCopied] = useState(false);

  const handlePrint = () => {
    window.print();
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

  const priorityBadge: Record<string, { label: string; classes: string }> = {
    high: {
      label: "High Priority",
      classes: "bg-[#2563EB]/10 text-[#2563EB] border border-[#2563EB]/20",
    },
    medium: {
      label: "Medium",
      classes: "bg-[#0C1B33]/5 text-[#0C1B33]/50 border border-[#0C1B33]/10",
    },
    low: {
      label: "Low",
      classes: "bg-[#0C1B33]/[0.03] text-[#0C1B33]/30 border border-[#0C1B33]/5",
    },
  };

  const sectionColors = [
    "#2563EB",
    "#0D9488",
    "#7C3AED",
    "#D97706",
    "#DC2626",
    "#059669",
  ];

  const formattedDate = new Date(report.generatedAt).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric" }
  );

  const reportTypeLabels: Record<string, string> = {
    "location-incentives": "Location Incentive Report",
    "best-location": "Site Evaluation Report",
    "program-explorer": "Program Explorer Report",
    "developer-analysis": "Developer Analysis Report",
  };

  // Section numbering offset: if exec summary exists, content sections start at 02
  const hasExecSummary = !!report.executiveSummary;
  const sectionOffset = (report.summary ? 1 : 0) + (hasExecSummary ? 1 : 0);

  return (
    <motion.div {...fadeIn}>
      {/* ── Outer wrapper: off-white background ── */}
      <div className="report-document bg-[#F5F5F0] py-4 sm:py-8 px-2 sm:px-6 print:bg-white print:p-0">
        {/* ── Document ── */}
        <div className="mx-auto max-w-[850px] bg-white shadow-xl print:shadow-none">
          {/* ── Cover / Header Bar ── */}
          <div className="report-cover bg-[#0C1B33] px-5 sm:px-12 md:px-16 pt-12 pb-10">
            {isInstantMode && (
              <p className="font-mono-bureau text-[9px] tracking-[0.35em] uppercase text-[#2563EB] mb-2">
                Instant Report
              </p>
            )}
            <p className="font-mono-bureau text-[9px] tracking-[0.35em] uppercase text-white/40 mb-5">
              Chicago Site Incentive Map
            </p>
            <h1 className="font-editorial text-3xl sm:text-4xl lg:text-[42px] text-white leading-tight mb-3">
              {isInstantMode && report.metadata?.address
                ? `Instant Report — ${report.metadata.address}`
                : report.title}
            </h1>
            {report.subtitle && (
              <p className="text-white/50 text-[15px] leading-relaxed max-w-xl mb-6">
                {report.subtitle}
              </p>
            )}
            <div className="w-10 h-[3px] bg-[#2563EB]" />
          </div>

          {/* ── Metadata Row ── */}
          <div className="report-meta px-5 sm:px-12 md:px-16 py-5 border-b border-[#0C1B33]/8 flex flex-wrap gap-x-5 sm:gap-x-8 gap-y-3">
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

          {/* ── Zoning Map ── */}
          <div className="px-5 sm:px-12 md:px-16 pt-8">
            <ReportZoningMap
              lat={report.metadata?.lat}
              lon={report.metadata?.lon}
              address={report.metadata?.address}
            />
          </div>

          {/* ── Report Body ── */}
          <div className="report-body px-5 sm:px-12 md:px-16 py-14">
            {/* ── Executive Summary from Confidence Engine ── */}
            {report.executiveSummary && (
              <ExecutiveSummarySection summary={report.executiveSummary} />
            )}

            {/* ── Benefit Estimator ("Your Dollar Amount") ── */}
            {report.benefitEstimates && report.benefitEstimates.items.length > 0 && (
              <BenefitEstimatorSection estimates={report.benefitEstimates} />
            )}

            {/* ── Action Roadmap ("What to Do Monday Morning") ── */}
            {report.actionRoadmap && report.actionRoadmap.length > 0 && (
              <ActionRoadmapSection items={report.actionRoadmap} />
            )}

            {/* ── Text Summary (Section 01) ── */}
            {report.summary && (
              <div className="mb-12">
                <div className="flex items-baseline gap-4 mb-4">
                  <span className="font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8">
                    01
                  </span>
                  <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]">
                    Overview
                  </h2>
                </div>
                <hr className="border-[#0C1B33]/8 mb-5" />
                <p className="text-[#0C1B33]/70 text-[15px] leading-[1.8] max-w-prose">
                  {report.summary}
                </p>
              </div>
            )}

            {/* ── Content Sections ── */}
            {report.sections &&
              report.sections.map((section, sectionIdx) => {
                const sectionNumber = String(sectionIdx + sectionOffset + 1).padStart(2, "0");
                const sectionColor =
                  sectionColors[sectionIdx % sectionColors.length];

                return (
                  <div key={sectionIdx} className="report-section mb-12">
                    <div className="flex items-baseline gap-4 mb-4">
                      <span className="font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8">
                        {sectionNumber}
                      </span>
                      <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]">
                        {section.title}
                      </h2>
                    </div>
                    <hr className="border-[#0C1B33]/8 mb-5" />

                    {section.items && section.items.length > 0 && (
                      <div className="space-y-0 divide-y divide-[#0C1B33]/5">
                        {section.items.map((item, itemIdx) => (
                          <div
                            key={itemIdx}
                            className="report-item py-4 first:pt-0"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4">
                              {/* Left: color dot + label */}
                              <div className="flex items-start gap-3 flex-1 min-w-0">
                                <div
                                  className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0"
                                  style={{
                                    backgroundColor:
                                      item.color || sectionColor,
                                  }}
                                />
                                <div className="min-w-0">
                                  <span className="text-[#0C1B33] text-[13px] sm:text-[14px] font-semibold block">
                                    {item.label}
                                    {item.level && (
                                      <span className="font-mono-bureau text-[8px] sm:text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30 ml-2 font-normal">
                                        {item.level}
                                      </span>
                                    )}
                                  </span>
                                  {item.detail && (
                                    <span className="text-[#0C1B33]/40 text-[11px] sm:text-[12px] leading-relaxed block mt-0.5">
                                      {item.detail}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Right: value — below on mobile, beside on desktop */}
                              {item.value && (
                                <span className="font-mono-bureau text-[10px] sm:text-[11px] tracking-[0.05em] text-[#0C1B33]/60 flex-shrink-0 sm:text-right pl-8 sm:pl-0 pt-0.5">
                                  {item.value}
                                </span>
                              )}
                            </div>

                            {/* Eligibility & URL — shown for program items */}
                            {(item.whoQualifies || item.eligibilityRules || item.url) && (
                              <div className="report-eligibility ml-[22px] sm:ml-[22px] mt-2.5 pl-4 border-l-2 border-[#0C1B33]/6 space-y-2">
                                {item.whoQualifies && (
                                  <div>
                                    <span className="font-mono-bureau text-[8px] sm:text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-0.5">
                                      Who Qualifies
                                    </span>
                                    <span className="text-[#0C1B33]/55 text-[11px] sm:text-[12px] leading-relaxed block">
                                      {item.whoQualifies}
                                    </span>
                                  </div>
                                )}
                                {item.eligibilityRules && item.eligibilityRules.length > 0 && (
                                  <div>
                                    <span className="font-mono-bureau text-[8px] sm:text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-1">
                                      Requirements
                                    </span>
                                    <ul className="space-y-0.5">
                                      {item.eligibilityRules.map((rule, rIdx) => (
                                        <li key={rIdx} className="flex items-start gap-2 text-[11px] sm:text-[12px] text-[#0C1B33]/50 leading-relaxed">
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
                                    className="inline-flex items-center gap-1.5 text-[11px] text-[#2563EB] hover:text-[#1d4ed8] transition-colors font-mono-bureau tracking-wide print-url"
                                  >
                                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                    More information
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

            {/* ── Recommended Actions ── */}
            {report.recommendedActions &&
              report.recommendedActions.length > 0 && (
                <div className="mb-12">
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

            {/* ── Footer ── */}
            <div className="report-footer mt-16 pt-6 border-t border-dashed border-[#0C1B33]/15">
              <p className="text-[#0C1B33]/35 text-[12px] leading-relaxed mb-2">
                This report was generated on {formattedDate} by Chicago
                Incentive Explorer.
              </p>
              <p className="text-[#0C1B33]/25 text-[11px] leading-relaxed">
                Data verified as of Dec 2025. This is an informational tool
                &mdash; confirm eligibility with program administrators.
              </p>
            </div>
          </div>
        </div>

        {/* ── Action Buttons (outside the document) ── */}
        <div className="report-actions mx-auto max-w-[850px] flex flex-col sm:flex-row items-center justify-center gap-3 mt-8 print:hidden">
          <button
            onClick={handlePrint}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#1d4ed8] transition-colors cursor-pointer shadow-md"
          >
            <Printer className="w-3.5 h-3.5" />
            Download PDF
          </button>
          {reportWizardState && (
            <button
              onClick={handleShareReport}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-emerald-300 text-emerald-700 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-emerald-50 transition-colors cursor-pointer shadow-md"
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
          {isInstantMode && onRefine && (
            <button
              onClick={onRefine}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#2563EB]/30 text-[#2563EB] font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#EFF3FB] transition-colors cursor-pointer shadow-md"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              Refine This Report
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
      </div>
    </motion.div>
  );
}
