"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Check, ClipboardCheck, FileText, Loader2 } from "lucide-react";
import type { BusinessProject, ChecklistItem, SavedReportSummary } from "@/lib/workspace";

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { status } = useSession();
  const [project, setProject] = useState<BusinessProject | null>(null);
  const [reports, setReports] = useState<SavedReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(
        `/login?callbackUrl=${encodeURIComponent(`/workspace/projects/${params.id}`)}`
      );
      return;
    }
    if (status !== "authenticated") return;

    fetch(`/api/projects/${params.id}`)
      .then(async (res) => {
        if (res.status === 404) {
          router.replace("/workspace");
          return null;
        }
        if (!res.ok) throw new Error("Could not load project");
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        setProject(data.project);
        setReports(data.reports || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.id, router, status]);

  const toggleItem = async (item: ChecklistItem) => {
    if (!project) return;
    const nextChecklist = project.checklist.map((current) =>
      current.id === item.id
        ? { ...current, completed: !current.completed }
        : current
    );
    setProject({ ...project, checklist: nextChecklist });
    setSaving(true);

    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checklist: nextChecklist }),
      });
      if (!res.ok) throw new Error("Could not update checklist");
      const data = await res.json();
      setProject(data.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update checklist");
    } finally {
      setSaving(false);
    }
  };

  if (loading || status === "loading") {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[#0C1B33]/40" />
      </div>
    );
  }

  if (!project) return null;

  const completed = project.checklist.filter((item) => item.completed).length;
  const preparationParams = new URLSearchParams({
    projectId: project.id,
    goalType: project.goalType,
  });
  if (project.address) preparationParams.set("address", project.address);
  if (project.industry) preparationParams.set("industry", project.industry);

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-6 py-12">
      <div className="container mx-auto max-w-5xl">
        <Link
          href="/workspace"
          className="inline-flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/40 hover:text-[#0C1B33] mb-8"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Workspace
        </Link>

        <div className="bg-white border border-[#0C1B33]/10 shadow-xl mb-8">
          <div className="bg-[#0C1B33] px-7 py-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
            <div>
              <p className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-white/45 mb-3">
                {project.goalLabel}
              </p>
              <h1 className="font-editorial text-3xl text-white leading-tight mb-3">
                {project.address || "Saved project"}
              </h1>
              <p className="text-white/45 text-sm">
                {completed} of {project.checklist.length} next steps complete
                {saving ? " · saving..." : ""}
              </p>
            </div>
            <Link
              href={`/workspace/incentive-preparation/new?${preparationParams.toString()}`}
              className="inline-flex items-center justify-center gap-2 bg-white text-[#0C1B33] px-5 py-3 font-mono-bureau text-[10px] tracking-[0.13em] uppercase hover:bg-white/90 transition-colors shrink-0"
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              Start Preparation Packet
            </Link>
          </div>

          {error && (
            <div className="mx-7 mt-6 bg-red-50 border border-red-100 text-red-700 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_0.7fr] gap-0">
            <section className="p-7 border-r border-[#0C1B33]/8">
              <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]/70 mb-5">
                Next-Step Checklist
              </h2>
              <div className="space-y-2">
                {project.checklist.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => toggleItem(item)}
                    className="w-full flex items-start gap-3 text-left border border-[#0C1B33]/8 px-4 py-3 hover:border-[#2563EB]/30 transition-colors"
                  >
                    <span
                      className={`mt-0.5 w-5 h-5 border flex items-center justify-center flex-shrink-0 ${
                        item.completed
                          ? "bg-[#2563EB] border-[#2563EB] text-white"
                          : "border-[#0C1B33]/15 text-transparent"
                      }`}
                    >
                      <Check className="w-3 h-3" />
                    </span>
                    <span
                      className={`text-sm leading-relaxed ${
                        item.completed
                          ? "text-[#0C1B33]/35 line-through"
                          : "text-[#0C1B33]/70"
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <aside className="p-7">
              <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]/70 mb-5">
                Saved Reports
              </h2>
              {reports.length === 0 ? (
                <p className="text-sm text-[#0C1B33]/40 leading-relaxed">
                  Reports saved to this project will appear here.
                </p>
              ) : (
                <div className="space-y-2">
                  {reports.map((report) => (
                    <Link
                      key={report.id}
                      href={`/workspace/reports/${report.id}`}
                      className="block border border-[#0C1B33]/8 px-4 py-3 hover:border-[#2563EB]/30"
                    >
                      <div className="flex items-start gap-3">
                        <FileText className="w-4 h-4 text-[#2563EB]/60 mt-0.5" />
                        <div>
                          <h3 className="text-sm text-[#0C1B33]/75 font-medium">
                            {report.title}
                          </h3>
                          <p className="text-[11px] text-[#0C1B33]/35 mt-0.5">
                            {new Date(report.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
