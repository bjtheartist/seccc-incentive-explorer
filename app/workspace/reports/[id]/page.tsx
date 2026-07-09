"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { ReportDisplay } from "@/components/report/ReportDisplay";
import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";

export default function SavedReportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { status } = useSession();
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [wizardState, setWizardState] = useState<WizardState | undefined>();
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

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
        setReport(data.report.reportData as GeneratedReport);
        setWizardState(data.report.wizardState as WizardState);
      })
      .finally(() => setLoading(false));
  }, [params.id, router, status]);

  if (loading || status === "loading") {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[#0C1B33]/40" />
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="min-h-screen bg-[#FAF9F6]">
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
      <ReportDisplay
        report={report}
        wizardState={wizardState}
        onStartOver={() => router.push("/report")}
        onRefine={() => router.push("/report")}
      />
    </div>
  );
}
