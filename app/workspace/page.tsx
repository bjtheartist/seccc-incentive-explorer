"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowRight, FileText, Loader2, Target } from "lucide-react";
import { PendingReportSaver } from "@/components/workspace/PendingReportSaver";
import type { BusinessProject, SavedReportSummary } from "@/lib/workspace";

export default function WorkspacePage() {
  return (
    <Suspense fallback={null}>
      <WorkspaceContent />
      <PendingReportSaver />
    </Suspense>
  );
}

function WorkspaceContent() {
  const { status } = useSession();
  const [projects, setProjects] = useState<BusinessProject[] | null>(null);
  const [reports, setReports] = useState<SavedReportSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    Promise.all([
      fetch("/api/projects").then((res) => res.json()),
      fetch("/api/saved-reports").then((res) => res.json()),
    ])
      .then(([projectData, reportData]) => {
        setProjects(projectData.projects || []);
        setReports(reportData.reports || []);
      })
      .catch(() => setError("Could not load your workspace."))
  }, [status]);

  const isLoading =
    status === "loading" ||
    (status === "authenticated" && (projects === null || reports === null));

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[#0C1B33]/40" />
      </div>
    );
  }

  if (status !== "authenticated") {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center px-6">
        <div className="max-w-md bg-white border border-[#0C1B33]/10 shadow-xl p-8 text-center">
          <p className="font-mono-bureau text-[10px] tracking-[0.25em] uppercase text-[#2563EB]/60 mb-4">
            Business Workspace
          </p>
          <h1 className="font-editorial text-3xl text-[#0C1B33] mb-3">
            Save reports and track your next step.
          </h1>
          <p className="text-sm text-[#0C1B33]/45 leading-relaxed mb-6">
            Sign in to create a workspace for incentive reports, business goals,
            and project checklists.
          </p>
          <Link
            href="/login?callbackUrl=/workspace"
            className="inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white px-6 py-3 font-mono-bureau text-[10px] tracking-[0.15em] uppercase"
          >
            Sign in or create account
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-6 py-14">
      <div className="container mx-auto max-w-6xl">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-10">
          <div>
            <p className="font-mono-bureau text-[10px] tracking-[0.25em] uppercase text-[#2563EB]/60 mb-3">
              Business Workspace
            </p>
            <h1 className="font-editorial text-4xl text-[#0C1B33] mb-2">
              Your incentive projects
            </h1>
            <p className="text-sm text-[#0C1B33]/45 leading-relaxed max-w-xl">
              Save reports as projects, track the goal behind each lookup, and
              keep the next steps visible.
            </p>
          </div>
          <Link
            href="/report"
            className="inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white px-5 py-3 font-mono-bureau text-[10px] tracking-[0.15em] uppercase"
          >
            Generate Report
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 text-sm mb-6">
            {error}
          </div>
        )}

        <section className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]/70">
              Projects
            </h2>
            <span className="text-[12px] text-[#0C1B33]/35">{projects?.length || 0} saved</span>
          </div>
          {(projects || []).length === 0 ? (
            <EmptyState
              icon={<Target className="w-5 h-5" />}
              title="No saved projects yet"
              text="Generate a report and save it to create your first goal-based workspace."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(projects || []).map((project) => {
                const completed = project.checklist.filter((item) => item.completed).length;
                return (
                  <Link
                    key={project.id}
                    href={`/workspace/projects/${project.id}`}
                    className="bg-white border border-[#0C1B33]/10 p-5 hover:border-[#2563EB]/30 transition-colors"
                  >
                    <p className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#2563EB]/60 mb-2">
                      {project.goalLabel}
                    </p>
                    <h3 className="text-[#0C1B33] font-medium mb-2">
                      {project.address || "Project workspace"}
                    </h3>
                    <p className="text-[12px] text-[#0C1B33]/40 mb-4">
                      {completed} of {project.checklist.length} next steps complete
                    </p>
                    <div className="h-1.5 bg-[#0C1B33]/6">
                      <div
                        className="h-full bg-[#2563EB]/70"
                        style={{
                          width: `${project.checklist.length ? (completed / project.checklist.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]/70">
              Recent Reports
            </h2>
            <span className="text-[12px] text-[#0C1B33]/35">{reports?.length || 0} saved</span>
          </div>
          {(reports || []).length === 0 ? (
            <EmptyState
              icon={<FileText className="w-5 h-5" />}
              title="No saved reports yet"
              text="Saved report snapshots will appear here."
            />
          ) : (
            <div className="bg-white border border-[#0C1B33]/10 divide-y divide-[#0C1B33]/6">
              {(reports || []).slice(0, 8).map((report) => (
                <Link
                  key={report.id}
                  href={`/workspace/reports/${report.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#0C1B33]/[0.02]"
                >
                  <div>
                    <h3 className="text-sm text-[#0C1B33]/80 font-medium">{report.title}</h3>
                    <p className="text-[12px] text-[#0C1B33]/35 mt-0.5">
                      {report.address || report.reportType}
                    </p>
                  </div>
                  <span className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/30">
                    Open
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="bg-white border border-dashed border-[#0C1B33]/15 px-6 py-10 text-center">
      <div className="w-10 h-10 mx-auto mb-4 bg-[#0C1B33]/[0.04] text-[#0C1B33]/35 flex items-center justify-center">
        {icon}
      </div>
      <h3 className="text-sm text-[#0C1B33]/75 font-medium mb-1">{title}</h3>
      <p className="text-[12px] text-[#0C1B33]/35">{text}</p>
    </div>
  );
}
