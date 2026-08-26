"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { ReportDisplay } from "@/components/report/ReportDisplay";
import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";
import { normalizeSavedReport, SAVED_REPORT_LOAD_ERROR } from "@/lib/report-schema";
import { deriveIsInstantMode, derivePersonaLensVisible } from "@/lib/workspace";

export default function SavedReportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { status } = useSession();
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [wizardState, setWizardState] = useState<WizardState | undefined>();
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  // Set when the report cannot be shown. The row still exists and still belongs
  // to the user, so the page has to say so and keep Delete reachable rather
  // than redirect or crash. Two distinct causes with two distinct messages —
  // a fetch that failed is retryable, a blob this build cannot read is not.
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (deleting) return;
    if (!window.confirm("Delete this saved report? This cannot be undone.")) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/saved-reports/${params.id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) throw new Error();
      router.replace("/workspace");
    } catch {
      setDeleting(false);
      window.alert("Could not delete the report. Try again.");
    }
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(
        `/login?callbackUrl=${encodeURIComponent(`/workspace/reports/${params.id}`)}`
      );
      return;
    }
    if (status !== "authenticated") return;

    fetch(`/api/saved-reports/${params.id}`)
      .then(async (res) => {
        if (res.status === 404) {
          router.replace("/workspace");
          return null;
        }
        if (!res.ok) throw new Error("Could not load report");
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        // Stored JSON is a snapshot of an older engine, not a GeneratedReport
        // by construction — normalize instead of casting.
        const normalized = normalizeSavedReport(data.report?.reportData);
        if (!normalized.ok) {
          console.warn(
            `Saved report ${params.id} failed to normalize (${normalized.reason}): ${normalized.detail}`
          );
          setLoadError(SAVED_REPORT_LOAD_ERROR);
          return;
        }
        const persistedTitle = data.report?.title;
        setReport({
          ...normalized.report,
          title:
            typeof persistedTitle === "string" && persistedTitle.trim()
              ? persistedTitle
              : normalized.report.title,
        });
        setWizardState(data.report.wizardState as WizardState);
      })
      .catch(() => setLoadError("This report could not be loaded right now. Refresh to try again."))
      .finally(() => setLoading(false));
  }, [params.id, router, status]);

  if (loading || status === "loading") {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[#0C1B33]/40" />
      </div>
    );
  }

  if (!report && loadError === null) return null;

  const header = (
    <div className="max-w-[850px] mx-auto px-6 pt-8 print:hidden flex items-center justify-between gap-4">
      <Link
        href="/workspace"
        className="inline-flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/40 hover:text-[#0C1B33]"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Workspace
      </Link>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="inline-flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/40 hover:text-red-600 transition-colors disabled:opacity-50"
      >
        {deleting ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Trash2 className="w-3.5 h-3.5" />
        )}
        Delete Report
      </button>
    </div>
  );

  if (!report) {
    return (
      <div className="min-h-screen bg-[#FAF9F6]">
        {header}
        <div className="max-w-[850px] mx-auto px-6 py-16">
          <div className="border border-[#0C1B33]/10 bg-white px-6 py-8">
            <p className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/40">
              Report Unavailable
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-[#0C1B33]/70">
              {loadError}
            </p>
            <Link
              href="/report"
              className="mt-6 inline-flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33] underline underline-offset-4"
            >
              Run a new report
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      {header}
      <ReportDisplay
        report={report}
        wizardState={wizardState}
        onStartOver={() => router.push("/report")}
        // Saved location snapshots re-enter the refine flow with the address
        // preserved (audit RF1: isInstantMode was never passed here, so the
        // refine CTA could never render on a saved report).
        isInstantMode={deriveIsInstantMode(wizardState)}
        // Persona lens stays available on goal-refined saved reports too —
        // audience and goal are orthogonal (Tier 1b, BM4).
        showPersonaLens={derivePersonaLensVisible(wizardState)}
        analyticsSource="workspace"
        onRefine={() => {
          if (wizardState?.lat != null && wizardState?.lon != null) {
            router.push(
              `/report?refine=true&lat=${wizardState.lat}&lon=${wizardState.lon}&addr=${encodeURIComponent(wizardState.address || "")}&src=workspace`
            );
            return;
          }
          router.push("/report");
        }}
      />
    </div>
  );
}
