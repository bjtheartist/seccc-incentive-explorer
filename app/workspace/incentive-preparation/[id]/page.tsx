"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  Clock3,
  FilePlus2,
  Loader2,
  LockKeyhole,
  Plus,
  Send,
} from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import { GOAL_OPTIONS } from "@/lib/workspace";
import {
  extractDocumentFlags,
  extractFoundationRefresh,
  extractPacketDocuments,
  extractPreparationPacket,
  extractPreparationSupportRequests,
  isDocumentTask,
  isFoundationScopeTask,
  type DocumentFlags,
  type FoundationRefreshView,
  type PacketDocumentView,
  type PreparationPacket,
  type PreparationSupportRequest,
  type PreparationTask,
  type PreparationTimelineView,
} from "@/components/incentive-preparation/types";
import { DocumentAttachments } from "@/components/incentive-preparation/document-attachments";

interface ProgramOption {
  id: string;
  name: string;
}

function packetPath(id: string) {
  return `/workspace/incentive-preparation/${id}`;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => ({}));
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function responseError(body: Record<string, unknown>, fallback: string) {
  return typeof body.error === "string" && body.error.trim() ? body.error : fallback;
}

const STATUS_LABELS: Record<string, string> = {
  foundation_complete: "Foundation complete",
  needs_information: "Needs information",
  waiting_on_others: "Waiting on others",
  needs_advisor: "Needs advisor review",
  requires_certification: "Applicant certification required",
  ready_to_submit: "Prepared for applicant certification",
  needs_document: "Needs document",
  needs_owner_answer: "Needs owner answer",
  external_dependency: "External dependency",
  complete: "Complete",
  business: "Business",
  advisor: "Advisor",
  accountant: "Accountant",
  landlord: "Landlord",
  local_partner: "Local partner",
  program_administrator: "Program administrator",
  "improve-storefront": "Improve storefront",
  "buy-equipment": "Buy equipment",
  "hire-staff": "Hire staff",
  "expand-location": "Expand current location",
  "open-relocate": "Open or relocate",
  "acquire-vacant-property": "Acquire vacant property",
  "development-feasibility": "Evaluate vacancy opportunity",
};

const SUPPORT_SCOPE_OPTIONS = [
  { value: "business_profile", label: "Business profile" },
  { value: "contact_information", label: "Contact information" },
  { value: "packet", label: "Preparation packet" },
  { value: "documents", label: "Supporting documents" },
] as const;

function statusLabel(status: string) {
  return STATUS_LABELS[status] || status.replace(/[_-]/g, " ");
}

function scopeLabel(scope: string) {
  return SUPPORT_SCOPE_OPTIONS.find((option) => option.value === scope)?.label || scope;
}

function formatDateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function statusClass(status: string) {
  if (status === "complete") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "external_dependency") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "needs_advisor") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-[#0C1B33]/12 bg-[#FAF9F6] text-[#0C1B33]/55";
}

function formatWeekRange(weeks: { min: number; max: number }): string {
  if (weeks.max <= 0) return "Timing estimate pending";
  if (weeks.min === weeks.max) return `About ${weeks.max} weeks`;
  return `About ${weeks.min}–${weeks.max} weeks`;
}

export default function PreparationPacketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { status } = useSession();
  const [packet, setPacket] = useState<PreparationPacket | null>(null);
  const [documentFlags, setDocumentFlags] = useState<DocumentFlags>({
    enabled: false,
    extractEnabled: false,
  });
  const [documents, setDocuments] = useState<PacketDocumentView[]>([]);
  const [foundationRefresh, setFoundationRefresh] = useState<FoundationRefreshView | null>(null);
  const [supportRequests, setSupportRequests] = useState<PreparationSupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTaskId, setSavingTaskId] = useState("");
  const [error, setError] = useState("");
  const [supportError, setSupportError] = useState("");
  const [supportSuccess, setSupportSuccess] = useState("");
  const [requestingSupport, setRequestingSupport] = useState(false);
  const [targetOrganization, setTargetOrganization] = useState("");
  const [requestedHelp, setRequestedHelp] = useState("");
  const [dataScopes, setDataScopes] = useState<string[]>([]);
  const [consentToShare, setConsentToShare] = useState(false);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [selectedGoal, setSelectedGoal] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [selectingProgram, setSelectingProgram] = useState(false);
  const [selectProgramError, setSelectProgramError] = useState("");

  const hasProgram = Boolean(packet?.selectedProgram.label);

  useEffect(() => {
    const id = params.id;
    if (status === "unauthenticated") {
      router.replace(`/login?callbackUrl=${encodeURIComponent(packetPath(id))}`);
      return;
    }
    if (status !== "authenticated") return;

    let active = true;
    fetch(`/api/incentive-preparation/${id}`)
      .then(async (response) => {
        const body = await responseBody(response);
        if (response.status === 401) {
          router.replace(`/login?callbackUrl=${encodeURIComponent(packetPath(id))}`);
          return null;
        }
        if (response.status === 404) {
          router.replace("/workspace");
          return null;
        }
        if (!response.ok) throw new Error(responseError(body, "Could not load this packet."));
        return body;
      })
      .then((body) => {
        if (!active || !body) return;
        const loadedPacket = extractPreparationPacket(body);
        if (!loadedPacket) throw new Error("The preparation packet response was incomplete.");
        setPacket(loadedPacket);
        setDocumentFlags(extractDocumentFlags(body));
        setFoundationRefresh(extractFoundationRefresh(body));
        setSupportRequests(extractPreparationSupportRequests(body));
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load this packet.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [params.id, router, status]);

  // A foundation-first packet needs the program list so the owner can choose a
  // target incentive to layer on. Program packets never render the picker.
  useEffect(() => {
    if (!packet || hasProgram || programs.length > 0) return;
    let active = true;
    fetch("/api/programs")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: unknown) => {
        if (!active || !Array.isArray(data)) return;
        const options = data
          .map((entry) => {
            const record = entry as Record<string, unknown>;
            return { id: String(record.id ?? ""), name: String(record.name ?? "") };
          })
          .filter((option) => option.id && option.name);
        setPrograms(options);
      })
      .catch(() => {
        // The picker degrades to disabled if the program list cannot load.
      });
    return () => {
      active = false;
    };
  }, [packet, hasProgram, programs.length]);

  // Load stored documents only when the feature is provisioned. When it is not,
  // the document UI renders nothing and these endpoints are never called.
  useEffect(() => {
    if (!packet || !documentFlags.enabled) return;
    let active = true;
    fetch(`/api/incentive-preparation/${packet.id}/documents`)
      .then((response) => (response.ok ? response.json() : { documents: [] }))
      .then((data: unknown) => {
        if (active) setDocuments(extractPacketDocuments(data));
      })
      .catch(() => {
        // The document list degrades to empty if it cannot load.
      });
    return () => {
      active = false;
    };
  }, [packet, documentFlags.enabled]);

  const selectProgram = async () => {
    if (!packet || selectingProgram) return;
    const program = programs.find((option) => option.id === selectedProgramId);
    if (!selectedGoal || !program) {
      setSelectProgramError("Choose a goal and a target program.");
      return;
    }
    setSelectingProgram(true);
    setSelectProgramError("");
    try {
      const response = await fetch(`/api/incentive-preparation/${packet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalType: selectedGoal,
          programId: program.id,
          programName: program.name,
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) {
        throw new Error(responseError(body, "Could not add this program."));
      }
      const updatedPacket = extractPreparationPacket(body);
      if (updatedPacket) setPacket(updatedPacket);
      setFoundationRefresh(extractFoundationRefresh(body));
      trackEvent("preparation_program_selected", {
        source: "preparation_packet_detail",
        metadata: {
          goalType: selectedGoal,
          programId: program.id,
          programName: program.name,
        },
      });
    } catch (selectError) {
      setSelectProgramError(
        selectError instanceof Error ? selectError.message : "Could not add this program.",
      );
    } finally {
      setSelectingProgram(false);
    }
  };

  const patchTaskStatus = async (
    task: PreparationTask,
    nextStatus: "complete" | "needs_owner_answer",
    event: "preparation_task_updated" | "foundation_refresh_confirmed",
  ) => {
    if (!packet || savingTaskId) return;
    setSavingTaskId(task.id);
    setError("");
    try {
      const response = await fetch(`/api/incentive-preparation/${packet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, status: nextStatus }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(responseError(body, "Could not update this task."));

      const updatedPacket = extractPreparationPacket(body);
      setPacket(
        updatedPacket ?? {
          ...packet,
          tasks: packet.tasks.map((item) =>
            item.id === task.id
              ? { ...item, status: nextStatus }
              : item,
          ),
        },
      );
      setFoundationRefresh(extractFoundationRefresh(body));
      trackEvent(event, {
        source: "preparation_packet_detail",
        metadata: { taskId: task.id, nextStatus },
      });
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update this task.");
    } finally {
      setSavingTaskId("");
    }
  };

  const updateTask = (task: PreparationTask, nextStatus: "complete" | "needs_owner_answer") =>
    patchTaskStatus(task, nextStatus, "preparation_task_updated");

  // The live-profile refresh affordance: the user completed these fields on their
  // business profile after this packet was created. Confirming records the same
  // task-status update — the tool never auto-confirms (spec §3 honesty rulings).
  const confirmFoundationFromProfile = (taskId: string) => {
    const task = packet?.tasks.find((item) => item.id === taskId);
    if (task) void patchTaskStatus(task, "complete", "foundation_refresh_confirmed");
  };

  const toggleScope = (scope: string) => {
    setDataScopes((current) =>
      current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope],
    );
  };

  const submitSupportRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!packet) return;
    setSupportError("");
    setSupportSuccess("");
    if (!targetOrganization.trim() || !requestedHelp.trim() || dataScopes.length === 0) {
      setSupportError("Name the organization, describe the help, and choose the data scope.");
      return;
    }
    if (!consentToShare) {
      setSupportError("Explicit consent is required before business data can be shared.");
      return;
    }

    setRequestingSupport(true);
    try {
      const response = await fetch(`/api/incentive-preparation/${packet.id}/support-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetOrganization: targetOrganization.trim(),
          requestedHelp: requestedHelp.trim(),
          consentScope: dataScopes,
          consent: true,
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(responseError(body, "Could not record the support request."));

      const fromResponse = extractPreparationSupportRequests(body);
      setSupportRequests((current) =>
        fromResponse.length > 0
          ? fromResponse
          : [
              ...current,
              {
                id: `recorded-${Date.now()}`,
                targetOrganization: targetOrganization.trim(),
                requestedHelp: requestedHelp.trim(),
                dataScopes,
                status: "recorded",
              },
            ],
      );
      setSupportSuccess("Recorded. This request has not been accepted or routed.");
      setTargetOrganization("");
      setRequestedHelp("");
      setDataScopes([]);
      setConsentToShare(false);
      trackEvent("preparation_support_requested", {
        source: "preparation_packet_detail",
        metadata: { dataScopeCount: dataScopes.length },
      });
    } catch (requestError) {
      setSupportError(requestError instanceof Error ? requestError.message : "Could not record the support request.");
    } finally {
      setRequestingSupport(false);
    }
  };

  if (loading || status === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-[#FAF9F6]"><Loader2 className="h-5 w-5 animate-spin text-[#0C1B33]/40" /></div>;
  }
  if (status !== "authenticated" || !packet) return null;

  const foundationTasks = packet.tasks.filter((task) => isFoundationScopeTask(task));
  const applicationTasks = packet.tasks.filter((task) => !isFoundationScopeTask(task));
  const documentsByTask = documents.reduce<Record<string, PacketDocumentView[]>>((acc, doc) => {
    (acc[doc.taskId] ??= []).push(doc);
    return acc;
  }, {});
  const profileEditHref = packet.businessProfile.id
    ? `/workspace/business-file/${encodeURIComponent(packet.businessProfile.id)}/edit`
    : null;
  // "N of M requested files attached": M = program-requested document tasks (those
  // carrying a documentSpec); N = those with at least one non-superseded file.
  const requestedDocumentTasks = applicationTasks.filter((task) => task.documentSpec);
  const requestedAttachedCount = requestedDocumentTasks.filter((task) =>
    (documentsByTask[task.id] ?? []).some((doc) => doc.status !== "superseded"),
  ).length;
  const foundationConfirmed = foundationTasks.filter(
    (task) => task.status === "complete",
  ).length;
  const foundationTimeline = packet.timelines.foundation;
  const applicationTimeline = packet.timelines.application;
  const newlyCoveredFoundation = (foundationRefresh?.items ?? []).filter(
    (item) =>
      item.newlyCovered && foundationTasks.some((task) => task.id === item.taskId),
  );
  const criticalPathLabel = (timeline: PreparationTimelineView) =>
    timeline.criticalPath.length
      ? timeline.criticalPath
          .map((taskId) => packet.tasks.find((task) => task.id === taskId)?.title || taskId)
          .join(" then ")
      : "Will update as tasks are confirmed";

  const renderTaskRow = (task: PreparationTask) => (
    <article key={task.id} className="border border-[#0C1B33]/10 px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[#0C1B33]">{task.title}</h3>
            <span className={`border px-2 py-1 font-mono-bureau text-[8px] uppercase tracking-[0.11em] ${statusClass(task.status)}`}>{statusLabel(task.status)}</span>
          </div>
          {task.description && <p className="mt-2 text-sm leading-5 text-[#0C1B33]/55">{task.description}</p>}
          <p className="mt-3 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">Owner: {statusLabel(task.owner)}</p>
        </div>
        {task.isCertification ? (
          <div className="flex max-w-xs items-start gap-2 border border-[#0C1B33]/10 bg-[#FAF9F6] px-3 py-2 text-xs leading-5 text-[#0C1B33]/55"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Only the applicant or authorized representative can complete official certification. This packet does not automate it.</div>
        ) : task.mutable ? (
          <button type="button" onClick={() => updateTask(task, task.status === "complete" ? "needs_owner_answer" : "complete")} disabled={savingTaskId === task.id} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-[#2563EB]/35 px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#2563EB] hover:bg-[#2563EB]/5 disabled:opacity-60">
            {savingTaskId === task.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : task.status === "complete" ? <ChevronRight className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />} {task.status === "complete" ? "Reopen" : "Mark complete"}
          </button>
        ) : null}
      </div>
      {documentFlags.enabled && (isDocumentTask(task) || (documentsByTask[task.id] ?? []).length > 0) && (
        <DocumentAttachments
          packetId={packet.id}
          task={task}
          documents={documentsByTask[task.id] ?? []}
          extractEnabled={documentFlags.extractEnabled}
          profileEditHref={profileEditHref}
          onDocumentsChange={setDocuments}
        />
      )}
    </article>
  );

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-10 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/workspace" className="inline-flex items-center gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/45 hover:text-[#0C1B33]">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Workspace
          </Link>
          <Link href="/workspace/business-file" className="inline-flex items-center gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/45 hover:text-[#0C1B33]">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" /> Business File
          </Link>
        </div>

        <header className="border border-[#0C1B33]/10 bg-[#0C1B33] px-5 py-7 text-white sm:px-7 sm:py-8">
          <p className="mb-3 font-mono-bureau text-[10px] uppercase tracking-[0.23em] text-white/50">{hasProgram ? "Application prep" : "Business File"}</p>
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <h1 className="font-editorial text-3xl leading-tight sm:text-4xl">{packet.businessProfile.legalBusinessName || "Business preparation"}</h1>
              <p className="mt-2 text-sm text-white/60">{packet.businessProfile.physicalAddress || "Project address to be confirmed"}</p>
            </div>
            <span className="border border-white/20 px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-white/80">{statusLabel(packet.preparationStatus || "in preparation")}</span>
          </div>
        </header>

        {error && <p role="alert" className="mt-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className="grid grid-cols-1 border-x border-b border-[#0C1B33]/10 bg-white lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0">
            {hasProgram && (
              <section className="border-b border-[#0C1B33]/8 px-5 py-6 sm:px-7">
                <p className="font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#2563EB]">Likely match</p>
                <h2 className="mt-2 text-xl font-semibold text-[#0C1B33]">{packet.selectedProgram.label || "Program to be confirmed"}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#0C1B33]/55">This is a likely match for preparation purposes, not an eligibility decision, award estimate, or official certification.</p>
                {packet.primaryGoal && <p className="mt-3 text-sm text-[#0C1B33]/70"><span className="font-medium">Goal:</span> {statusLabel(packet.primaryGoal)}</p>}
              </section>
            )}

            <section className="border-b border-[#0C1B33]/8 px-5 py-6 sm:px-7">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-base font-semibold text-[#0C1B33]">Your Business File</h2>
                  <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/45">{foundationConfirmed} of {foundationTasks.length} confirmed</span>
                </div>
                <p className="text-sm leading-5 text-[#0C1B33]/55">Done once, reused for every application you prepare.</p>
                {foundationTimeline.asOfDate && (
                  <p className="mt-1 text-[11px] leading-4 text-[#0C1B33]/45">Estimated as of {formatDateLabel(foundationTimeline.asOfDate)}</p>
                )}
              </div>
              <p className="mt-4 text-sm leading-6 text-[#0C1B33]/75">
                {foundationTimeline.estimatedWeeks.max <= 0
                  ? "Business File basics complete. They carry into every application automatically."
                  : `${formatWeekRange(foundationTimeline.estimatedWeeks)} of work left`}
              </p>
              {newlyCoveredFoundation.length > 0 && (
                <div className="mt-4 border border-[#2563EB]/25 bg-[#2563EB]/[0.04] px-4 py-3">
                  <p className="font-mono-bureau text-[9px] uppercase tracking-[0.13em] text-[#2563EB]">Your profile now covers this</p>
                  <p className="mt-1.5 text-xs leading-5 text-[#0C1B33]/60">You have filled in these details on your live business profile since this packet was created. Confirm to mark them complete here. Nothing is confirmed automatically — your confirmation is the record.</p>
                  <ul className="mt-3 space-y-2">
                    {newlyCoveredFoundation.map((item) => (
                      <li key={item.taskId} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm text-[#0C1B33]/80">{item.title}</span>
                        <button
                          type="button"
                          onClick={() => confirmFoundationFromProfile(item.taskId)}
                          disabled={savingTaskId === item.taskId}
                          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 border border-[#2563EB]/35 bg-white px-3 py-1.5 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#2563EB] hover:bg-[#2563EB]/5 disabled:opacity-60"
                        >
                          {savingTaskId === item.taskId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Confirm from profile
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-4 space-y-3">
                {foundationTasks.length ? (
                  foundationTasks.map(renderTaskRow)
                ) : (
                  <p className="text-sm text-[#0C1B33]/45">No Business File items in this packet yet.</p>
                )}
              </div>
            </section>

            {hasProgram ? (
              <section className="px-5 py-6 sm:px-7">
                <div className="flex flex-col gap-1">
                  <h2 className="text-base font-semibold text-[#0C1B33]">This application{packet.selectedProgram.label ? ` – ${packet.selectedProgram.label}` : ""}</h2>
                  <p className="text-sm leading-5 text-[#0C1B33]/55">{packet.selectedProgram.label || "This program"}&apos;s specific pieces, once your Business File basics are in place.</p>
                  {applicationTimeline.asOfDate && (
                    <p className="mt-1 text-[11px] leading-4 text-[#0C1B33]/45">Estimated as of {formatDateLabel(applicationTimeline.asOfDate)}</p>
                  )}
                  {documentFlags.enabled && requestedDocumentTasks.length > 0 && (
                    <p className="mt-1 font-mono-bureau text-[9px] uppercase tracking-[0.13em] text-[#0C1B33]/45">
                      {requestedAttachedCount} of {requestedDocumentTasks.length} requested files attached
                    </p>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <TimelineFact label="Preparation range" value={formatWeekRange(applicationTimeline.estimatedWeeks)} />
                  <TimelineFact label="Earliest realistic date" value={applicationTimeline.earliestRealisticDate ? formatDateLabel(applicationTimeline.earliestRealisticDate) : "Pending task review"} />
                  <TimelineFact label="Critical path" value={criticalPathLabel(applicationTimeline)} />
                </div>
                <p className="mt-5 text-xs leading-5 text-[#0C1B33]/45">Your Business File items above carry into this application automatically.</p>
                <div className="mt-4 space-y-3">
                  {applicationTasks.map(renderTaskRow)}
                </div>
              </section>
            ) : (
              <section className="px-5 py-6 sm:px-7">
                <div className="flex flex-col gap-1">
                  <h2 className="text-base font-semibold text-[#0C1B33]">Choose a target incentive</h2>
                  <p className="max-w-2xl text-sm leading-5 text-[#0C1B33]/55">No target incentive chosen yet. Your Business File is being prepared and carries into any application you start. Pick a program to layer its specific pieces on top — your confirmed Business File items stay exactly as they are.</p>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-[#0C1B33]/70">
                    Primary goal
                    <select
                      value={selectedGoal}
                      onChange={(event) => setSelectedGoal(event.target.value)}
                      className="mt-1.5 min-h-10 w-full border border-[#0C1B33]/15 bg-white px-3 text-sm text-[#0C1B33] outline-none focus:border-[#2563EB]"
                    >
                      <option value="">Select the main goal</option>
                      {GOAL_OPTIONS.map((goal) => (
                        <option key={goal.id} value={goal.id}>{goal.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-[#0C1B33]/70">
                    Target program
                    <select
                      value={selectedProgramId}
                      onChange={(event) => setSelectedProgramId(event.target.value)}
                      disabled={programs.length === 0}
                      className="mt-1.5 min-h-10 w-full border border-[#0C1B33]/15 bg-white px-3 text-sm text-[#0C1B33] outline-none focus:border-[#2563EB] disabled:opacity-60"
                    >
                      <option value="">{programs.length === 0 ? "Loading programs…" : "Select a program"}</option>
                      {programs.map((program) => (
                        <option key={program.id} value={program.id}>{program.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="mt-3 text-xs leading-5 text-[#0C1B33]/45">Selecting a program identifies a likely match for preparation purposes, not an eligibility decision, award estimate, or official certification. You can verify current requirements with the program administrators.</p>
                {selectProgramError && (
                  <p role="alert" className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{selectProgramError}</p>
                )}
                <button
                  type="button"
                  onClick={selectProgram}
                  disabled={selectingProgram}
                  className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 bg-[#0C1B33] px-4 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-white hover:bg-[#1E3054] disabled:opacity-60"
                >
                  {selectingProgram ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Add this program
                </button>
              </section>
            )}

            {packet.businessProfile.id && (
              <section className="border-t border-[#0C1B33]/8 px-5 py-5 sm:px-7">
                <Link
                  href={`/workspace/incentive-preparation/new?profileId=${encodeURIComponent(packet.businessProfile.id)}`}
                  className="inline-flex min-h-10 items-center gap-2 border border-[#0C1B33]/20 px-4 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33] hover:bg-[#0C1B33]/[0.04]"
                >
                  <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Start another application from this Business File
                </Link>
              </section>
            )}
          </div>

          <aside className="border-t border-[#0C1B33]/10 bg-[#FAF9F6] lg:border-l lg:border-t-0">
            <section className="border-b border-[#0C1B33]/10 px-5 py-6">
              <h2 className="text-base font-semibold text-[#0C1B33]">Business File facts</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <ProfileFact label="Legal name" value={packet.businessProfile.legalBusinessName} />
                <ProfileFact label="Address" value={packet.businessProfile.physicalAddress} />
                <ProfileFact label="Contact" value={packet.businessProfile.contactName} />
                <ProfileFact label="Email" value={packet.businessProfile.contactEmail} />
                <ProfileFact label="Industry" value={packet.businessProfile.industry} />
              </dl>
            </section>

            <section className="px-5 py-6">
              <div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-[#2563EB]" aria-hidden="true" /><h2 className="text-base font-semibold text-[#0C1B33]">Request support</h2></div>
              <p className="mt-2 text-xs leading-5 text-[#0C1B33]/50">Choose exactly what may be shared. A request is recorded only; it is not accepted or routed automatically.</p>
              <form onSubmit={submitSupportRequest} className="mt-4 space-y-4">
                <label className="block text-xs font-medium text-[#0C1B33]/70">Target organization<input value={targetOrganization} onChange={(event) => setTargetOrganization(event.target.value)} className="mt-1.5 min-h-10 w-full border border-[#0C1B33]/15 bg-white px-3 text-sm text-[#0C1B33] outline-none focus:border-[#2563EB]" /></label>
                <label className="block text-xs font-medium text-[#0C1B33]/70">Help requested<textarea value={requestedHelp} onChange={(event) => setRequestedHelp(event.target.value)} rows={3} className="mt-1.5 w-full border border-[#0C1B33]/15 bg-white px-3 py-2 text-sm text-[#0C1B33] outline-none focus:border-[#2563EB]" /></label>
                <fieldset><legend className="text-xs font-medium text-[#0C1B33]/70">Business data scope</legend><div className="mt-2 space-y-2">{SUPPORT_SCOPE_OPTIONS.map((scope) => <label key={scope.value} className="flex items-start gap-2 text-xs leading-5 text-[#0C1B33]/65"><input type="checkbox" checked={dataScopes.includes(scope.value)} onChange={() => toggleScope(scope.value)} className="mt-1 h-3.5 w-3.5 accent-[#2563EB]" />{scope.label}</label>)}</div></fieldset>
                <label className="flex items-start gap-2 border border-[#0C1B33]/10 bg-white px-3 py-3 text-xs leading-5 text-[#0C1B33]/65"><input type="checkbox" checked={consentToShare} onChange={(event) => setConsentToShare(event.target.checked)} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#2563EB]" />I explicitly consent to share only the selected business data with this target organization for this request.</label>
                {supportError && <p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{supportError}</p>}
                {supportSuccess && <p role="status" className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{supportSuccess}</p>}
                <button type="submit" disabled={requestingSupport} className="inline-flex min-h-10 w-full items-center justify-center gap-2 bg-[#0C1B33] px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-white hover:bg-[#1E3054] disabled:opacity-60">{requestingSupport ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Record support request</button>
              </form>
              {supportRequests.length > 0 && <div className="mt-5 border-t border-[#0C1B33]/10 pt-4"><p className="font-mono-bureau text-[9px] uppercase tracking-[0.13em] text-[#0C1B33]/45">Recorded requests</p><ul className="mt-3 space-y-3">{supportRequests.map((request) => <li key={request.id} className="text-xs leading-5 text-[#0C1B33]/60"><strong className="font-medium text-[#0C1B33]">{request.targetOrganization}</strong><br />{request.requestedHelp}<br /><span className="text-[#0C1B33]/45">{request.dataScopes.map(scopeLabel).join(", ") || "No data scope"} · {statusLabel(request.status)}</span></li>)}</ul></div>}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function TimelineFact({ label, value }: { label: string; value: string }) {
  return <div className="border border-[#0C1B33]/10 bg-[#FAF9F6] px-4 py-3"><p className="font-mono-bureau text-[9px] uppercase tracking-[0.13em] text-[#0C1B33]/45">{label}</p><p className="mt-2 text-sm leading-5 text-[#0C1B33]/75">{value}</p></div>;
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-mono-bureau text-[9px] uppercase tracking-[0.13em] text-[#0C1B33]/40">{label}</dt><dd className="mt-1 break-words text-[#0C1B33]/75">{value || "Not provided"}</dd></div>;
}
