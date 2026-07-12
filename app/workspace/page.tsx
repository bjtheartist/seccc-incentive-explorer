"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  ArrowRight,
  Building2,
  Check,
  ClipboardCheck,
  Eye,
  FileText,
  Loader2,
  MapPin,
  Pencil,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { PendingReportSaver } from "@/components/workspace/PendingReportSaver";
import type { BusinessProject, SavedReportSummary } from "@/lib/workspace";
import type { WatchedArea } from "@/lib/types/user-intel";

interface PreparationPacketSummary {
  id: string;
  title: string;
  programName: string;
  projectAddress: string | null;
  status: string;
  businessName: string;
  timeline?: {
    minWeeks?: number;
    maxWeeks?: number;
    estimatedMinWeeks?: number;
    estimatedMaxWeeks?: number;
  } | null;
  timelines?: {
    foundation?: { estimatedWeeks?: { min?: number; max?: number } | null } | null;
    application?: { estimatedWeeks?: { min?: number; max?: number } | null } | null;
  } | null;
  updatedAt: string;
}

function compactWeeks(weeks?: { min?: number; max?: number } | null): string {
  const min = typeof weeks?.min === "number" ? weeks.min : null;
  const max = typeof weeks?.max === "number" ? weeks.max : null;
  if (max === null) return "";
  if (min === null || min === max) return `about ${max} wks`;
  return `about ${min}–${max} wks`;
}

const PREPARATION_STATUS_LABELS: Record<string, string> = {
  foundation_complete: "Foundation complete",
  needs_information: "Needs information",
  waiting_on_others: "Waiting on others",
  needs_advisor: "Needs advisor review",
  requires_certification: "Applicant certification required",
  ready_to_submit: "Prepared for applicant certification",
};

function preparationStatusLabel(status: string): string {
  return PREPARATION_STATUS_LABELS[status] || "In preparation";
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={null}>
      <WorkspaceContent />
      <PendingReportSaver />
    </Suspense>
  );
}

function parseAreaPoint(area: WatchedArea): { lat: number; lon: number } | null {
  const parts = area.areaId.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  return { lat: parts[0], lon: parts[1] };
}

function WorkspaceContent() {
  const { status } = useSession();
  const [projects, setProjects] = useState<BusinessProject[] | null>(null);
  const [reports, setReports] = useState<SavedReportSummary[] | null>(null);
  const [packets, setPackets] = useState<PreparationPacketSummary[] | null>(null);
  const [watchedAreas, setWatchedAreas] = useState<WatchedArea[] | null>(null);
  const [error, setError] = useState("");

  // Report row actions
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    Promise.all([
      fetch("/api/projects").then((res) => res.json()),
      fetch("/api/saved-reports").then((res) => res.json()),
      fetch("/api/incentive-preparation").then((res) => res.json()),
      fetch("/api/watchlist").then((res) => res.json()),
    ])
      .then(([projectData, reportData, packetData, watchlistData]) => {
        setProjects(projectData.projects || []);
        setReports(reportData.reports || []);
        setPackets(packetData.packets || []);
        setWatchedAreas(watchlistData.areas || []);
      })
      .catch(() => setError("Could not load your workspace."));
  }, [status]);

  const startRename = (report: SavedReportSummary) => {
    setRenamingId(report.id);
    setRenameDraft(report.title);
  };

  const commitRename = async (reportId: string) => {
    const title = renameDraft.trim();
    if (!title) {
      setRenamingId(null);
      return;
    }
    setRowBusyId(reportId);
    try {
      const res = await fetch(`/api/saved-reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error();
      setReports((prev) =>
        (prev || []).map((r) => (r.id === reportId ? { ...r, title } : r))
      );
      setRenamingId(null);
    } catch {
      setError("Could not rename the report.");
    } finally {
      setRowBusyId(null);
    }
  };

  const deleteReport = async (report: SavedReportSummary) => {
    if (!window.confirm(`Delete "${report.title}"? This cannot be undone.`)) {
      return;
    }
    setRowBusyId(report.id);
    try {
      const res = await fetch(`/api/saved-reports/${report.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setReports((prev) => (prev || []).filter((r) => r.id !== report.id));
    } catch {
      setError("Could not delete the report.");
    } finally {
      setRowBusyId(null);
    }
  };

  const unwatchArea = async (area: WatchedArea) => {
    try {
      const res = await fetch(
        `/api/watchlist?areaType=${encodeURIComponent(area.areaType)}&areaId=${encodeURIComponent(area.areaId)}`,
        { method: "DELETE" }
      );
      if (!res.ok && res.status !== 404) throw new Error();
      setWatchedAreas((prev) => (prev || []).filter((a) => a.id !== area.id));
    } catch {
      setError("Could not remove the watched area.");
    }
  };

  const isLoading =
    status === "loading" ||
    (status === "authenticated" &&
      (projects === null || reports === null || packets === null || watchedAreas === null));

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
              Your Business File and application prep
            </h1>
            <p className="text-sm text-[#0C1B33]/45 leading-relaxed max-w-xl">
              Save reports as projects, track the goal behind each lookup, and
              keep the next steps visible.
            </p>
          </div>
          <Link
            href="/report?source=workspace"
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]/70">
                Application prep
              </h2>
              <p className="text-[12px] text-[#0C1B33]/35 mt-1">
                Powered by your Business File. Your information carries into every application.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Link
                href="/workspace/business-file"
                className="inline-flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/60 hover:text-[#0C1B33]"
              >
                <Building2 className="w-3.5 h-3.5" />
                Your Business File
              </Link>
              <Link
                href="/workspace/incentive-preparation/new"
                className="inline-flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#2563EB] hover:text-[#1d4ed8]"
              >
                <ClipboardCheck className="w-3.5 h-3.5" />
                Start application prep
              </Link>
            </div>
          </div>
          {(packets || []).length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="w-5 h-5" />}
              title="No application prep started yet"
              text="Start from a likely-match report to preserve your business facts and map the work needed before an official application."
              action={
                <Link
                  href="/workspace/incentive-preparation/new"
                  className="inline-flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#2563EB] hover:text-[#1d4ed8] mt-3"
                >
                  Start application prep
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              }
            />
          ) : (
            <div className="bg-white border border-[#0C1B33]/10 divide-y divide-[#0C1B33]/6">
              {(packets || []).slice(0, 8).map((packet) => {
                const minWeeks =
                  packet.timeline?.estimatedMinWeeks ?? packet.timeline?.minWeeks;
                const maxWeeks =
                  packet.timeline?.estimatedMaxWeeks ?? packet.timeline?.maxWeeks;
                const range =
                  typeof minWeeks === "number" && typeof maxWeeks === "number"
                    ? `${minWeeks}-${maxWeeks} week preparation window`
                    : "Preparation window being assessed";

                const timelines = packet.timelines;
                const foundationMax = timelines?.foundation?.estimatedWeeks?.max;
                const foundationCompact = compactWeeks(
                  timelines?.foundation?.estimatedWeeks,
                );
                const foundationLine = timelines
                  ? foundationMax === 0
                    ? "Business File: complete"
                    : foundationCompact
                      ? `Business File: ${foundationCompact} left`
                      : "Business File: in progress"
                  : null;
                const applicationCompact = compactWeeks(
                  timelines?.application?.estimatedWeeks,
                );
                const applicationLine = timelines
                  ? packet.programName
                    ? `${packet.programName}: ${
                        applicationCompact ? `${applicationCompact} prep` : "prep window being assessed"
                      }`
                    : "No program chosen yet — pick one to start an application"
                  : null;

                return (
                  <Link
                    key={packet.id}
                    href={`/workspace/incentive-preparation/${packet.id}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 hover:bg-[#0C1B33]/[0.02]"
                  >
                    <div className="min-w-0">
                      <p className="font-mono-bureau text-[9px] tracking-[0.16em] uppercase text-[#2563EB]/70 mb-1">
                        {preparationStatusLabel(packet.status)}
                      </p>
                      <h3 className="text-sm text-[#0C1B33]/80 font-medium truncate">
                        {packet.title || packet.programName}
                      </h3>
                      <p className="text-[12px] text-[#0C1B33]/35 mt-0.5">
                        {packet.businessName}
                        {packet.projectAddress ? ` · ${packet.projectAddress}` : ""}
                      </p>
                      {timelines && (
                        <div className="mt-1.5 space-y-0.5">
                          <p className="text-[11px] text-[#0C1B33]/45 truncate">{foundationLine}</p>
                          <p className="text-[11px] text-[#0C1B33]/45 truncate">{applicationLine}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {!timelines && (
                        <span className="text-[11px] text-[#0C1B33]/35">{range}</span>
                      )}
                      <ArrowRight className="w-3.5 h-3.5 text-[#0C1B33]/30" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

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

        <section className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]/70">
              Watched Areas
            </h2>
            <span className="text-[12px] text-[#0C1B33]/35">
              {watchedAreas?.length || 0} watched
            </span>
          </div>
          {(watchedAreas || []).length === 0 ? (
            <EmptyState
              icon={<Eye className="w-5 h-5" />}
              title="No watched areas yet"
              text="Tap a location on the map and choose &ldquo;Watch this area&rdquo; to get weekly deadline alerts for it."
              action={
                <Link
                  href="/map"
                  className="inline-flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#2563EB] hover:text-[#1d4ed8] mt-3"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Open the map
                </Link>
              }
            />
          ) : (
            <div className="bg-white border border-[#0C1B33]/10 divide-y divide-[#0C1B33]/6">
              {(watchedAreas || []).map((area) => {
                const point = parseAreaPoint(area);
                const label = area.areaLabel || area.areaId;
                return (
                  <div
                    key={area.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <h3 className="text-sm text-[#0C1B33]/80 font-medium truncate">
                        {label}
                      </h3>
                      <p className="text-[12px] text-[#0C1B33]/35 mt-0.5">
                        Watching since{" "}
                        {new Date(area.createdAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      {point && (
                        <Link
                          href={`/map?lat=${point.lat}&lon=${point.lon}&label=${encodeURIComponent(label)}`}
                          className="inline-flex items-center gap-1.5 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#2563EB]/80 hover:text-[#2563EB]"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          View on map
                        </Link>
                      )}
                      <button
                        onClick={() => unwatchArea(area)}
                        className="inline-flex items-center gap-1.5 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/35 hover:text-red-600"
                        title="Stop watching this area"
                      >
                        <X className="w-3.5 h-3.5" />
                        Unwatch
                      </button>
                    </div>
                  </div>
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
              {(reports || []).slice(0, 8).map((report) => {
                const isRenaming = renamingId === report.id;
                const isBusy = rowBusyId === report.id;
                return (
                  <div
                    key={report.id}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#0C1B33]/[0.02]"
                  >
                    <div className="min-w-0 flex-1">
                      {isRenaming ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename(report.id);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            autoFocus
                            className="flex-1 border border-[#2563EB]/40 px-3 py-1.5 text-sm text-[#0C1B33] focus:outline-none focus:border-[#2563EB]"
                          />
                          <button
                            onClick={() => commitRename(report.id)}
                            disabled={isBusy}
                            className="p-1.5 text-[#2563EB] hover:bg-[#2563EB]/5 disabled:opacity-50"
                            title="Save name"
                          >
                            {isBusy ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Check className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => setRenamingId(null)}
                            className="p-1.5 text-[#0C1B33]/35 hover:text-[#0C1B33]"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <Link href={`/workspace/reports/${report.id}`} className="block">
                          <h3 className="text-sm text-[#0C1B33]/80 font-medium truncate">
                            {report.title}
                          </h3>
                          <p className="text-[12px] text-[#0C1B33]/35 mt-0.5">
                            {report.address || report.reportType}
                          </p>
                        </Link>
                      )}
                    </div>
                    {!isRenaming && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => startRename(report)}
                          className="p-2 text-[#0C1B33]/30 hover:text-[#2563EB] transition-colors"
                          title="Rename report"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteReport(report)}
                          disabled={isBusy}
                          className="p-2 text-[#0C1B33]/30 hover:text-red-600 transition-colors disabled:opacity-50"
                          title="Delete report"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <Link
                          href={`/workspace/reports/${report.id}`}
                          className="ml-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/30 hover:text-[#0C1B33]"
                        >
                          Open
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
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
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-dashed border-[#0C1B33]/15 px-6 py-10 text-center">
      <div className="w-10 h-10 mx-auto mb-4 bg-[#0C1B33]/[0.04] text-[#0C1B33]/35 flex items-center justify-center">
        {icon}
      </div>
      <h3 className="text-sm text-[#0C1B33]/75 font-medium mb-1">{title}</h3>
      <p className="text-[12px] text-[#0C1B33]/35">{text}</p>
      {action}
    </div>
  );
}
